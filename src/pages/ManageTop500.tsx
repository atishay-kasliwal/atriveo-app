import { useState, useCallback } from "react";
import AppHeader from "../components/AppHeader";
import { useTop500, type Top500Company } from "../context/Top500Context";
import { useAuth } from "../hooks/useAuth";

const ADMIN_EMAIL = "katishay@gmail.com";

interface EditState {
  id: string;
  name: string;
  domain: string;
  ticker: string;
  sector: string;
}

export default function ManageTop500() {
  const { user } = useAuth();
  const { companies, loading, reload } = useTop500();
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDomain, setNewDomain] = useState("");
  const [newTicker, setNewTicker] = useState("");
  const [newSector, setNewSector] = useState("");
  const [editState, setEditState] = useState<EditState | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const isAdmin = user?.email === ADMIN_EMAIL;

  const filtered = companies.filter((c) => {
    if (!q) return true;
    const s = q.toLowerCase();
    return (
      c.name.toLowerCase().includes(s) ||
      (c.domain ?? "").toLowerCase().includes(s) ||
      (c.ticker ?? "").toLowerCase().includes(s) ||
      (c.sector ?? "").toLowerCase().includes(s)
    );
  });

  const handleAdd = async () => {
    if (!newName.trim()) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/top500", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName, domain: newDomain, ticker: newTicker, sector: newSector }),
      });
      if (!res.ok) {
        const d = await res.json() as { error: string };
        throw new Error(d.error ?? "Failed to add");
      }
      setNewName(""); setNewDomain(""); setNewTicker(""); setNewSector("");
      setAdding(false);
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add");
    } finally {
      setSaving(false);
    }
  };

  const handleUpdate = async () => {
    if (!editState) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/top500", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editState),
      });
      if (!res.ok) {
        const d = await res.json() as { error: string };
        throw new Error(d.error ?? "Failed to update");
      }
      setEditState(null);
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm("Delete this company?")) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/top500?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!res.ok) {
        const d = await res.json() as { error: string };
        throw new Error(d.error ?? "Failed to delete");
      }
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete");
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (c: Top500Company) => {
    setEditState({ id: c.id, name: c.name, domain: c.domain ?? "", ticker: c.ticker ?? "", sector: c.sector ?? "" });
  };

  const exportCSV = useCallback(() => {
    const rows = [["name", "domain", "ticker", "sector"].join(",")];
    for (const c of companies) {
      rows.push([c.name, c.domain ?? "", c.ticker ?? "", c.sector ?? ""].map((v) => `"${v.replace(/"/g, '""')}"`).join(","));
    }
    const blob = new Blob([rows.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "top500.csv"; a.click();
    URL.revokeObjectURL(url);
  }, [companies]);

  const importCSV = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const lines = text.trim().split("\n").slice(1);
    const parsed = lines.map((l) => {
      const cols = l.split(",").map((c) => c.replace(/^"|"$/g, "").replace(/""/g, '"'));
      return { name: cols[0], domain: cols[1], ticker: cols[2], sector: cols[3] };
    }).filter((c) => c.name);
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/top500?action=seed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companies: parsed }),
      });
      if (!res.ok) {
        const d = await res.json() as { error: string };
        throw new Error(d.error ?? "Failed to import");
      }
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to import");
    } finally {
      setSaving(false);
      e.target.value = "";
    }
  }, [reload]);

  return (
    <div>
      <AppHeader />
      <div className="page-content" style={{ maxWidth: 900, margin: "0 auto", padding: "1.5rem 1rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "1rem", marginBottom: "1.25rem", flexWrap: "wrap" }}>
          <h1 style={{ margin: 0, fontSize: "1.25rem", fontWeight: 600 }}>Manage Top 500</h1>
          <span style={{ color: "var(--muted-foreground)", fontSize: "0.85rem" }}>{companies.length} companies</span>
          <div style={{ marginLeft: "auto", display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            {isAdmin && (
              <>
                <button className="btn btn-secondary" onClick={exportCSV}>Export CSV</button>
                <label className="btn btn-secondary" style={{ cursor: "pointer" }}>
                  Import CSV
                  <input type="file" accept=".csv" onChange={importCSV} style={{ display: "none" }} />
                </label>
                <button className="btn btn-primary" onClick={() => setAdding(true)}>+ Add Company</button>
              </>
            )}
          </div>
        </div>

        {error && <div style={{ color: "var(--destructive)", marginBottom: "0.75rem", fontSize: "0.85rem" }}>{error}</div>}

        <input
          className="search-input"
          placeholder="Search by name, domain, ticker, sector…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ width: "100%", marginBottom: "1rem" }}
        />

        {adding && isAdmin && (
          <div className="card" style={{ padding: "1rem", marginBottom: "1rem", display: "grid", gridTemplateColumns: "1fr 1fr 120px 1fr", gap: "0.5rem", alignItems: "end" }}>
            <div>
              <label style={{ fontSize: "0.75rem", color: "var(--muted-foreground)" }}>Name *</label>
              <input className="search-input" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Apple" style={{ width: "100%" }} />
            </div>
            <div>
              <label style={{ fontSize: "0.75rem", color: "var(--muted-foreground)" }}>Domain</label>
              <input className="search-input" value={newDomain} onChange={(e) => setNewDomain(e.target.value)} placeholder="apple.com" style={{ width: "100%" }} />
            </div>
            <div>
              <label style={{ fontSize: "0.75rem", color: "var(--muted-foreground)" }}>Ticker</label>
              <input className="search-input" value={newTicker} onChange={(e) => setNewTicker(e.target.value)} placeholder="AAPL" style={{ width: "100%" }} />
            </div>
            <div>
              <label style={{ fontSize: "0.75rem", color: "var(--muted-foreground)" }}>Sector</label>
              <input className="search-input" value={newSector} onChange={(e) => setNewSector(e.target.value)} placeholder="Technology" style={{ width: "100%" }} />
            </div>
            <div style={{ gridColumn: "1/-1", display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
              <button className="btn btn-secondary" onClick={() => setAdding(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleAdd} disabled={saving || !newName.trim()}>Add</button>
            </div>
          </div>
        )}

        {loading ? (
          <div style={{ textAlign: "center", padding: "2rem", color: "var(--muted-foreground)" }}>Loading…</div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid var(--border)" }}>
                <th style={{ padding: "0.5rem 0.75rem", fontWeight: 600 }}>Name</th>
                <th style={{ padding: "0.5rem 0.75rem", fontWeight: 600 }}>Domain</th>
                <th style={{ padding: "0.5rem 0.75rem", fontWeight: 600 }}>Ticker</th>
                <th style={{ padding: "0.5rem 0.75rem", fontWeight: 600 }}>Sector</th>
                {isAdmin && <th style={{ padding: "0.5rem 0.75rem" }}></th>}
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                editState?.id === c.id ? (
                  <tr key={c.id} style={{ background: "var(--muted)" }}>
                    <td style={{ padding: "0.25rem 0.5rem" }}>
                      <input className="search-input" value={editState.name} onChange={(e) => setEditState({ ...editState, name: e.target.value })} />
                    </td>
                    <td style={{ padding: "0.25rem 0.5rem" }}>
                      <input className="search-input" value={editState.domain} onChange={(e) => setEditState({ ...editState, domain: e.target.value })} />
                    </td>
                    <td style={{ padding: "0.25rem 0.5rem" }}>
                      <input className="search-input" value={editState.ticker} onChange={(e) => setEditState({ ...editState, ticker: e.target.value })} style={{ width: 80 }} />
                    </td>
                    <td style={{ padding: "0.25rem 0.5rem" }}>
                      <input className="search-input" value={editState.sector} onChange={(e) => setEditState({ ...editState, sector: e.target.value })} />
                    </td>
                    <td style={{ padding: "0.25rem 0.5rem", whiteSpace: "nowrap" }}>
                      <button className="btn btn-primary btn-xs" onClick={handleUpdate} disabled={saving}>Save</button>{" "}
                      <button className="btn btn-secondary btn-xs" onClick={() => setEditState(null)}>×</button>
                    </td>
                  </tr>
                ) : (
                  <tr key={c.id} style={{ borderBottom: "1px solid var(--border)" }}>
                    <td style={{ padding: "0.5rem 0.75rem" }}>{c.name}</td>
                    <td style={{ padding: "0.5rem 0.75rem", color: "var(--muted-foreground)" }}>{c.domain ?? "—"}</td>
                    <td style={{ padding: "0.5rem 0.75rem", fontFamily: "monospace" }}>{c.ticker ?? "—"}</td>
                    <td style={{ padding: "0.5rem 0.75rem", color: "var(--muted-foreground)" }}>{c.sector ?? "—"}</td>
                    {isAdmin && (
                      <td style={{ padding: "0.5rem 0.75rem", whiteSpace: "nowrap" }}>
                        <button className="btn btn-secondary btn-xs" onClick={() => startEdit(c)}>Edit</button>{" "}
                        <button className="btn btn-destructive btn-xs" onClick={() => handleDelete(c.id)}>Del</button>
                      </td>
                    )}
                  </tr>
                )
              ))}
              {!filtered.length && (
                <tr><td colSpan={isAdmin ? 5 : 4} style={{ padding: "2rem", textAlign: "center", color: "var(--muted-foreground)" }}>No results</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
