import { useState } from "react";
import { SOURCE_TYPES, type SourceType } from "./network";

/** What a source is: one of the kinds, or "Something else…" with a name you type ("Hackathon", "Discord community"). */
export default function KindPicker({ id, type, kindName, onChange }: { id: string; type: SourceType; kindName?: string; onChange: (type: SourceType, kindName: string) => void }) {
  const [custom, setCustom] = useState(type === "other" && Boolean(kindName));
  const [name, setName] = useState(kindName ?? "");
  const commit = () => { if (name.trim() !== (kindName ?? "")) onChange("other", name.trim()); };
  return (
    <>
      <label className="nw-f"><span>Kind</span>
        <select id={id} value={custom ? "__custom" : type} onChange={(e) => { if (e.target.value === "__custom") setCustom(true); else { setCustom(false); setName(""); onChange(e.target.value as SourceType, ""); } }}>
          {SOURCE_TYPES.map(([t, l]) => <option key={t} value={t}>{l}</option>)}
          <option value="__custom">Something else…</option>
        </select></label>
      {custom && <label className="nw-f"><span>What kind is it?</span>
        <input id={`${id}-name`} autoFocus maxLength={30} value={name} placeholder="Hackathon, Discord community, Alumni network…" onChange={(e) => setName(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} /></label>}
    </>
  );
}
