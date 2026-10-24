// Round-trip test of R2 credentials: write a small object, read it back, delete it. Never prints the secret.
//   R2_ACCOUNT_ID=... R2_BUCKET=... R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=... node scripts/r2-check.mjs
import { createStore } from "./resume-store.mjs";

export async function checkR2({ endpoint, bucket, accessKeyId, secretAccessKey, fetchImpl }) {
  const store = createStore({ endpoint, bucket, accessKeyId, secretAccessKey, ...(fetchImpl && { fetchImpl }) });
  const key = `ops/r2-check-${Date.now()}.txt`;
  const body = Buffer.from(`atriveo r2 check ${new Date().toISOString()}`);
  const step = async (name, fn) => { try { return await fn(); } catch (e) { const err = new Error(`${name}: ${e.message}`); err.step = name; throw err; } };
  try {
    await step("write", () => store.put(key, body, "text/plain"));
    const back = await step("read", () => store.get(key));
    if (!back || !back.equals(body)) throw Object.assign(new Error("read: the object read back differs from what was written"), { step: "read" });
    await step("delete", () => store.del(key));
    if (await step("confirm delete", () => store.head(key))) throw Object.assign(new Error("confirm delete: the object is still there"), { step: "delete" });
    return { ok: true };
  } catch (e) {
    const hint = /\b403\b/.test(e.message) ? "The key was refused: check it is the Access Key ID and the Secret Access Key of a token with Object Read & Write on this bucket."
      : /\b404\b/.test(e.message) ? "The bucket was not found: check the account ID and the bucket name." : null;
    return { ok: false, step: e.step ?? "unknown", error: e.message, hint };
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { R2_ACCOUNT_ID: account, R2_BUCKET: bucket, R2_ACCESS_KEY_ID: accessKeyId, R2_SECRET_ACCESS_KEY: secretAccessKey } = process.env;
  if (!account || !bucket || !accessKeyId || !secretAccessKey) { console.error("Set R2_ACCOUNT_ID, R2_BUCKET, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY."); process.exit(2); }
  const r = await checkR2({ endpoint: process.env.R2_ENDPOINT || `https://${account}.r2.cloudflarestorage.com`, bucket, accessKeyId, secretAccessKey });
  console.log(r.ok ? `R2 works: wrote, read back and deleted a test object in "${bucket}".` : `R2 check failed at "${r.step}": ${r.error}${r.hint ? `\n${r.hint}` : ""}`);
  process.exit(r.ok ? 0 : 1);
}
