import { useEffect, useState, type ReactNode } from "react";
import CompanyLogo from "../components/CompanyLogo";
import CardActions from "./CardActions";
import { TRACK_LABEL } from "./tracks";
import type { ResumeMatch } from "./reviewQueue";
import "./today.css";

/** A North Carolina job (they come first). */
const NC = /\b(NC|North Carolina|Raleigh|Durham|Charlotte|Cary|Chapel Hill|Morrisville|Research Triangle|RTP|Greensboro|Winston[- ]Salem|Wilmington|Apex)\b/i;
export const inNC = (location?: string | null) => Boolean(location && NC.test(location));

export /** "3h", "2d", "5w": how long ago the posting went up (or was found). */
function ago(iso?: string | null): string | null {
  if (!iso) return null;
  const h = (Date.now() - Date.parse(iso)) / 3_600_000;
  if (!Number.isFinite(h)) return null;
  return h < 1 ? "just now" : h < 24 ? `${Math.floor(h)}h ago` : h < 24 * 14 ? `${Math.floor(h / 24)}d ago` : `${Math.floor(h / 24 / 7)}w ago`;
}

export /** Cards across, and rows that fit the window (a second row of five on a tall screen); a phone scrolls a list of compact cards. */
function useLayout() {
  const pick = () => ({
    mobile: window.innerWidth < 760,
    columns: window.innerWidth >= 1900 ? 5 : window.innerWidth >= 1200 ? 3 : window.innerWidth >= 760 ? 2 : 1,
    rows: window.innerWidth < 760 ? 12 : window.innerHeight >= 860 ? 2 : 1,
  });
  const [n, setN] = useState(pick);
  useEffect(() => { const f = () => setN(pick()); window.addEventListener("resize", f); return () => window.removeEventListener("resize", f); }, []);
  return n;
}

/** The resume-match bar's label, percent and hover text (null before the tailored resume is scored). */
export function resumeMatchView(rm: ResumeMatch | null | undefined, resumeReady?: boolean) {
  const match = rm == null ? null : Math.max(0, Math.min(100, rm.score));
  const title = rm == null ? (resumeReady === false ? "Shown once the tailored resume is built and scored" : "This resume hasn't been scored against the job yet")
    : [`The tailored resume against this job description: ${match}%`, rm.required?.total ? `required ${rm.required.matched}/${rm.required.total}` : "", rm.preferred?.total ? `preferred ${rm.preferred.matched}/${rm.preferred.total}` : ""].filter(Boolean).join(" · ");
  return { match, title };
}

interface Props {
  id: string;
  company: string;
  title: string;
  location?: string | null;
  track?: string | null;
  /** Tags after the track tag (stage, resume state, skills…). */
  tags?: ReactNode;
  /** Tags before the track tag. */
  leadTags?: ReactNode;
  resumeMatch?: ResumeMatch | null;
  resumeReady?: boolean;
  /** Warnings and errors shown under the tags. */
  notes?: ReactNode;
  /** The next step and Review with AI, side by side. */
  primary: ReactNode;
  /** Shown under the primary buttons (e.g. "Creating your resume"). */
  actionNote?: ReactNode;
  /** Secondary actions, opened over the card by More so its height never changes. */
  more?: ReactNode;
  source: string;
  age?: string | null;
  ageTitle?: string;
  className?: string;
  ariaLabel?: string;
  busy?: boolean;
  selected?: boolean;
  onSelect?: (checked: boolean) => void;
  selectDisabled?: boolean;
  onFocus?: () => void;
  onTitle?: () => void;
  onSkip?: () => void;
  skipTitle?: string;
  onApplied?: () => void;
  appliedTitle?: string;
  applied?: boolean;
}

/** One job on Today or Staffing: the same card, header to caption, on both pages. */
export default function JobCard(p: Props) {
  const nc = inNC(p.location);
  const { match, title: matchTitle } = resumeMatchView(p.resumeMatch, p.resumeReady);
  const rm = p.resumeMatch;
  const trackLabel = p.track ? TRACK_LABEL[p.track as keyof typeof TRACK_LABEL] : undefined;
  return (
    <article onMouseDown={p.onFocus} className={`td-card ${trackLabel ? `tr-${p.track}` : ""} ${p.selected ? "is-selected" : ""} ${p.className ?? ""}`} aria-label={p.ariaLabel ?? p.company} aria-busy={p.busy}>
      <header className="td-head">
        {p.onSelect && <input type="checkbox" className="td-check" disabled={p.selectDisabled} aria-label={`Select ${p.company} ${p.title}`} checked={Boolean(p.selected)} onChange={(e) => p.onSelect!(e.target.checked)} />}
        <CompanyLogo company={p.company} size="md" />
        <div className="td-id"><strong title={p.company}>{p.company}</strong></div>
        {p.onSkip && <button type="button" className="td-skip-co" disabled={p.busy} title={p.skipTitle ?? `Skip ${p.company}: hide its jobs until you remove it from Skipped companies (S)`} aria-label={`Skip ${p.company}`} onClick={p.onSkip}><svg aria-hidden="true" viewBox="0 0 16 16"><circle cx="8" cy="8" r="5.6" fill="none" stroke="currentColor" strokeWidth="1.5"/><path d="M4.1 11.9l7.8-7.8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg></button>}
        {p.onApplied && <button type="button" className={`td-skip-co td-mark-applied ${p.applied ? "is-applied" : ""}`} disabled={p.busy || p.applied} title={p.applied ? "Applied" : p.appliedTitle ?? "Mark applied (A)"} aria-label={p.applied ? "Applied" : "Mark applied"} onClick={p.onApplied}><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m3 12 4 4L17 6"/><path d="m12 16 9-10"/></svg></button>}
      </header>
      {p.onTitle ? <h2 className="td-role" title={p.title}><button type="button" className="td-role-link" onClick={p.onTitle}>{p.title}</button></h2> : <h2 className="td-role" title={p.title}>{p.title}</h2>}
      <div className="td-meta">
        {p.location && <span className={`td-loc ${nc ? "is-nc" : ""}`} title={p.location}>{nc ? "★ " : ""}{p.location}</span>}
      </div>
      <div className="td-tags">{p.leadTags}{trackLabel && <span className={`td-track is-${p.track}`} title="Resume track">{trackLabel}</span>}{p.tags}</div>
      {p.notes}
      <footer className="td-foot">
        <div className={`td-profile-match ${match == null ? "is-none" : match >= 60 ? "is-high" : match >= 35 ? "is-mid" : ""}`} title={matchTitle}>
          <div><span>Resume match{rm?.required?.total ? <em> · required {rm.required.matched}/{rm.required.total}</em> : null}</span><strong>{match == null ? "—" : `${match}%`}</strong></div>
          <div className="td-match-bar" role="meter" aria-label="Resume match" aria-valuemin={0} aria-valuemax={100} aria-valuenow={match ?? 0}><i style={{ width: `${match ?? 0}%` }} /></div>
        </div>
        <div className="td-primary-actions">{p.primary}</div>
        {p.actionNote}
        {p.more && <CardActions>{p.more}</CardActions>}
        <div className="td-card-caption"><span>{p.source}</span>{p.age && <span title={p.ageTitle}>{p.age}</span>}</div>
      </footer>
    </article>
  );
}
