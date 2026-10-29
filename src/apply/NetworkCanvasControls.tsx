import type { ReactNode } from 'react';

const paths = {
  layers: 'm12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5',
  search: 'M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13Zm5-1 5 5',
  add: 'M12 5v14M5 12h14',
  map: 'm3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2V5Zm6-2v16m6-14v16',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  jobs: 'M9 7V4h6v3M3 7h18v13H3V7Zm0 5 9 3 9-3M12 12v5',
  person: 'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM4 21v-2a8 8 0 0 1 16 0v2',
  source: 'M4 21V5l8-2v18M12 9h8v12M7 8h2M7 12h2M7 16h2M16 13h1M16 17h1M2 21h20',
  import: 'M12 3v12m-4-4 4 4 4-4M4 16v5h16v-5',
  stack: 'M5 7h14v14H5V7Zm2-4h10M3 5h18',
  calendar: 'M4 6h16v15H4V6Zm0 4h16M8 3v4m8-4v4',
} as const;
export function CanvasIcon({ name }: { name: keyof typeof paths }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d={paths[name]} /></svg>;
}
export function CanvasButton({ label, icon, active, expanded, controls, onClick }: { label: string; icon: keyof typeof paths; active?: boolean; expanded?: boolean; controls?: string; onClick: () => void }) {
  return <button type="button" className="nw-canvas-button" aria-label={label} title={label} aria-pressed={active} aria-expanded={expanded} aria-controls={controls} onClick={onClick}><CanvasIcon name={icon} /></button>;
}
export function CanvasMenuAction({ icon, children, onClick }: { icon: keyof typeof paths; children: ReactNode; onClick: () => void }) {
  return <button type="button" className="nw-canvas-menu-action" onClick={onClick}><CanvasIcon name={icon} /><span>{children}</span></button>;
}
