import { loadResumeProfile, saveResumeProfile } from "./resume-profile.mjs";

// The email addresses you put on resumes: a short saved list, and which one new resumes use. Both live in Mongo (app_settings), the one
// place every container can read. The resume profile is a file baked into each container, so an edit made in one never reached the others:
// each build now first copies the saved default into its own profile (syncDefaultEmail), so every resume is built with it.

const ID = "resume_emails";
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MAX = 8;
export const cleanEmail = (value) => { const e = String(value ?? "").trim().toLowerCase().slice(0, 80); return EMAIL.test(e) ? e : null; };

/** { list, default }: `list` always includes the default; `default` is null until you choose one. */
export async function getResumeEmails(db) {
  const doc = await db.collection("app_settings").findOne({ _id: ID });
  const list = [...new Set((doc?.list ?? []).map(cleanEmail).filter(Boolean))].slice(0, MAX);
  const def = cleanEmail(doc?.default);
  if (def && !list.includes(def)) list.unshift(def);
  return { list, default: def };
}

async function save(db, list, def) {
  await db.collection("app_settings").updateOne({ _id: ID }, { $set: { list, default: def, updatedAt: new Date().toISOString() } }, { upsert: true });
  return { list, default: def };
}

/** add: remember an address; default: remember it and use it for new resumes; remove: forget it (and un-default it if it was). */
export async function changeResumeEmails(db, { action, email }) {
  const e = cleanEmail(email);
  if (!e) throw new Error(`"${String(email ?? "").slice(0, 80)}" is not an email address`);
  const cur = await getResumeEmails(db);
  if (action === "add") {
    if (!cur.list.includes(e) && cur.list.length >= MAX) throw new Error(`You can keep ${MAX} addresses. Remove one first.`);
    return save(db, cur.list.includes(e) ? cur.list : [...cur.list, e], cur.default);
  }
  if (action === "default") {
    if (!cur.list.includes(e) && cur.list.length >= MAX) throw new Error(`You can keep ${MAX} addresses. Remove one first.`);
    return save(db, cur.list.includes(e) ? cur.list : [...cur.list, e], e);
  }
  if (action === "remove") return save(db, cur.list.filter((x) => x !== e), cur.default === e ? null : cur.default);
  throw new Error("Unknown action");
}

let memo = { at: 0, value: undefined };
/** Make this container's resume profile use the saved default email (if one was chosen). Cheap: one read, remembered for 20 seconds. */
export async function syncDefaultEmail(db, { now = Date.now(), force = false } = {}) {
  if (!force && memo.value !== undefined && now - memo.at < 20_000) return memo.value;
  const { default: def } = await getResumeEmails(db);
  let changed = false;
  if (def && String(loadResumeProfile().email || "").toLowerCase() !== def) { saveResumeProfile({ email: def }); changed = true; }
  memo = { at: now, value: { default: def, changed } };
  return memo.value;
}
export const forgetEmailSync = () => { memo = { at: 0, value: undefined }; };
