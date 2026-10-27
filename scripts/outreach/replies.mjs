// Replies to your outreach emails, as recorded by the Gmail watcher on each sent message (`reply`: when, and the subject). Counts and
// times only: no body text. Read by the Outreach page to mark a message "Replied".
export async function outreachReplies(db, { limit = 500 } = {}) {
  const docs = await db.collection("outreach").find({ reply: { $exists: true, $ne: null } }, { projection: { _id: 1, reply: 1 } }).sort({ "reply.at": -1 }).limit(limit).toArray();
  const out = {};
  for (const d of docs) if (d.reply?.at) out[String(d._id)] = { at: d.reply.at, subject: String(d.reply.subject ?? "").slice(0, 120) };
  return out;
}
