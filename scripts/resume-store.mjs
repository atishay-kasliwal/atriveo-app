// Resume files in Cloudflare R2 (S3 API). A resume is stored once under the SHA-256 of its bytes, so the same file
// is never uploaded twice and a key never changes meaning. Mongo keeps the reference next to the old Mac path:
//   resume.object = { bucket, key, sha256, bytes, image_key }
// Nothing here is required: with no R2_* settings every call reports "not configured" and the caller carries on.
//
// Settings (env): R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET. The bucket stays private;
// files are read through short-lived signed links, never a public address.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const hmac = (key, data) => crypto.createHmac("sha256", key).update(data).digest();
const hex = (data) => crypto.createHash("sha256").update(data).digest("hex");
const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
const EMPTY = hex("");

/** AWS Signature V4 for one request. Exported so it can be checked against AWS's published example. */
export function signRequest({ method, host, canonicalPath, query = "", headers = {}, payloadHash = EMPTY, accessKeyId, secretAccessKey, region = "auto", service = "s3", amzDate }) {
  const date = amzDate.slice(0, 8);
  const all = { host, "x-amz-content-sha256": payloadHash, "x-amz-date": amzDate, ...Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v).trim()])) };
  const names = Object.keys(all).sort();
  const canonical = [method, canonicalPath, query, names.map((n) => `${n}:${all[n]}\n`).join(""), names.join(";"), payloadHash].join("\n");
  const scope = `${date}/${region}/${service}/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, hex(canonical)].join("\n");
  const key = hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, date), region), service), "aws4_request");
  const signature = crypto.createHmac("sha256", key).update(toSign).digest("hex");
  return { signature, signedHeaders: names.join(";"), authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}`, all };
}

export const resumeKey = (sha256) => `resumes/${sha256.slice(0, 2)}/${sha256}.pdf`;
export const imageKey = (sha256) => `resumes/${sha256.slice(0, 2)}/${sha256}.png`;

export function storeFromEnv(env = process.env) {
  const { R2_ACCOUNT_ID: account, R2_ACCESS_KEY_ID: accessKeyId, R2_SECRET_ACCESS_KEY: secretAccessKey, R2_BUCKET: bucket } = env;
  if (!account || !accessKeyId || !secretAccessKey || !bucket) return null;
  return createStore({ endpoint: `https://${account}.r2.cloudflarestorage.com`, bucket, accessKeyId, secretAccessKey });
}

export function createStore({ endpoint, bucket, accessKeyId, secretAccessKey, fetchImpl = fetch, now = () => new Date() }) {
  const host = new URL(endpoint).host;
  const stamp = () => now().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const pathOf = (key) => `/${bucket}/${key.split("/").map(enc).join("/")}`;

  async function call(method, key, { body = null, contentType = null } = {}) {
    const payloadHash = body ? hex(body) : EMPTY;
    const signed = signRequest({ method, host, canonicalPath: pathOf(key), headers: contentType ? { "content-type": contentType } : {}, payloadHash, accessKeyId, secretAccessKey, amzDate: stamp() });
    const headers = { ...signed.all, authorization: signed.authorization };
    delete headers.host;
    return fetchImpl(`${endpoint}${pathOf(key)}`, { method, headers, body, signal: AbortSignal.timeout(20_000) });
  }

  return {
    bucket,
    async head(key) { const r = await call("HEAD", key); if (r.status === 404) return null; if (!r.ok) throw new Error(`R2 HEAD ${key}: ${r.status}`); return { bytes: Number(r.headers.get("content-length")) }; },
    async put(key, body, contentType) { const r = await call("PUT", key, { body, contentType }); if (!r.ok) throw new Error(`R2 PUT ${key}: ${r.status}`); },
    async del(key) { const r = await call("DELETE", key); if (!r.ok && r.status !== 404) throw new Error(`R2 DELETE ${key}: ${r.status}`); },
    async get(key) { const r = await call("GET", key); if (r.status === 404) return null; if (!r.ok) throw new Error(`R2 GET ${key}: ${r.status}`); return Buffer.from(await r.arrayBuffer()); },
    /** A link that reads one object for `seconds` (default 5 minutes) and then stops working. */
    presignGet(key, seconds = 300) {
      const amzDate = stamp(), date = amzDate.slice(0, 8), scope = `${date}/auto/s3/aws4_request`;
      const params = { "X-Amz-Algorithm": "AWS4-HMAC-SHA256", "X-Amz-Credential": `${accessKeyId}/${scope}`, "X-Amz-Date": amzDate, "X-Amz-Expires": String(seconds), "X-Amz-SignedHeaders": "host" };
      const query = Object.keys(params).sort().map((k) => `${enc(k)}=${enc(params[k])}`).join("&");
      const canonical = ["GET", pathOf(key), query, `host:${host}\n`, "host", "UNSIGNED-PAYLOAD"].join("\n");
      const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, hex(canonical)].join("\n");
      const k = hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, date), "auto"), "s3"), "aws4_request");
      return `${endpoint}${pathOf(key)}?${query}&X-Amz-Signature=${crypto.createHmac("sha256", k).update(toSign).digest("hex")}`;
    },
  };
}

/**
 * Upload a finished resume (and its page image when one exists beside it) and return the reference to keep in Mongo.
 * Never throws: a storage problem must not fail a compile, so it returns { error } and the caller keeps the local path.
 */
export async function publishResume(pdfPath, { store = storeFromEnv(), imagePath = path.join(path.dirname(pdfPath), "resume-page.png") } = {}) {
  if (!store) return { configured: false };
  try {
    const pdf = fs.readFileSync(pdfPath);
    const sha256 = hex(pdf);
    const key = resumeKey(sha256);
    if (!(await store.head(key))) await store.put(key, pdf, "application/pdf");
    const object = { bucket: store.bucket, key, sha256, bytes: pdf.length };
    if (fs.existsSync(imagePath)) {
      const image = fs.readFileSync(imagePath);
      const k = imageKey(sha256);
      if (!(await store.head(k))) await store.put(k, image, "image/png");
      object.image_key = k;
    }
    return { configured: true, object };
  } catch (error) {
    return { configured: true, error: String(error.message || error) };
  }
}

/** Download a stored resume to a temp file for a tool that needs a local path (the apply engine's upload). */
export async function fetchResumeToFile(object, dir, { store = storeFromEnv() } = {}) {
  if (!store) throw new Error("R2 is not configured");
  const body = await store.get(object.key);
  if (!body) throw new Error(`Resume not found in R2: ${object.key}`);
  if (hex(body) !== object.sha256) throw new Error(`Resume in R2 does not match its recorded hash: ${object.key}`);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${object.sha256.slice(0, 12)}.pdf`);
  fs.writeFileSync(file, body);
  return file;
}

/** The answer to GET /applications/resume-file?sha=&kind=pdf|image: a redirect to a link that works for a few minutes. */
export function resumeFileRedirect(query, { store = storeFromEnv(), seconds = 300 } = {}) {
  const sha = String(query.sha || "");
  if (!store) return { status: 404 };
  if (!/^[0-9a-f]{64}$/.test(sha)) return { status: 400 };
  const key = query.kind === "image" ? imageKey(sha) : resumeKey(sha);
  return { status: 302, location: store.presignGet(key, seconds) };
}
