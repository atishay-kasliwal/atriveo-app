import { useEffect, useRef, useState } from "react";
import type { BoardItem, NetworkData } from "./network";
import { download, mapJson, mapSvg, svgToPng, type ExportOptions } from "./networkPicture";

// Export the map the way Excalidraw does: PNG, SVG or a PNG on the clipboard, with or without the background, dark or light, at 1x to 3x,
// everything or only what is selected. "Save a copy" keeps the whole map (people, sources, links, board) as a JSON file you can open
// again as a new map.

const stamp = () => new Date().toLocaleDateString("en-CA");

export default function ExportDialog({ svg, selection, data, board, onClose, say }: {
  svg: () => SVGSVGElement | null; selection: Set<string>; data: NetworkData; board: BoardItem[]; onClose: () => void; say: (t: { text: string } | null) => void;
}) {
  const [only, setOnly] = useState(selection.size > 0);
  const [background, setBackground] = useState(true);
  const [dark, setDark] = useState(true);
  const [scale, setScale] = useState(2);
  const [name, setName] = useState(`network-${stamp()}`);
  const [preview, setPreview] = useState<{ url: string; w: number; h: number } | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const close = useRef(onClose); close.current = onClose;
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape") close.current(); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, []);
  const options = (): ExportOptions => ({ only: only && selection.size ? selection : null, background, dark, padding: 32 });
  useEffect(() => {
    let on = true;
    const el = svg(); if (!el) return;
    void mapSvg(el, { only: only && selection.size ? selection : null, background, dark, padding: 32 }).then((r) => {
      if (on) setPreview(r ? { url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(r.svg)}`, w: r.w, h: r.h } : null);
    });
    return () => { on = false; };
  }, [svg, only, selection, background, dark]);
  const file = (ext: string) => `${name.trim().replace(/[\\/:*?"<>|]+/g, "-") || `network-${stamp()}`}.${ext}`;
  async function run(kind: "png" | "svg" | "copy" | "json") {
    setError(""); setBusy(kind);
    try {
      if (kind === "json") { download(new Blob([mapJson(data, board)], { type: "application/json" }), file("json")); say({ text: "Saved a copy of the whole map." }); return; }
      const el = svg(), r = el && await mapSvg(el, options());
      if (!r) throw new Error("There is nothing to export.");
      if (kind === "svg") { download(new Blob([r.svg], { type: "image/svg+xml" }), file("svg")); say({ text: "Exported as SVG." }); return; }
      if (kind === "png") { download(await svgToPng(r.svg, r.w, r.h, scale), file("png")); say({ text: "Exported as PNG." }); return; }
      if (!navigator.clipboard || typeof ClipboardItem === "undefined") throw new Error("This browser cannot put pictures on the clipboard. Use Export PNG.");
      await navigator.clipboard.write([new ClipboardItem({ "image/png": svgToPng(r.svg, r.w, r.h, scale) })]);
      say({ text: "Copied as PNG. Paste it anywhere." });
    } catch (e) { setError(String((e as Error).message || e)); }
    finally { setBusy(""); }
  }
  const toggle = (id: string, label: string, value: boolean, set: (v: boolean) => void, hint?: string) => (
    <label className="nwx-opt" htmlFor={id}><span><b>{label}</b>{hint && <small>{hint}</small>}</span><input id={id} type="checkbox" role="switch" checked={value} onChange={(e) => set(e.target.checked)} /></label>
  );
  const px = preview ? `${Math.round(preview.w * scale)} × ${Math.round(preview.h * scale)} px` : "";
  return (
    <div className="nw-dim" onPointerDown={(e) => e.stopPropagation()} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="nw-dialog nwx" role="dialog" aria-modal="true" aria-label="Export">
        <div className="nw-dh"><div><h2>Export</h2><p>A picture of your map, or a copy of all of it.</p></div><button type="button" className="nw-x" aria-label="Close" onClick={onClose}>×</button></div>
        <div className="nwx-body">
          <div className={`nwx-preview${dark ? " dark" : ""}${background ? "" : " clear"}`}>{preview ? <img src={preview.url} alt="Preview of the export" /> : <span className="nw-muted">Drawing the preview…</span>}</div>
          <div className="nwx-side">
            <label className="nw-f"><span>File name</span><input id="nwx-name" value={name} onChange={(e) => setName(e.target.value)} /></label>
            {selection.size > 0 && toggle("nwx-only", "Only selected", only, setOnly, `${selection.size} ${selection.size === 1 ? "card" : "cards"}`)}
            {toggle("nwx-bg", "Background", background, setBackground)}
            {toggle("nwx-dark", "Dark mode", dark, setDark)}
            <div className="nwx-opt"><span><b>Scale</b><small>{px}</small></span><div className="nwx-seg" role="radiogroup" aria-label="Scale">{[1, 2, 3].map((k) => <button key={k} type="button" role="radio" aria-checked={scale === k} onClick={() => setScale(k)}>{k}×</button>)}</div></div>
          </div>
        </div>
        {error && <p className="nw-error" role="alert">{error}</p>}
        <div className="nw-df">
          <button type="button" className="nw-btn ghost" disabled={!!busy} onClick={() => void run("json")} title="People, sources, links, the board and where everything sits">Save a copy (.json)</button>
          <span className="grow" />
          <button type="button" className="nw-btn" disabled={!!busy || !preview} onClick={() => void run("copy")}>{busy === "copy" ? "Copying…" : "Copy to clipboard"}</button>
          <button type="button" className="nw-btn" disabled={!!busy || !preview} onClick={() => void run("svg")}>SVG</button>
          <button type="button" className="nw-btn main" disabled={!!busy || !preview} onClick={() => void run("png")}>{busy === "png" ? "Exporting…" : "PNG"}</button>
        </div>
      </div>
    </div>
  );
}
