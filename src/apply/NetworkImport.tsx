import NetworkSourceContext from "./NetworkSourceContext";
import { useEffect, useState } from "react";
import { post, sourceLabel, throughFields, SOURCE_TYPES, type Person, type Source, type SourceType } from "./network";

interface Row { name: string; email: string; phone: string; company: string; role: string; city: string; linkedin: string; exists: boolean }

/**
 * Import people from a contacts file: LinkedIn connections (Connections.csv) or a Google Contacts export. A preview first; people
 * already in your network are skipped; names, emails, companies, titles and LinkedIn links come along. Big files go in parts of 500.
 */
export default function NetworkImport({ sources, people, onClose, onDone }: { sources: Source[]; people: Person[]; onClose: () => void; onDone: (msg: string, sourceId: string | null) => void }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [format, setFormat] = useState("");
  const [file, setFile] = useState("");
  const [source, setSource] = useState("__new");
  const [newName, setNewName] = useState("");
  const [newParent, setNewParent] = useState(""); const [newContext, setNewContext] = useState("");
  const [newType, setNewType] = useState<SourceType>("other");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) onClose(); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose, busy]);
  async function read(f: File) {
    setError(""); setRows(null);
    if (f.size > 6_000_000) { setError("That file is over 6 MB. Export fewer contacts, or split it."); return; }
    setFile(f.name); setBusy("Reading…");
    try {
      const r = await post<{ format: string; rows: Row[] }>("import/preview", { text: await f.text() });
      setRows(r.rows); setFormat(r.format); setNewName(r.format === "linkedin" ? "LinkedIn connections" : "Google contacts");
    } catch (e) { setError(String((e as Error).message)); } finally { setBusy(""); }
  }
  const fresh = (rows ?? []).filter((r) => !r.exists);
  async function add() {
    setError("");
    try {
      let sourceId: string | null = source === "__new" ? null : source || null, added = 0, skipped = 0;
      for (let i = 0; i < fresh.length; i += 500) {
        setBusy(`Adding ${Math.min(i + 500, fresh.length)} of ${fresh.length}…`);
        const part = fresh.slice(i, i + 500).map((r) => ({ name: r.name, email: r.email, phone: r.phone, company: r.company, role: r.role, city: r.city, linkedin: r.linkedin }));
        const r = await post<{ added: unknown[]; skipped: string[]; sourceId: string | null }>("people", { rows: part, ...(sourceId ? { sourceId } : source === "__new" ? { newSource: { name: newName, type: newType, ...throughFields(newParent), context: newContext } } : {}) });
        added += r.added.length; skipped += r.skipped.length; sourceId = r.sourceId ?? sourceId;
      }
      onDone(`Imported ${added} ${added === 1 ? "person" : "people"}${skipped ? `, skipped ${skipped} already here` : ""}.`, sourceId);
    } catch (e) { setError(String((e as Error).message)); setBusy(""); }
  }
  return (
    <div className="nw-dim" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="nw-dialog wide" role="dialog" aria-modal="true" aria-label="Import contacts">
        <div className="nw-dh"><div><h2>Import contacts</h2><p>From LinkedIn or Google. People already in your network are skipped.</p></div><button type="button" className="nw-x" aria-label="Close" onClick={onClose} disabled={Boolean(busy)}>×</button></div>
        {!rows && <div className="nwi-how">
          <div><b>LinkedIn connections</b><ol><li>LinkedIn, Me, Settings and privacy, Data privacy</li><li>Get a copy of your data, pick Connections, Request archive</li><li>LinkedIn emails a link (usually within minutes); the file is Connections.csv</li></ol></div>
          <div><b>Google contacts</b><ol><li>Open contacts.google.com</li><li>Export, then Google CSV</li><li>The file is contacts.csv</li></ol></div>
        </div>}
        <label className="nwi-drop" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) void read(f); }}>
          <input type="file" accept=".csv,text/csv" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void read(f); }} />
          <span>{file ? <>Read <b>{file}</b>{format ? ` (${format === "linkedin" ? "LinkedIn connections" : "Google contacts"})` : ""}. Choose another file</> : "Choose or drop Connections.csv or contacts.csv"}</span>
        </label>
        {rows && <>
          <p className="nwi-sum"><b>{fresh.length}</b> new {fresh.length === 1 ? "person" : "people"}{rows.length - fresh.length ? `, ${rows.length - fresh.length} already here` : ""}.</p>
          <div className="nwi-prev"><table><thead><tr><th>Name</th><th>Company</th><th>Title</th><th>Email</th></tr></thead><tbody>
            {rows.slice(0, 200).map((r, i) => <tr key={i} className={r.exists ? "skip" : ""}><td>{r.name}</td><td>{r.company}</td><td>{r.role}</td><td>{r.exists ? "already here" : r.email}</td></tr>)}
          </tbody></table>{rows.length > 200 && <p className="nw-muted">And {rows.length - 200} more.</p>}</div>
          <div className="nw-pick">
            <label className="nw-f"><span>Put them in</span><select id="nwi-source" value={source} onChange={(e) => setSource(e.target.value)}><option value="__new">A new source…</option><option value="">No source</option>{sources.map((s) => <option key={s.id} value={s.id}>{sourceLabel(s, sources, people)}</option>)}</select></label>
            {source === "__new" && <><label className="nw-f"><span>Source name</span><input id="nwi-new-name" value={newName} onChange={(e) => setNewName(e.target.value)} /></label>
              <label className="nw-f"><span>Kind</span><select id="nwi-new-type" value={newType} onChange={(e) => setNewType(e.target.value as SourceType)}>{SOURCE_TYPES.map(([t, l]) => <option key={t} value={t}>{l}</option>)}</select></label><NetworkSourceContext sources={sources} people={people} parentSourceId={newParent} onParent={setNewParent} context={newContext} onContext={setNewContext} prefix="nwi-new" /></>}
          </div>
          <p className="nw-muted">Each person keeps their own company as "Works at", so the Jobs tab and job cards find them.</p>
        </>}
        {error && <p className="nw-error" role="alert">{error}</p>}
        <div className="nw-df"><span className="nw-muted">{busy}</span><span className="grow" /><button type="button" className="nw-btn" onClick={onClose} disabled={Boolean(busy)}>Cancel</button>
          <button type="button" className="nw-btn main" disabled={!fresh.length || Boolean(busy) || (source === "__new" && !newName.trim())} onClick={() => void add()}>{fresh.length ? `Import ${fresh.length}` : "Import"}</button></div>
      </div>
    </div>
  );
}
