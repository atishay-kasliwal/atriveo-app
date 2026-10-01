// What a parser can get out of a resume PDF, read three ways with poppler:
//   layout   lines kept as printed, cells separated by runs of spaces (the reference view)
//   reading  poppler's column-aware reading order (what pdftotext gives by default)
//   raw      the order the text was drawn in the PDF content stream
// plus page count, fonts, embedded images and link targets. Reading the same file always gives
// the same result: nothing here depends on time or environment beyond the poppler version.

import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { sha256 } from "./config.mjs";

function run(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.error) throw new Error(`${cmd} is not available: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed: ${(r.stderr || "").trim().slice(0, 300)}`);
  return r.stdout;
}

/** Fonts as pdffonts lists them; `unicode` says whether glyphs map back to characters. */
function parseFonts(out) {
  return out.split("\n").slice(2).filter((l) => l.trim()).map((line) => {
    const cols = line.trim().split(/\s+/);
    // name type... encoding emb sub uni object-id generation: the last six columns are fixed.
    const [encoding, emb, , uni] = cols.slice(-6, -2);
    return { name: cols[0], encoding, embedded: emb === "yes", unicode: uni === "yes" };
  });
}

/** Link targets from `pdfinfo -url`: one row per link annotation. */
function parseLinks(out) {
  return out.split("\n").slice(1).map((l) => l.trim().match(/^(\d+)\s+\S+\s+(\S.*)$/))
    .filter(Boolean).map(([, page, url]) => ({ page: Number(page), url: url.trim() }));
}

export function extractPdf(pdfPath) {
  const bytes = fs.readFileSync(pdfPath);
  if (!bytes.subarray(0, 5).toString("latin1").startsWith("%PDF-")) throw new Error(`${pdfPath} is not a PDF`);
  const info = run("pdfinfo", [pdfPath]);
  const text = (mode) => run("pdftotext", [...mode, "-enc", "UTF-8", pdfPath, "-"]);
  return {
    file: pdfPath,
    sha256: sha256(bytes),
    pages: Number(info.match(/^Pages:\s+(\d+)/m)?.[1] ?? 0),
    views: { layout: text(["-layout"]), reading: text([]), raw: text(["-raw"]) },
    fonts: parseFonts(run("pdffonts", [pdfPath])),
    images: Math.max(0, run("pdfimages", ["-list", pdfPath]).split("\n").filter((l) => l.trim()).length - 2),
    links: parseLinks(run("pdfinfo", ["-url", pdfPath])),
  };
}
