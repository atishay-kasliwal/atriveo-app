import { useEffect, useRef } from "react";
import { NOTE_COLORS, PEN_COLORS, PEN_SIZES, type BoardItem, type Pen, type Tool } from "./network";

// The board's controls and its two kinds of box (text and sticky note). The map (NetworkGraph) owns positions, dragging and saving.

const ICON: Record<Tool | "image" | "undo" | "path", string> = {
  select: "M5 3l14 7-6 2-2 6z",
  area: "M4 8V5a1 1 0 011-1h3M16 4h3a1 1 0 011 1v3M20 16v3a1 1 0 01-1 1h-3M8 20H5a1 1 0 01-1-1v-3M9 9h6v6H9z",
  work: "M3 8.5A1.5 1.5 0 014.5 7h15A1.5 1.5 0 0121 8.5v10a1.5 1.5 0 01-1.5 1.5h-15A1.5 1.5 0 013 18.5zM9 7V5.5A1.5 1.5 0 0110.5 4h3A1.5 1.5 0 0115 5.5V7M3 13h18",
  path: "M5 20a2.2 2.2 0 100-.01M19 6a2.2 2.2 0 100-.01M7 18c5 0 2-10 8-10h2",
  hand: "M8 13V6a1.5 1.5 0 013 0v5m0-6a1.5 1.5 0 013 0v6m0-4a1.5 1.5 0 013 0v7a6 6 0 01-6 6h-1a6 6 0 01-5-3l-2-4a1.5 1.5 0 012.6-1.4L8 14",
  text: "M5 7V5h14v2M12 5v14M9 19h6",
  note: "M5 4h14v10l-6 6H5zM13 20v-6h6",
  pen: "M4 20l1-4L16 5a2 2 0 013 3L8 19z",
  eraser: "M7 20h11M5.5 14l7.5-7.5a2 2 0 013 0l2.5 2.5a2 2 0 010 3L11 19H8l-2.5-2.5a2 2 0 010-2.5z",
  image: "M3 6.5A2.5 2.5 0 015.5 4h13A2.5 2.5 0 0121 6.5v11a2.5 2.5 0 01-2.5 2.5h-13A2.5 2.5 0 013 17.5zM21 16l-5-5-8 8M9 10.4a1.4 1.4 0 100-.01",
  undo: "M9 14L4 9l5-5M4 9h10a6 6 0 010 12h-3",
};
const TOOLS: [Tool, string, string][] = [["select", "Select and move; shift-click to pick several (V)", "V"], ["area", "Select an area of people (S)", "S"], ["hand", "Pan the map (H)", "H"],
  ["text", "Text box: click the map, then type (T)", "T"], ["note", "Sticky note: click the map, then type (N)", "N"], ["work", "Work: something you do with people, with dates (W)", "W"],
  ["pen", "Draw (D)", "D"], ["eraser", "Eraser: click or drag over pen strokes (E)", "E"]];

export function Toolbar({ tool, setTool, onImage, onUndo, canUndo, onPath, pathOpen }: { tool: Tool; setTool: (t: Tool) => void; onImage: () => void; onUndo: () => void; canUndo: boolean; onPath: () => void; pathOpen: boolean }) {
  const icon = (d: string) => <svg viewBox="0 0 24 24" aria-hidden="true"><path d={d} /></svg>;
  return (
    <div className="nwg-ui nwg-tools" role="toolbar" aria-label="Board tools">
      {TOOLS.map(([t, title, k], i) => (
        <span key={t} className="nwg-tool-wrap">{(i === 3 || i === 6) && <span className="sep" />}
          <button type="button" aria-label={title.replace(/ \(.\)$/, "")} title={title} aria-pressed={tool === t} onClick={() => setTool(t)}>{icon(ICON[t])}<kbd>{k}</kbd></button></span>
      ))}
      <button type="button" aria-label="Add an image or GIF" title="Add an image or GIF, or drop one on the map (I)" onClick={onImage}>{icon(ICON.image)}<kbd>I</kbd></button>
      <button type="button" aria-label="Find a path" title="Find the warmest way to reach someone (F)" aria-pressed={pathOpen} onClick={onPath}>{icon(ICON.path)}<kbd>F</kbd></button>
      <span className="sep" />
      <button type="button" aria-label="Undo" title="Undo what you last added (Ctrl or Cmd + Z)" disabled={!canUndo} onClick={onUndo}>{icon(ICON.undo)}</button>
    </div>
  );
}

export function PenBar({ pen, setPen, eraser }: { pen: Pen; setPen: (p: Pen) => void; eraser: boolean }) {
  if (eraser) return <div className="nwg-ui nwg-penbar"><span className="nw-muted">Click or drag over a pen stroke to erase it.</span></div>;
  return (
    <div className="nwg-ui nwg-penbar" role="group" aria-label="Pen">
      {PEN_COLORS.map((c) => <button key={c} type="button" className="dot" style={{ background: c === "ink" ? "var(--nw-ink)" : c }} aria-label={c === "ink" ? "Ink colour" : `Colour ${c}`} aria-pressed={pen.color === c} onClick={() => setPen({ ...pen, color: c })} />)}
      <span className="sep" />
      {PEN_SIZES.map(([label, w, o]) => <button key={label} type="button" className="size" title={label} aria-label={label} aria-pressed={pen.width === w && pen.opacity === o} onClick={() => setPen({ ...pen, width: w, opacity: o })}><i style={{ height: Math.max(2, Math.min(w, 10)), opacity: o < 0.5 ? 0.45 : 1 }} /></button>)}
    </div>
  );
}

/** A text box or sticky note as an HTML box inside the map. The text is edited in place and saved shortly after you stop typing. */
export function BoardBox({ item, x, y, selected, pinnedTo, onText, onColor, onRemove }: { item: BoardItem; x: number; y: number; selected: boolean; pinnedTo: string | null; onText: (t: string) => void; onColor: (c: string) => void; onRemove: () => void }) {
  const body = useRef<HTMLDivElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const latest = useRef(onText);
  useEffect(() => { latest.current = onText; }, [onText]);
  // The text is set once; after that the box owns it while you type (re-rendering it would move the caret).
  useEffect(() => { if (body.current) body.current.textContent = item.text ?? ""; }, [item.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const flush = () => { window.clearTimeout(timer.current); const t = body.current?.textContent ?? ""; if (t !== (item.text ?? "")) latest.current(t); };
  const note = item.kind === "note";
  return (
    <foreignObject x={x} y={y} width={item.w ?? 200} height={item.h ?? 80} className="nwgb-fo" data-board={item.id}>
      <div className={`nwgb${note ? " note" : " text"}${selected ? " sel" : ""}${pinnedTo ? " pinned" : ""}`} style={note ? { background: item.color } : undefined}>
        <div className="nwgb-grip" title="Drag to move. Drop on a person to pin it to them.">
          {pinnedTo && <span className="pn">Pinned to {pinnedTo}</span>}
          <span className="gr" />
          {note && NOTE_COLORS.map((c) => <button key={c} type="button" className="nc" style={{ background: c }} aria-label="Note colour" aria-pressed={item.color === c} onClick={() => onColor(c)} />)}
          <button type="button" className="del" aria-label="Delete" onClick={onRemove}>×</button>
        </div>
        <div ref={body} className="nwgb-body" contentEditable suppressContentEditableWarning role="textbox" aria-multiline="true" aria-label={note ? "Sticky note" : "Text box"} data-ph={note ? "Write a note" : "Type here"}
          onInput={() => { window.clearTimeout(timer.current); timer.current = window.setTimeout(flush, 600); }} onBlur={flush} />
        <i className="nwgb-rz" title="Drag to resize" />
      </div>
    </foreignObject>
  );
}
