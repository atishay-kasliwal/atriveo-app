import { randomUUID } from "node:crypto";
import { NetworkError } from "./network.mjs";

// The free-form layer of the Network map: text boxes, sticky notes, pen strokes and images. None of it is linked to anything, except
// that a note or text box can be pinned to a card and then moves with it. Images are kept in their own collection and served one by one.

const BOARD = "network_board", IMAGES = "network_images";
export const BOARD_KINDS = ["text", "note", "stroke", "image"];
const MAX_POINTS = 4000, MAX_IMAGE = 2_500_000, IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
const fail = (m) => { throw new NetworkError(m); };
const num = (v, lo, hi) => { const n = Number(v); if (!Number.isFinite(n)) fail("A board position must be a number"); return Math.round(Math.max(lo, Math.min(hi, n)) * 10) / 10; };
const color = (v, fallback) => (v == null || v === "" ? fallback : /^#[0-9a-f]{6}$|^ink$/i.test(String(v)) ? String(v).toLowerCase() : fail("A colour looks like #3366ff"));
const out = ({ _id, ...d }) => ({ id: _id, ...d });

/** Everything on the board, without image bytes. */
export async function boardView(db) { return { items: (await db.collection(BOARD).find({}).toArray()).map(out).sort((a, b) => a.createdAt.localeCompare(b.createdAt)) }; }

function shape(kind, input, cur) {
  const it = {};
  const has = (k) => k in input || !cur;
  if (has("x")) it.x = num(input.x ?? 0, -100000, 100000);
  if (has("y")) it.y = num(input.y ?? 0, -100000, 100000);
  if (kind === "text" || kind === "note" || kind === "image") {
    if (has("w")) it.w = num(input.w ?? (kind === "text" ? 230 : 190), 40, 4000);
    if (has("h")) it.h = num(input.h ?? (kind === "text" ? 60 : 150), 30, 4000);
  }
  if ((kind === "text" || kind === "note") && has("text")) it.text = String(input.text ?? "").replace(/\r\n?/g, "\n").slice(0, 5000);
  if (kind === "note" && has("color")) it.color = color(input.color, "#fbbf24");
  if (kind === "stroke") {
    if (has("points")) {
      const pts = Array.isArray(input.points) ? input.points : [];
      if (pts.length < 1 || pts.length > MAX_POINTS) fail(`A stroke has 1 to ${MAX_POINTS} points`);
      it.points = pts.map((p) => [num(p?.[0], -100000, 100000), num(p?.[1], -100000, 100000)]);
    }
    if (has("color")) it.color = color(input.color, "ink");
    if (has("width")) it.width = num(input.width ?? 4, 1, 40);
    if (has("opacity")) it.opacity = Math.round(num((input.opacity ?? 0.9) * 100, 10, 100)) / 100;
  }
  if (kind === "image" && has("imageId")) { it.imageId = String(input.imageId ?? ""); if (!it.imageId) fail("Upload the image first"); }
  if ((kind === "text" || kind === "note") && "pin" in input) it.pin = input.pin && input.pin.id ? { id: String(input.pin.id), dx: num(input.pin.dx, -5000, 5000), dy: num(input.pin.dy, -5000, 5000) } : null;
  return it;
}

/** Create (no id) or change one item; only the fields sent change. */
export async function saveBoardItem(db, input = {}, now = new Date()) {
  if (input.id) {
    const cur = await db.collection(BOARD).findOne({ _id: String(input.id) });
    if (!cur) fail("That item is no longer on the board. Reload the page.");
    const set = { ...shape(cur.kind, input, cur), updatedAt: now.toISOString() };
    await db.collection(BOARD).updateOne({ _id: cur._id }, { $set: set });
    return out({ ...cur, ...set });
  }
  if (!BOARD_KINDS.includes(input.kind)) fail("Pick text, note, stroke or image");
  if (input.kind === "image" && !(await db.collection(IMAGES).findOne({ _id: String(input.imageId ?? "") }))) fail("Upload the image first");
  const at = now.toISOString(), doc = { _id: randomUUID(), kind: input.kind, pin: null, createdAt: at, updatedAt: at, ...shape(input.kind, input, null) };
  if ((await db.collection(BOARD).find({}).toArray()).length >= 3000) fail("The board is full (3,000 items). Remove some first.");
  await db.collection(BOARD).insertOne(doc);
  return out(doc);
}

/** Remove one item; an image's bytes go with it. */
export async function removeBoardItem(db, { id } = {}) {
  const cur = await db.collection(BOARD).findOne({ _id: String(id ?? "") });
  if (!cur) fail("That item is no longer on the board. Reload the page.");
  await db.collection(BOARD).deleteOne({ _id: cur._id });
  if (cur.kind === "image" && cur.imageId) await db.collection(IMAGES).deleteOne({ _id: cur.imageId });
  return { id: cur._id };
}

/** Keep an uploaded picture or GIF (PNG, JPEG, GIF, WebP; under 2.5 MB), checked by its first bytes, not its name. */
export async function saveImage(db, { type, base64 } = {}, now = new Date()) {
  const mime = String(type ?? "").toLowerCase();
  if (!IMAGE_TYPES.includes(mime)) fail("Add a PNG, JPEG, GIF or WebP image");
  const bytes = Buffer.from(String(base64 ?? ""), "base64");
  if (!bytes.length) fail("That image is empty");
  if (bytes.length > MAX_IMAGE) fail("Add an image under 2.5 MB");
  const sig = bytes.subarray(0, 12);
  const ok = { "image/png": sig.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), "image/jpeg": sig[0] === 0xff && sig[1] === 0xd8 && sig[2] === 0xff,
    "image/gif": sig.subarray(0, 4).toString("latin1") === "GIF8", "image/webp": sig.subarray(0, 4).toString("latin1") === "RIFF" && sig.subarray(8, 12).toString("latin1") === "WEBP" }[mime];
  if (!ok) fail("That file is not the kind of image it says it is");
  const id = randomUUID();
  await db.collection(IMAGES).insertOne({ _id: id, type: mime, bytes: bytes.toString("base64"), size: bytes.length, createdAt: now.toISOString() });
  return { id };
}

export async function readImage(db, id) {
  const doc = await db.collection(IMAGES).findOne({ _id: String(id ?? "") });
  if (!doc) fail("That image is gone");
  return { type: doc.type, bytes: Buffer.from(doc.bytes, "base64") };
}
