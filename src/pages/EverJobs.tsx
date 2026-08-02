import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AppHeader from "../components/AppHeader";
import PageIntro from "../components/PageIntro";
import "../styles/everjobs.css";

/**
 * Ever Jobs intake (Spec 1678 / Phase D).
 *
 * The ~180-source aggregator in ~/ever-jobs, surfaced inside Atriveo. job-pipeline scrapes
 * LinkedIn only; this widens the funnel without touching that pipeline or its Mongo
 * corpus. Read-only — nothing here writes to the tracker or the tailor queue.
 *
 * Requires the aggregator running locally: `PORT=3100 npm run start:dev` in ~/ever-jobs.
 * Vite proxies /everjobs-api to it.
 */

type ExperienceLevel = "New Grad" | "Entry" | "Mid";

interface EverJob {
  id?: string;
  title?: string;
  companyName?: string;
  jobUrl?: string;
  applyUrl?: string;
  jobUrlDirect?: string;
  location?: { city?: string; state?: string; country?: string } | null;
  datePosted?: string | null;
  isRemote?: boolean | null;
  site?: string | null;
  experienceLevel?: ExperienceLevel;
}

interface SearchResponse {
  count: number;
  jobs: EverJob[];
  cached: boolean;
  raw_count: number;
  dedup_metrics?: { mergedPairs: number };
  early_career_metrics?: { inputCount: number; outputCount: number; byReason: Record<string, number> };
}

const BUCKETS = [
  { id: "hour", label: "This hour", hoursOld: 1 },
  { id: "today", label: "Today", hoursOld: 24 },
  { id: "yesterday", label: "Yesterday", hoursOld: 48 },
  { id: "week", label: "7 days", hoursOld: 168 },
];

const SOURCE_SETS: Record<string, string[]> = {
  core: ["linkedin", "remoteok", "remotive", "himalayas", "weworkremotely"],
  wide: [
    "linkedin", "remoteok", "remotive", "jobicy", "himalayas", "weworkremotely",
    "workingnomads", "echojobs", "themuse", "arbeitnow", "hackernews", "joinrise",
  ],
  linkedin: ["linkedin"],
};

const US_STATES = new Set([
  "al","ak","az","ar","ca","co","ct","de","fl","ga","hi","id","il","in","ia","ks","ky","la","me",
  "md","ma","mi","mn","ms","mo","mt","ne","nv","nh","nj","nm","ny","nc","nd","oh","ok","or","pa",
  "ri","sc","sd","tn","tx","ut","vt","va","wa","wv","wi","wy","dc",
]);

const ROLE_INCLUDE = [
  "software", "engineer", "developer", "programmer", "backend", "back-end", "frontend",
  "front-end", "fullstack", "full-stack", "full stack", "python", "java", "golang", "rust",
  "typescript", "javascript", "react", "node", "platform", "infrastructure", "devops",
  "sre", "machine learning", "ml engineer", "ai engineer", "data scientist",
  "applied scientist", "data engineer", "new grad",
];

function locationText(j: EverJob): string {
  const parts = [j.location?.city, j.location?.state].filter(Boolean);
  if (parts.length) return parts.join(", ");
  return j.location?.country || (j.isRemote ? "Remote" : "Location not stated");
}

/** Remote alone does not qualify: the remote boards mark UK-only roles remote too. */
function isUsOrRemote(j: EverJob): boolean {
  const parts = [j.location?.city, j.location?.state, j.location?.country]
    .filter(Boolean).join(", ").toLowerCase().trim();
  if (parts === "") return Boolean(j.isRemote);
  if (parts.includes("united states") || parts.includes("usa")) return true;
  const tokens = parts.split(/[,\s]+/).filter(Boolean);
  const last = tokens[tokens.length - 1];
  if (last && last.length === 2 && US_STATES.has(last)) return true;
  return /^remote$/.test(parts);
}

function isRelevant(j: EverJob): boolean {
  const t = (j.title || "").toLowerCase();
  return ROLE_INCLUDE.some((k) => t.includes(k));
}

/** Date-only strings are UTC-parsed by default, which reads as "yesterday" in the US. */
function postedText(j: EverJob): string {
  if (!j.datePosted) return "undated";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(j.datePosted);
  const d = m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(j.datePosted);
  if (Number.isNaN(d.getTime())) return "undated";
  const days = Math.max(
    0,
    Math.round((new Date().setHours(0, 0, 0, 0) - d.setHours(0, 0, 0, 0)) / 86_400_000),
  );
  return days === 0 ? "today" : days === 1 ? "yesterday" : `${days}d ago`;
}

function applyHref(j: EverJob): string | undefined {
  return j.applyUrl || j.jobUrlDirect || j.jobUrl;
}

const levelBadge: Record<ExperienceLevel, string> = {
  "New Grad": "badge-ng",
  Entry: "badge-entry",
  Mid: "badge-mid",
};

export default function EverJobs() {
  const [term, setTerm] = useState("software engineer");
  const [bucketId, setBucketId] = useState("today");
  const [setId, setSetId] = useState("core");
  const [earlyOnly, setEarlyOnly] = useState(true);
  const [usOnly, setUsOnly] = useState(true);
  const [relevantOnly, setRelevantOnly] = useState(true);

  const [res, setRes] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const bucket = BUCKETS.find((b) => b.id === bucketId) || BUCKETS[1];
  const sites = SOURCE_SETS[setId] || SOURCE_SETS.core;
  const inflight = useRef<AbortController | null>(null);

  const run = useCallback(async () => {
    inflight.current?.abort();
    const ctrl = new AbortController();
    inflight.current = ctrl;
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch(`/everjobs-api/api/jobs/search${earlyOnly ? "?level=early" : ""}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: ctrl.signal,
        body: JSON.stringify({
          searchTerm: term,
          location: "United States",
          country: "USA",
          siteType: sites,
          hoursOld: bucket.hoursOld,
          resultsWanted: 25,
          descriptionFormat: "plain",
        }),
      });
      if (!r.ok) throw new Error(`Aggregator returned ${r.status}.`);
      const body = await r.json();
      if (!ctrl.signal.aborted) setRes(body);
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      setErr(
        "Could not reach the ever-jobs aggregator. Start it with PORT=3100 in ~/ever-jobs, then retry.",
      );
      setRes(null);
    } finally {
      if (!ctrl.signal.aborted) setLoading(false);
    }
  }, [term, sites, bucket, earlyOnly]);

  useEffect(() => {
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bucketId, setId, earlyOnly]);

  const visible = useMemo(() => {
    let jobs = res?.jobs || [];
    if (usOnly) jobs = jobs.filter(isUsOrRemote);
    if (relevantOnly) jobs = jobs.filter(isRelevant);
    const seen = new Set<string>();
    return jobs.filter((j) => {
      const k = applyHref(j) || `${j.title}|${j.companyName}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }, [res, usOnly, relevantOnly]);

  const counts = new Map<string, number>();
  for (const j of res?.jobs || []) counts.set(j.site || "?", (counts.get(j.site || "?") || 0) + 1);
  const answered = sites.filter((s) => (counts.get(s) || 0) > 0);
  const silent = sites.filter((s) => (counts.get(s) || 0) === 0);

  return (
    <>
      <AppHeader />
      <main className="ej-page">
        <PageIntro
          kicker="INTAKE"
          title="Ever Jobs"
          description={
            <>
              {sites.length} sources fanned out at once, deduplicated, and narrowed to
              early-career US engineering roles. Widens the funnel beyond the LinkedIn-only
              pipeline. Read-only — nothing here writes to your tracker.
            </>
          }
          stats={[
            { label: "Showing", value: loading ? "…" : visible.length, tone: "blue" },
            { label: "Sources live", value: loading ? "…" : `${answered.length}/${sites.length}`, tone: "green" },
            { label: "Window", value: bucket.label, tone: "slate" },
          ]}
        />

        <form
          className="ej-controls"
          onSubmit={(e) => {
            e.preventDefault();
            void run();
          }}
        >
          <input
            className="ej-input"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="software engineer"
            aria-label="Role"
          />
          <button className="ej-btn" type="submit" disabled={loading}>
            {loading ? "Searching" : "Search"}
          </button>
        </form>

        <nav className="ej-spine" aria-label="Recency">
          {BUCKETS.map((b) => (
            <button
              key={b.id}
              type="button"
              className={`ej-tab${b.id === bucketId ? " ej-tab-on" : ""}`}
              aria-current={b.id === bucketId ? "page" : undefined}
              onClick={() => setBucketId(b.id)}
            >
              {b.label}
            </button>
          ))}
          <span className="ej-spine-fill" />
          <label className="ej-toggle">
            <input type="checkbox" checked={earlyOnly} onChange={(e) => setEarlyOnly(e.target.checked)} />
            <span>1–3 yrs</span>
          </label>
          <label className="ej-toggle">
            <input type="checkbox" checked={usOnly} onChange={(e) => setUsOnly(e.target.checked)} />
            <span>US or remote</span>
          </label>
          <label className="ej-toggle">
            <input type="checkbox" checked={relevantOnly} onChange={(e) => setRelevantOnly(e.target.checked)} />
            <span>Engineering</span>
          </label>
          <select className="ej-select" value={setId} onChange={(e) => setSetId(e.target.value)} aria-label="Source breadth">
            <option value="core">Core</option>
            <option value="wide">Wide</option>
            <option value="linkedin">LinkedIn only</option>
          </select>
        </nav>

        {/* The ledger: which sources answered, which went quiet, what collapsed. While the
            fan-out is in flight nothing is known, so nothing is called silent. */}
        <section className="ej-ledger" aria-label="Intake ledger">
          <div className="ej-chips">
            {loading
              ? sites.map((s) => (
                  <span className="ej-chip ej-chip-pending" key={s}>
                    {s} <em>…</em>
                  </span>
                ))
              : (
                <>
                  {answered.map((s) => (
                    <span className="ej-chip ej-chip-live" key={s}>
                      {s} <strong>{counts.get(s)}</strong>
                    </span>
                  ))}
                  {silent.map((s) => (
                    <span className="ej-chip ej-chip-silent" key={s} title="Answered with nothing in this window">
                      {s} <em>silent</em>
                    </span>
                  ))}
                </>
              )}
          </div>
          {!loading && res && (
            <p className="ej-trail">
              <b>{res.raw_count}</b> raw → <b>{res.count}</b> unique
              {(res.dedup_metrics?.mergedPairs ?? 0) > 0 && <> · <b>{res.dedup_metrics!.mergedPairs}</b> collapsed</>}
              {res.early_career_metrics && (
                <> · <b>{res.early_career_metrics.inputCount - res.early_career_metrics.outputCount}</b> over-level</>
              )}
              {res.cached && <span className="ej-cached">cached</span>}
            </p>
          )}
        </section>

        {err && (
          <div className="ej-state">
            <p className="ej-state-title">The search did not run.</p>
            <p className="ej-state-body">{err}</p>
            <button className="ej-btn" type="button" onClick={() => void run()}>Try again</button>
          </div>
        )}

        {!err && loading && (
          <div className="ej-state">
            <p className="ej-state-title">Fanning out to {sites.length} sources.</p>
            <p className="ej-state-body">LinkedIn alone takes about 20 seconds. Results land together.</p>
          </div>
        )}

        {!err && !loading && visible.length === 0 && (
          <div className="ej-state">
            <p className="ej-state-title">Nothing in this window.</p>
            <p className="ej-state-body">Widen the window or the source set, or drop a filter.</p>
          </div>
        )}

        {!loading && visible.length > 0 && (
          <ul className="ej-rows">
            {visible.map((j, i) => {
              const href = applyHref(j);
              return (
                <li className="ej-row" key={j.id || `${j.title}-${i}`}>
                  <div className="ej-row-main">
                    <h3 className="ej-row-title">{j.title || "Untitled role"}</h3>
                    <p className="ej-row-co">{j.companyName || "Company not stated"}</p>
                    <p className="ej-row-meta">
                      <span>{locationText(j)}</span>
                      {j.isRemote && <span className="badge badge-src">Remote</span>}
                      {j.experienceLevel && (
                        <span className={`badge ${levelBadge[j.experienceLevel]}`}>{j.experienceLevel}</span>
                      )}
                    </p>
                  </div>
                  <div className="ej-row-side">
                    <span className="ej-row-src">{j.site}</span>
                    <span className="ej-row-age">{postedText(j)}</span>
                    {href ? (
                      <a className="ej-apply" href={href} target="_blank" rel="noreferrer noopener">Apply</a>
                    ) : (
                      <span className="ej-apply ej-apply-dead">No link</span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </>
  );
}
