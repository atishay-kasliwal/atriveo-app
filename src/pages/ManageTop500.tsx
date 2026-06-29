import { useState, useCallback, useRef } from "react";
import AppHeader from "../components/AppHeader";
import { useTop500, type Top500Company } from "../context/Top500Context";
import { useAuth } from "../hooks/useAuth";
import "../styles/manage-top500.css";

const ADMIN_EMAIL = "katishay@gmail.com";

interface Draft {
  name: string;
  domain: string;
  ticker: string;
  sector: string;
}

const EMPTY_DRAFT: Draft = { name: "", domain: "", ticker: "", sector: "" };

export default function ManageTop500() {
  const { user } = useAuth();
  const { companies, loading, reload } = useTop500();
  const [q, setQ] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [editId, setEditId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Draft>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: "ok" | "err" } | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const isAdmin = user?.email === ADMIN_EMAIL;

  const filtered = companies.filter((c) => {
    if (!q.trim()) return true;
    const s = q.toLowerCase();
    return (
      c.name.toLowerCase().includes(s) ||
      (c.domain ?? "").toLowerCase().includes(s) ||
      (c.ticker ?? "").toLowerCase().includes(s) ||
      (c.sector ?? "").toLowerCase().includes(s)
    );
  });

  function showToast(msg: string, type: "ok" | "err" = "ok") {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  }

  function patchDraft(key: keyof Draft, val: string) {
    setDraft((d) => ({ ...d, [key]: val }));
  }

  function patchEdit(key: keyof Draft, val: string) {
    setEditDraft((d) => ({ ...d, [key]: val }));
  }

  function openAdd() {
    setDraft(EMPTY_DRAFT);
    setAddOpen(true);
    setTimeout(() => nameRef.current?.focus(), 50);
  }

  function cancelAdd() {
    setAddOpen(false);
    setDraft(EMPTY_DRAFT);
  }

  function startEdit(c: Top500Company) {
    setEditId(c.id);
    setEditDraft({ name: c.name, domain: c.domain ?? "", ticker: c.ticker ?? "", sector: c.sector ?? "" });
  }

  function cancelEdit() {
    setEditId(null);
    setEditDraft(EMPTY_DRAFT);
  }

  const handleAdd = async () => {
    if (!draft.name.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/top500", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      if (!res.ok) {
        const d = await res.json() as { error: string };
        throw new Error(d.error);
      }
      cancelAdd();
      reload();
      showToast(`Added "${draft.name}"`);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Failed to add", "err");
    } finally {
      setSaving(false);
    }
  };

  const handleUpdate = async () => {
    if (!editId || !editDraft.name.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/top500", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: editId, ...editDraft }),
      });
      if (!res.ok) {
        const d = await res.json() as { error: string };
        throw new Error(d.error);
      }
      cancelEdit();
      reload();
      showToast("Saved");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Failed to save", "err");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    setDeletingId(id);
    try {
      const res = await fetch(`/api/top500?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!res.ok) {
        const d = await res.json() as { error: string };
        throw new Error(d.error);
      }
      reload();
      showToast(`Deleted "${name}"`);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Failed to delete", "err");
    } finally {
      setDeletingId(null);
    }
  };

  const exportCSV = useCallback(() => {
    const rows = [["name", "domain", "ticker", "sector"].join(",")];
    for (const c of companies) {
      rows.push([c.name, c.domain ?? "", c.ticker ?? "", c.sector ?? ""]
        .map((v) => `"${v.replace(/"/g, '""')}"`)
        .join(","));
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
    setSaving(true);
    try {
      const text = await file.text();
      const lines = text.trim().split("\n").slice(1);
      const parsed = lines
        .map((l) => {
          const cols = l.split(",").map((c) => c.replace(/^"|"$/g, "").replace(/""/g, '"'));
          return { name: cols[0] ?? "", domain: cols[1] ?? "", ticker: cols[2] ?? "", sector: cols[3] ?? "" };
        })
        .filter((c) => c.name.trim());
      const res = await fetch("/api/top500?action=seed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companies: parsed }),
      });
      if (!res.ok) {
        const d = await res.json() as { error: string };
        throw new Error(d.error);
      }
      const result = await res.json() as { inserted: number; skipped: number };
      reload();
      showToast(`Imported ${result.inserted} companies (${result.skipped} skipped)`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Import failed", "err");
    } finally {
      setSaving(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }, [reload]);

  return (
    <div className="t5-page">
      <AppHeader />

      <div className="t5-wrap">
        {/* Header bar */}
        <div className="t5-header">
          <div className="t5-title-group">
            <h1 className="t5-title">Top 500 Companies</h1>
            <span className="t5-count">{companies.length} entries</span>
          </div>
          {isAdmin && (
            <div className="t5-actions">
              <button className="t5-btn t5-btn--ghost" onClick={exportCSV} disabled={saving}>
                Export CSV
              </button>
              <label className="t5-btn t5-btn--ghost" style={{ cursor: "pointer" }}>
                Import CSV
                <input ref={fileRef} type="file" accept=".csv" onChange={importCSV} style={{ display: "none" }} />
              </label>
              <button className="t5-btn t5-btn--primary" onClick={openAdd} disabled={saving}>
                + Add Company
              </button>
            </div>
          )}
        </div>

        {/* Search */}
        <div className="t5-search-wrap">
          <svg className="t5-search-icon" width="14" height="14" viewBox="0 0 14 14" fill="none">
            <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.4" />
            <path d="M9.5 9.5L12.5 12.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
          <input
            className="t5-search"
            placeholder="Search by name, domain, ticker, or sector…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {q && (
            <button className="t5-search-clear" onClick={() => setQ("")} aria-label="Clear">×</button>
          )}
        </div>

        {/* Add row */}
        {addOpen && isAdmin && (
          <div className="t5-add-panel">
            <div className="t5-add-fields">
              <div className="t5-field">
                <label className="t5-label">Name *</label>
                <input
                  ref={nameRef}
                  className="t5-input"
                  value={draft.name}
                  onChange={(e) => patchDraft("name", e.target.value)}
                  placeholder="e.g. Apple"
                  onKeyDown={(e) => e.key === "Enter" && handleAdd()}
                />
              </div>
              <div className="t5-field">
                <label className="t5-label">Domain</label>
                <input
                  className="t5-input"
                  value={draft.domain}
                  onChange={(e) => patchDraft("domain", e.target.value)}
                  placeholder="apple.com"
                />
              </div>
              <div className="t5-field t5-field--sm">
                <label className="t5-label">Ticker</label>
                <input
                  className="t5-input"
                  value={draft.ticker}
                  onChange={(e) => patchDraft("ticker", e.target.value)}
                  placeholder="AAPL"
                />
              </div>
              <div className="t5-field">
                <label className="t5-label">Sector</label>
                <input
                  className="t5-input"
                  value={draft.sector}
                  onChange={(e) => patchDraft("sector", e.target.value)}
                  placeholder="Technology"
                />
              </div>
            </div>
            <div className="t5-add-footer">
              <button className="t5-btn t5-btn--ghost" onClick={cancelAdd}>Cancel</button>
              <button
                className="t5-btn t5-btn--primary"
                onClick={handleAdd}
                disabled={saving || !draft.name.trim()}
              >
                {saving ? "Adding…" : "Add"}
              </button>
            </div>
          </div>
        )}

        {/* Table */}
        {loading ? (
          <div className="t5-empty">Loading…</div>
        ) : (
          <div className="t5-table-wrap">
            <table className="t5-table">
              <thead>
                <tr>
                  <th className="t5-th t5-th--name">Company</th>
                  <th className="t5-th">Domain</th>
                  <th className="t5-th t5-th--sm">Ticker</th>
                  <th className="t5-th">Sector</th>
                  {isAdmin && <th className="t5-th t5-th--actions" />}
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) =>
                  editId === c.id ? (
                    <tr key={c.id} className="t5-tr t5-tr--editing">
                      <td className="t5-td">
                        <input
                          className="t5-input t5-input--inline"
                          value={editDraft.name}
                          onChange={(e) => patchEdit("name", e.target.value)}
                          onKeyDown={(e) => e.key === "Enter" && handleUpdate()}
                          autoFocus
                        />
                      </td>
                      <td className="t5-td">
                        <input
                          className="t5-input t5-input--inline"
                          value={editDraft.domain}
                          onChange={(e) => patchEdit("domain", e.target.value)}
                          onKeyDown={(e) => e.key === "Enter" && handleUpdate()}
                        />
                      </td>
                      <td className="t5-td">
                        <input
                          className="t5-input t5-input--inline t5-input--sm"
                          value={editDraft.ticker}
                          onChange={(e) => patchEdit("ticker", e.target.value)}
                          onKeyDown={(e) => e.key === "Enter" && handleUpdate()}
                        />
                      </td>
                      <td className="t5-td">
                        <input
                          className="t5-input t5-input--inline"
                          value={editDraft.sector}
                          onChange={(e) => patchEdit("sector", e.target.value)}
                          onKeyDown={(e) => e.key === "Enter" && handleUpdate()}
                        />
                      </td>
                      <td className="t5-td t5-td--actions">
                        <button
                          className="t5-btn t5-btn--save"
                          onClick={handleUpdate}
                          disabled={saving || !editDraft.name.trim()}
                        >
                          {saving ? "…" : "Save"}
                        </button>
                        <button className="t5-btn t5-btn--ghost t5-btn--sm" onClick={cancelEdit}>
                          Cancel
                        </button>
                      </td>
                    </tr>
                  ) : (
                    <tr key={c.id} className="t5-tr">
                      <td className="t5-td t5-td--name">{c.name}</td>
                      <td className="t5-td t5-td--muted">{c.domain ?? <span className="t5-empty-cell">—</span>}</td>
                      <td className="t5-td t5-td--mono">{c.ticker ?? <span className="t5-empty-cell">—</span>}</td>
                      <td className="t5-td t5-td--muted">{c.sector ?? <span className="t5-empty-cell">—</span>}</td>
                      {isAdmin && (
                        <td className="t5-td t5-td--actions">
                          <button className="t5-btn t5-btn--ghost t5-btn--sm" onClick={() => startEdit(c)}>
                            Edit
                          </button>
                          <button
                            className="t5-btn t5-btn--danger t5-btn--sm"
                            onClick={() => handleDelete(c.id, c.name)}
                            disabled={deletingId === c.id}
                          >
                            {deletingId === c.id ? "…" : "Delete"}
                          </button>
                        </td>
                      )}
                    </tr>
                  )
                )}
                {!filtered.length && !loading && (
                  <tr>
                    <td className="t5-empty-row" colSpan={isAdmin ? 5 : 4}>
                      {q ? `No results for "${q}"` : "No companies yet — add one or import CSV"}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Toast */}
      {toast && (
        <div className={`t5-toast t5-toast--${toast.type}`}>{toast.msg}</div>
      )}
    </div>
  );
}
