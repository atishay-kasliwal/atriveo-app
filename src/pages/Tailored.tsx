import { useCallback, useEffect, useMemo, useState } from "react";
import AppHeader from "../components/AppHeader";
import PageIntro from "../components/PageIntro";
import ResumeHistoryCard from "../components/ResumeHistoryCard";
import { useApplyTracker } from "../hooks/useApplyTracker";
import { openTailorPath, listTailoredResumes, type TailoredResumeOnDisk } from "../utils/tailorRun";
import { loadJobDescriptions } from "../utils/jobDescriptionBuckets";

const TZ = "America/New_York";

type GroupMode = "flat" | "company";

function companyKey(r: TailoredResumeOnDisk): string {
  return r.company.trim().toLowerCase() || r.dir;
}

function findPreviousCompile(list: TailoredResumeOnDisk[], index: number): TailoredResumeOnDisk | null {
  const key = companyKey(list[index]);
  for (let i = index + 1; i < list.length; i++) {
    if (companyKey(list[i]) === key) return list[i];
  }
  return null;
}

export default function Tailored() {
  const { recordClick, getRecord } = useApplyTracker();
  const [resumes, setResumes] = useState<TailoredResumeOnDisk[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [groupMode, setGroupMode] = useState<GroupMode>("flat");
  const [openJd, setOpenJd] = useState<string | null>(null);
  const [jdText, setJdText] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const list = await listTailoredResumes();
    setResumes(list);
    setError(list.length === 0 ? "No resumes found on your Mac — is the tailor server running (npm run tailor)?" : "");
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => { void refresh(); }, 60_000);
    return () => window.clearInterval(id);
  }, [refresh]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return resumes;
    return resumes.filter((r) => r.company.toLowerCase().includes(q) || r.title.toLowerCase().includes(q));
  }, [resumes, query]);

  const displayList = useMemo(() => {
    if (groupMode === "flat") return filtered;
    const byCompany = new Map<string, TailoredResumeOnDisk[]>();
    for (const r of filtered) {
      const k = companyKey(r);
      const arr = byCompany.get(k) || [];
      arr.push(r);
      byCompany.set(k, arr);
    }
    return [...byCompany.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .flatMap(([, items]) => items.sort((a, b) => new Date(b.tailoredAt || 0).getTime() - new Date(a.tailoredAt || 0).getTime()));
  }, [filtered, groupMode]);

  const firstInGroup = useMemo(() => {
    const set = new Set<string>();
    const map = new Map<string, boolean>();
    for (const r of displayList) {
      const k = companyKey(r);
      if (!set.has(k)) {
        set.add(k);
        map.set(r.dir, true);
      }
    }
    return map;
  }, [displayList]);

  useEffect(() => {
    if (!openJd) return;
    const rec = resumes.find((r) => r.dir === openJd);
    if (!rec?.jobUrl || jdText[openJd] != null) return;
    let cancelled = false;
    loadJobDescriptions([{ job_url: rec.jobUrl } as Parameters<typeof loadJobDescriptions>[0][number]])
      .then((byUrl) => { if (!cancelled) setJdText((p) => ({ ...p, [openJd]: byUrl[rec.jobUrl] || "" })); })
      .catch(() => { if (!cancelled) setJdText((p) => ({ ...p, [openJd]: "" })); });
    return () => { cancelled = true; };
  }, [openJd, resumes, jdText]);

  const todayCount = useMemo(() => {
    const today = new Date().toLocaleDateString("en-US", { timeZone: TZ });
    return resumes.filter((r) => r.tailoredAt && new Date(r.tailoredAt).toLocaleDateString("en-US", { timeZone: TZ }) === today).length;
  }, [resumes]);

  const handleApply = (r: TailoredResumeOnDisk) => {
    if (r.jobUrl) {
      recordClick(r.jobUrl, r.title, r.company, {});
      window.open(r.jobUrl, "_blank", "noopener");
    }
  };

  const handleCopyJd = async (key: string) => {
    const text = jdText[key];
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      window.setTimeout(() => setCopied((k) => (k === key ? null : k)), 1500);
    } catch { /* clipboard blocked */ }
  };

  return (
    <div>
      <AppHeader />
      <div className="wrapper page-shell page-shell-wide tailored-page">
        <PageIntro
          compact
          kicker="Resumes"
          title="Compile history"
          description="Git-style log of every PDF the evidence compiler created. Compare compiles with Diff, review Explain artifacts, track identity and information gain per run."
          stats={[
            { label: "Compiled", value: resumes.length, tone: "green" },
            { label: "Today", value: todayCount, tone: "blue" },
            { label: "Visible", value: filtered.length, tone: "orange" },
          ]}
        />

        <div className="top-bar tailored-toolbar">
          <div className="search-wrap">
            <span className="search-icon">⌕</span>
            <input
              className="search-input"
              type="search"
              placeholder="Search compiles…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <button
            type="button"
            className={`sort-btn${groupMode === "company" ? " is-active" : ""}`}
            onClick={() => setGroupMode((m) => (m === "flat" ? "company" : "flat"))}
          >
            {groupMode === "company" ? "Grouped" : "Group by company"}
          </button>
          <button type="button" className="sort-btn" onClick={() => void refresh()}>↻ Refresh</button>
          <a href="/" className="sort-btn">← Feed</a>
        </div>

        {loading && resumes.length === 0 ? (
          <div className="tailored-empty">Loading compiles from your Mac…</div>
        ) : displayList.length === 0 ? (
          <div className="tailored-empty">{error || "No compiles match your search."}</div>
        ) : (
          <ul className="resume-history-list" aria-label="Compile history">
            {displayList.map((r, index) => (
              <ResumeHistoryCard
                key={r.dir}
                resume={r}
                previous={findPreviousCompile(displayList, index)}
                applied={r.jobUrl ? getRecord(r.jobUrl) : null}
                isFirstInGroup={firstInGroup.get(r.dir)}
                showCompanyHeader={groupMode === "company"}
                onOpenPdf={() => { void openTailorPath(r.pdfPath); }}
                onApply={() => handleApply(r)}
                onToggleJd={() => setOpenJd(openJd === r.dir ? null : r.dir)}
                jdOpen={openJd === r.dir}
                jdContent={jdText[r.dir]}
                jdLoading={openJd === r.dir && jdText[r.dir] == null && Boolean(r.jobUrl)}
                onCopyJd={() => { void handleCopyJd(r.dir); }}
                copied={copied === r.dir}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
