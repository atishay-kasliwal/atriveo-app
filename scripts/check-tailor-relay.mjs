#!/usr/bin/env node
/**
 * Verify tailor sidecar + Cloudflare tunnel relay end-to-end.
 */
import fs from "node:fs";
import path from "node:path";
import dns from "node:dns/promises";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const envPath = path.join(ROOT, ".env.tailor");
const HOSTNAME = "tailor-relay.atriveo.com";

function loadEnv() {
  if (!fs.existsSync(envPath)) return {};
  return Object.fromEntries(
    fs
      .readFileSync(envPath, "utf8")
      .split("\n")
      .filter((l) => l.trim() && !l.trim().startsWith("#"))
      .map((l) => {
        const i = l.indexOf("=");
        return [l.slice(0, i), l.slice(i + 1)];
      }),
  );
}

async function check(label, fn) {
  try {
    const detail = await fn();
    console.log(`✓ ${label}${detail ? ` — ${detail}` : ""}`);
    return true;
  } catch (e) {
    console.error(`✗ ${label} — ${e?.message || e}`);
    return false;
  }
}

const env = loadEnv();
const token = env.TAILOR_TOKEN?.trim() || "";
let ok = true;

ok &&= await check("LaunchAgent", () => {
  const out = execSync(`launchctl print gui/$(id -u)/com.atriveo.tailor 2>/dev/null || true`, {
    encoding: "utf8",
  });
  if (!out.includes("state = running")) throw new Error("com.atriveo.tailor not running — npm run tailor:install");
  return "running";
});

ok &&= await check("Local sidecar", async () => {
  const res = await fetch("http://127.0.0.1:8787/health", {
    headers: token ? { "X-Tailor-Token": token } : {},
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (!data.ok) throw new Error("not ok");
  if (!data.driveMounted) {
    const root = data.outRoot || "output root";
    throw new Error(root.startsWith("/Volumes/") ? `drive "Kasliwal v2" not mounted` : `${root} missing`);
  }
  return "output root ok";
});

ok &&= await check(`DNS ${HOSTNAME}`, () => {
  const ips = execSync(`dig @1.1.1.1 +short ${HOSTNAME} 2>/dev/null`, { encoding: "utf8" }).trim();
  if (!ips) {
    throw new Error("no A/CNAME — run: cloudflared tunnel login && npm run tailor:dns");
  }
  return ips.split("\n")[0];
});

ok &&= await check(`Relay https://${HOSTNAME}`, async () => {
  dns.setServers(["1.1.1.1", "8.8.8.8"]);
  const ips = await dns.resolve4(HOSTNAME);
  const ip = ips[0];
  const curl = execSync(
    `curl -sS -m 15 --resolve "${HOSTNAME}:443:${ip}" ${token ? `-H "X-Tailor-Token: ${token}"` : ""} "https://${HOSTNAME}/health"`,
    { encoding: "utf8" },
  );
  const data = JSON.parse(curl);
  if (!data.ok) throw new Error("not ok");
  return data.driveMounted ? "ok" : "relay up, drive missing";
});

ok &&= await check("Production /tailor proxy", async () => {
  const res = await fetch("https://application.atriveo.com/tailor/health", {
    signal: AbortSignal.timeout(15000),
  });
  if (res.status === 401) return "reachable (auth required)";
  if (res.status === 502) throw new Error("relay unreachable from Pages — check TAILOR_ORIGIN");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return "ok";
});

if (!ok) {
  console.error("\nTailor relay check failed.");
  process.exit(1);
}
console.log("\nTailor relay healthy.");
