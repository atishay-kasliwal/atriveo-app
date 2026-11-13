import { useEffect, useState } from "react";
import { TOOL_ICON as ICON, type Tool } from "./network";

// The map's controls on a phone: one dock at the bottom for what you do with people (move, add, note, find a path),
// with drawing, views and export in the More sheet. One finger pans, two pinch to zoom; Fit and Undo float above the dock.

export type PhoneMenu = { onAdd: () => void; onLayers: () => void; onList: () => void; onJobs: () => void; onCalendar: () => void };

const icon = (d: string) => <svg viewBox="0 0 24 24" aria-hidden="true"><path d={d} /></svg>;
const PLUS = "M12 5v14M5 12h14", MORE = "M5 12h.01M12 12h.01M19 12h.01", FIT = "M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5";
const LAYERS = "M12 4l9 5-9 5-9-5zM3 14l9 5 9-5", LIST = "M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01";
const JOBS = "M3 8.5A1.5 1.5 0 014.5 7h15A1.5 1.5 0 0121 8.5v10a1.5 1.5 0 01-1.5 1.5h-15A1.5 1.5 0 013 18.5zM9 7V5.5A1.5 1.5 0 0110.5 4h3A1.5 1.5 0 0115 5.5V7";
const CAL = "M5 6h14v14H5zM5 10h14M9 4v4M15 4v4", EXPORT = "M12 4v11M7 9l5-5 5 5M5 15v4h14v-4";
const DRAW_TOOLS: [Tool, string][] = [["text", "Text"], ["pen", "Draw"], ["eraser", "Eraser"], ["work", "Work card"], ["area", "Select several"]];

export default function NetworkPhoneDock({ tool, setTool, onImage, onUndo, canUndo, onPath, pathOpen, onFit, onExport, menu }: {
  tool: Tool; setTool: (t: Tool) => void; onImage: () => void; onUndo: () => void; canUndo: boolean; onPath: () => void; pathOpen: boolean;
  onFit: () => void; onExport: () => void; menu: PhoneMenu;
}) {
  const [more, setMore] = useState(false);
  useEffect(() => {
    if (!more) return;
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setMore(false); };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [more]);
  const pick = (run: () => void) => () => { setMore(false); run(); };
  // A drawing tool shows itself in the dock's last slot, so it is clear what a touch on the map does and how to stop.
  const drawing = DRAW_TOOLS.find(([t]) => t === tool);
  return (
    <>
      <div className="nwg-ui nwp-float">
        {canUndo && <button type="button" aria-label="Undo" onClick={onUndo}>{icon(ICON.undo)}</button>}
        <button type="button" aria-label="Fit the map" onClick={onFit}>{icon(FIT)}</button>
      </div>
      <nav className="nwg-ui nwp-dock" aria-label="Map tools">
        <button type="button" aria-pressed={tool === "select"} onClick={() => setTool("select")}>{icon(ICON.select)}<span>Move</span></button>
        <button type="button" onClick={menu.onAdd}>{icon(PLUS)}<span>Add</span></button>
        <button type="button" aria-pressed={tool === "note"} onClick={() => setTool(tool === "note" ? "select" : "note")}>{icon(ICON.note)}<span>Note</span></button>
        <button type="button" aria-pressed={pathOpen} onClick={onPath}>{icon(ICON.path)}<span>Path</span></button>
        {drawing
          ? <button type="button" className="is-tool" aria-pressed="true" aria-label={`${drawing[1]}: tap to stop`} onClick={() => setTool("select")}>{icon(ICON[drawing[0]])}<span>Done</span></button>
          : <button type="button" aria-expanded={more} aria-haspopup="dialog" onClick={() => setMore(true)}>{icon(MORE)}<span>More</span></button>}
      </nav>
      {more && (
        <div className="nwg-ui nwp-sheet-wrap" onClick={() => setMore(false)}>
          <div className="nwp-sheet" role="dialog" aria-modal="true" aria-label="More on the map" onClick={(e) => e.stopPropagation()}>
            <i className="nwp-grab" aria-hidden="true" />
            <h2>Draw on the map</h2>
            <div className="nwp-grid">
              {DRAW_TOOLS.map(([t, label]) => <button key={t} type="button" onClick={pick(() => setTool(t))}>{icon(ICON[t])}<span>{label}</span></button>)}
              <button type="button" onClick={pick(onImage)}>{icon(ICON.image)}<span>Image</span></button>
            </div>
            <h2>See it another way</h2>
            <div className="nwp-grid">
              <button type="button" onClick={pick(menu.onLayers)}>{icon(LAYERS)}<span>Layers & filters</span></button>
              <button type="button" onClick={pick(menu.onList)}>{icon(LIST)}<span>People list</span></button>
              <button type="button" onClick={pick(menu.onJobs)}>{icon(JOBS)}<span>Jobs</span></button>
              <button type="button" onClick={pick(menu.onCalendar)}>{icon(CAL)}<span>Calendar</span></button>
              <button type="button" onClick={pick(onExport)}>{icon(EXPORT)}<span>Export</span></button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
