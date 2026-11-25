// Sync the open source page from GitHub (docs/open-source-page.md).
//   node --env-file=.env scripts/open-source-sync.mjs [--if-older 60]
// OSS_GITHUB_TOKEN (read-only, public repositories) gives sizes, stars and authorship; without it, status and dates only.
import { withMongo, closeMongo } from "./mongo-client.mjs";
import { syncOpenSource } from "./open-source.mjs";

const at = process.argv.indexOf("--if-older");
try {
  const r = await withMongo((db) => syncOpenSource(db, { ifOlderMin: at > 0 ? Number(process.argv[at + 1]) || 0 : 0 }), { appName: "AtriveoOpenSource" });
  console.log(r.skipped ? `open source: synced ${r.at}, not due` : `open source: ${r.count} pull requests (${r.full ? "full" : "status only, no OSS_GITHUB_TOKEN"}), ${r.added.length} new, ${r.changed.length} changed status`);
} catch (e) {
  console.error(`open source sync failed: ${e.message || e}`);
  process.exitCode = 1;
} finally {
  await closeMongo();
}
