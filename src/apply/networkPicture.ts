import { post, type BoardItem, type NetworkData } from "./network";

// Drawing the map as a standalone picture (export, map previews) and the whole map as a file. Shared by Export and the map home page.

export interface ExportOptions { only: Set<string> | null; background: boolean; dark: boolean; padding: number }

const LIGHT: Record<string, string> = {
  "--nw-bg": "#ffffff", "--nw-card": "#ffffff", "--nw-soft": "#f2f3f6", "--nw-line": "#e3e5ea", "--nw-line-strong": "#c9cdd6",
  "--nw-ink": "#14161b", "--nw-muted": "#555c69", "--nw-accent": "#4f5bd5",
};
// What an SVG card needs from the stylesheet; HTML inside a foreignObject (notes, pictures) gets its whole computed style.
const SVG_PROPS = ["fill", "fill-opacity", "stroke", "stroke-width", "stroke-opacity", "stroke-dasharray", "stroke-linecap", "stroke-linejoin", "opacity", "font-family", "font-size", "font-weight", "font-style", "letter-spacing", "text-anchor", "dominant-baseline", "display", "visibility"];
const SKIP_HTML = /^(transition|animation|cursor|pointer-events|user-select|-webkit-user-select|caret-color|outline)/;
// Things that only make sense while you work: hit areas, resize handles, delete buttons, hover halos, tooltips, the breathing ring.
const INTERACTIVE = ".nwg-hit, .nwgb-hit, .nwgb-rz, .nwgb-grip, .nwg-halo, .nwg-you-pulse, button.del, title";

function inline(live: Element, copy: Element) {
  const cs = getComputedStyle(live), out: string[] = [];
  if (live instanceof SVGElement && !(live instanceof SVGForeignObjectElement)) { for (const p of SVG_PROPS) out.push(`${p}:${cs.getPropertyValue(p)}`); }
  else for (let i = 0; i < cs.length; i++) { const p = cs[i]; if (!SKIP_HTML.test(p)) out.push(`${p}:${cs.getPropertyValue(p)}`); }
  copy.setAttribute("style", out.join(";"));
  for (let i = 0; i < live.children.length; i++) if (copy.children[i]) inline(live.children[i], copy.children[i]);
}

const dataUrls = new Map<string, Promise<string>>();
function asDataUrl(url: string): Promise<string> {
  if (url.startsWith("data:")) return Promise.resolve(url);
  if (!dataUrls.has(url)) dataUrls.set(url, fetch(url, { credentials: "include" }).then((r) => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))))
    .then((b) => new Promise<string>((ok, bad) => { const f = new FileReader(); f.onload = () => ok(String(f.result)); f.onerror = () => bad(f.error); f.readAsDataURL(b); }))
    .catch(() => { dataUrls.delete(url); return ""; }));
  return dataUrls.get(url)!;
}

/** The map as a standalone SVG: the cards drawn, styles inlined, pictures embedded, cropped to what is there plus padding. */
export async function mapSvg(live: SVGSVGElement, o: ExportOptions): Promise<{ svg: string; w: number; h: number } | null> {
  const world = live.querySelector(":scope > g") as SVGGElement | null;
  if (!world) return null;
  const page = live.closest<HTMLElement>(".nw-page") ?? document.documentElement;
  // Read the styles in the theme asked for: swap the page's colour tokens for one synchronous moment (nothing paints in between).
  const saved = Object.keys(LIGHT).map((k) => [k, page.style.getPropertyValue(k)] as const);
  if (!o.dark) for (const [k, v] of Object.entries(LIGHT)) page.style.setProperty(k, v);
  const copy = world.cloneNode(true) as SVGGElement;
  let bg = "";
  try { inline(world, copy); bg = getComputedStyle(page).getPropertyValue("--nw-bg").trim() || (o.dark ? "#0c0d10" : "#ffffff"); }
  finally { if (!o.dark) for (const [k, v] of saved) { if (v) page.style.setProperty(k, v); else page.style.removeProperty(k); } }
  copy.removeAttribute("transform");
  copy.querySelectorAll(INTERACTIVE).forEach((el) => el.remove());
  copy.querySelectorAll("[contenteditable]").forEach((el) => el.removeAttribute("contenteditable"));
  copy.querySelectorAll("[tabindex]").forEach((el) => el.removeAttribute("tabindex"));
  // Nothing faded: a search or an open panel dims the rest of the map, an export shows it all.
  copy.querySelectorAll<SVGElement>(".nwg-node, .nwg-src, .nwg-stack").forEach((el) => { el.style.opacity = "1"; });
  copy.querySelectorAll<SVGElement>(".nwg-edge").forEach((el) => { if (Number(el.style.opacity) < 0.3) el.style.opacity = "0.7"; });
  if (o.only) {
    const keep = o.only;
    copy.querySelectorAll("[data-node]").forEach((el) => { if (!keep.has(el.getAttribute("data-node")!)) el.remove(); });
    copy.querySelectorAll(".nwg-edge").forEach((el) => { if (!keep.has(el.getAttribute("data-a") ?? "") || !keep.has(el.getAttribute("data-b") ?? "")) el.remove(); });
    copy.querySelectorAll("[data-board], .nwgb-stroke, .nwg-group, .nwg-stack, .nwg-workline, [data-work]").forEach((el) => el.remove());
  }
  await Promise.all([...copy.querySelectorAll("image"), ...copy.querySelectorAll("img")].map(async (el) => {
    const attr = el.tagName.toLowerCase() === "img" ? "src" : "href", url = el.getAttribute(attr);
    if (url) { const d = await asDataUrl(new URL(url, location.href).href); if (d) el.setAttribute(attr, d); else el.remove(); }
  }));
  // Measure what is left in an off-screen copy of the canvas.
  const ns = "http://www.w3.org/2000/svg", probe = document.createElementNS(ns, "svg");
  probe.setAttribute("style", "position:fixed;left:-100000px;top:0;width:10px;height:10px;visibility:hidden");
  probe.appendChild(copy); document.body.appendChild(probe);
  let box: DOMRect;
  try { box = copy.getBBox(); } finally { probe.remove(); }
  if (!box.width || !box.height) return null;
  const pad = o.padding, x = Math.floor(box.x - pad), y = Math.floor(box.y - pad), w = Math.ceil(box.width + pad * 2), h = Math.ceil(box.height + pad * 2);
  const out = document.createElementNS(ns, "svg");
  out.setAttribute("xmlns", ns); out.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
  out.setAttribute("viewBox", `${x} ${y} ${w} ${h}`); out.setAttribute("width", String(w)); out.setAttribute("height", String(h));
  if (o.background) { const r = document.createElementNS(ns, "rect"); r.setAttribute("x", String(x)); r.setAttribute("y", String(y)); r.setAttribute("width", String(w)); r.setAttribute("height", String(h)); r.setAttribute("fill", bg); out.appendChild(r); }
  out.appendChild(copy);
  return { svg: new XMLSerializer().serializeToString(out), w, h };
}

/** That SVG drawn at a scale, as PNG; very large maps are scaled down to stay inside what a browser canvas allows. */
export async function svgToPng(svg: string, w: number, h: number, scale: number, type = "image/png"): Promise<Blob> {
  const k = Math.min(scale, 16000 / w, 16000 / h, Math.sqrt(120e6 / (w * h)));
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await img.decode();
  const c = document.createElement("canvas");
  c.width = Math.round(w * k); c.height = Math.round(h * k);
  const ctx = c.getContext("2d")!;
  ctx.scale(k, k); ctx.drawImage(img, 0, 0, w, h);
  const blob = await new Promise<Blob | null>((ok) => c.toBlob(ok, type, 0.84));
  if (!blob) throw new Error("The picture was too big to draw. Try 1x or Only selected.");
  return blob;
}

export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob), a = document.createElement("a");
  // A click that does not bubble, so the app's link router never sees (and cancels) it.
  a.href = url; a.download = name; a.dispatchEvent(new MouseEvent("click", { bubbles: false, cancelable: true }));
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/* ---------- the small picture on a map's card on the home page ---------- */

let pending: Promise<unknown> = Promise.resolve();
/** The home page waits (a few seconds at most) for the preview of the map you just left, so its card is up to date. */
export const setPendingPreview = (p: Promise<unknown>) => { pending = p.catch(() => undefined); };
export const previewSaved = () => Promise.race([pending, new Promise((ok) => window.setTimeout(ok, 4000))]);

/** Draw the open map small (720 px wide at most, as JPEG) and keep it as that map's preview. */
export async function savePreview(el: SVGSVGElement, mapId: string) {
  const r = await mapSvg(el, { only: null, background: true, dark: true, padding: 80 });
  if (!r) return;
  const blob = await svgToPng(r.svg, r.w, r.h, Math.min(1, 720 / r.w, 480 / r.h), "image/jpeg");
  const base64 = await new Promise<string>((ok, bad) => { const f = new FileReader(); f.onload = () => ok(String(f.result).split(",")[1] ?? ""); f.onerror = () => bad(f.error); f.readAsDataURL(blob); });
  const { id } = await post<{ id: string }>("photo", { type: "image/jpeg", base64 });
  await post("maps/save", { id: mapId, mapId, thumbId: id });
}

/** The whole map as a file: people, sources, your links, the board and where everything sits. */
export function mapJson(data: NetworkData, board: BoardItem[]) {
  return JSON.stringify({ type: "atriveo-network", version: 1, name: data.map?.name ?? "", exportedAt: new Date().toISOString(), you: data.you ?? null, sources: data.sources.filter((s) => !s.auto), people: data.people, links: data.links, board }, null, 2);
}

