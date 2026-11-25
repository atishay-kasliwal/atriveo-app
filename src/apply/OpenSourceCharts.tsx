import { useState } from "react";
import { ROLES, RATING, SEGMENTS, countLevels, day, pool, prsOf, projectName, roleLabel, stars, whose, type Bullet, type Pr, type View } from "./openSource";

// The charts of the open source page: plain HTML bars, one donut. Light is the strong end everywhere.

export interface Row { label: string; parts: Array<[level: string, value: number]>; end: string; gap?: boolean; tip: string }
export function Bars({ rows, max }: { rows: Row[]; max: number }) {
  return (
    <div className="os-hb">
      {rows.map((r) => (
        <div key={r.label} className="os-hr" title={r.tip}>
          <span className="os-hl">{r.label}</span>
          <span className="os-ht">{r.parts.filter((p) => p[1] > 0).map(([l, v]) => <i key={l} className={`os-f-${l}`} style={{ width: `${(v / Math.max(1, max)) * 100}%` }} />)}</span>
          <span className={`os-he${r.gap ? " is-gap" : ""}`}>{r.end}</span>
        </div>
      ))}
    </div>
  );
}

export function LevelBar({ counts, max }: { counts: number[]; max?: number }) {
  const tip = `${counts[0]} impressive, ${counts[1]} good, ${counts[2]} average`;
  const total = counts.reduce((a, b) => a + b, 0);
  return (
    <div className="os-bar" title={tip} role="img" aria-label={tip}>
      {total ? ["impressive", "good", "average"].map((l, i) => (counts[i] ? <i key={l} className={`os-f-${l}`} style={max ? { width: `${(counts[i] / max) * 100}%` } : { flex: counts[i] }} /> : null)) : <i className="os-f-none" />}
    </div>
  );
}

export const Kpis = ({ items, big }: { items: Array<[string | number, string]>; big?: boolean }) => (
  <div className={`os-kpis${big ? " is-big" : ""}`}>{items.map(([v, l]) => <div key={l}><b>{v}</b><span>{l}</span></div>)}</div>
);

/** Merged per day over the last three weeks of merges. */
export function MergedPerDay({ prs }: { prs: Pr[] }) {
  const ends = prs.filter((p) => p.state === "MERGED" && p.endedAt).map((p) => p.endedAt!.slice(0, 10));
  if (!ends.length) return <p className="os-note">Nothing merged yet.</p>;
  const last = new Date(`${[...ends].sort().at(-1)}T12:00:00Z`);
  const days = Array.from({ length: 21 }, (_, i) => { const d = new Date(last); d.setUTCDate(d.getUTCDate() - 20 + i); return d.toISOString().slice(0, 10); });
  const n = days.map((d) => ends.filter((e) => e === d).length), max = Math.max(1, ...n);
  const at = (i: number) => day(`${days[i]}T12:00:00`);
  return (
    <>
      <div className="os-days" role="img" aria-label="Merged pull requests per day">{n.map((v, i) => <div key={days[i]} title={`${at(i)}: ${v} merged`}>{v || ""}<i style={{ height: `${(v / max) * 82}%` }} /></div>)}</div>
      <div className="os-axis"><span>{at(0)}</span><span>{at(10)}</span><span>{at(20)}</span></div>
    </>
  );
}

const groupBy = <T,>(list: T[], key: (x: T) => string) => { const m = new Map<string, T[]>(); for (const x of list) m.set(key(x), [...(m.get(key(x)) ?? []), x]); return [...m.entries()]; };
const Chart = ({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) => <div className="os-chart"><h3>{title}</h3>{children}{note ? <p className="os-note">{note}</p> : null}</div>;

function Demand({ view, role, bullets }: { view: View; role: string; bullets: Bullet[] }) {
  const d = view.demand?.roles[role];
  if (!d || d.n < 15) return <Chart title="What postings ask for"><p className="os-note">{d ? `Only ${d.n} recent postings match this resume, too few to say.` : "Not counted yet. The next sync counts recent postings."}</p></Chart>;
  const rows = d.skills.slice(0, 10).map(([s, pct]) => { const c = bullets.filter((b) => view.skills[b.id]?.includes(s)).length; return { label: s, parts: [[c ? "good" : "gap", pct]] as Row["parts"], end: c ? `${pct}%, ${c} bullet${c > 1 ? "s" : ""}` : `${pct}%, none`, gap: !c, tip: `${s}: in ${pct}% of ${d.n} postings; ${c} of your bullets show it` }; });
  const gaps = rows.filter((r) => r.gap).map((r) => r.label);
  return <Chart title="What postings ask for" note={`${d.n} recent postings. ${gaps.length ? `Your open source does not show ${gaps.slice(0, 4).join(", ")}.` : "Your open source shows all of these."}`}><Bars rows={rows} max={100} /></Chart>;
}

export function RoleCharts({ view, role, bullets }: { view: View; role: string; bullets: Bullet[] }) {
  const prs = prsOf(view, bullets), merged = prs.filter((p) => p.state === "MERGED");
  const rated = bullets.filter((b) => b.score != null);
  const from = groupBy(bullets, (b) => b.org || b.project).map(([k, v]) => ({ k, n: v.length, ready: v.filter((b) => b.ready).length })).sort((a, b) => b.n - a.n);
  const rest = from.slice(9).reduce((n, x) => n + x.n, 0);
  return (
    <>
      <Kpis items={[[rated.length ? (rated.reduce((n, b) => n + b.score!, 0) / rated.length).toFixed(1) : "–", "average rating"], [prs.length ? `${Math.round((100 * merged.length) / prs.length)}%` : "–", `of ${prs.length} PRs merged`], [new Set(prs.map((p) => p.repo)).size, "projects"], [`+${merged.reduce((n, p) => n + (p.add ?? 0), 0).toLocaleString("en-US")}`, "lines in merged PRs"]]} />
      <div className="os-charts">
        <Demand view={view} role={role} bullets={bullets} />
        <Chart title="Where the bullets come from" note={`Light is ready for a general resume.${rest ? ` ${rest} more from ${from.length - 9} other projects.` : ""}`}>
          <Bars max={Math.max(1, ...from.map((x) => x.n))} rows={from.slice(0, 9).map((x) => ({ label: x.k, parts: [["impressive", x.ready], ["average", x.n - x.ready]], end: `${x.ready} of ${x.n}`, tip: `${x.k}: ${x.ready} ready of ${x.n}` }))} />
        </Chart>
        <Chart title="Merged per day" note={`${merged.length} merged pull requests behind these bullets.`}><MergedPerDay prs={prs} /></Chart>
      </div>
    </>
  );
}

/** The Analytics tab: the table of bullets per resume, then the overall charts. */
export function Analytics({ view, drafts, setDrafts, onRole }: { view: View; drafts: boolean; setDrafts: (v: boolean) => void; onRole: (role: string) => void }) {
  const prs = view.prs.filter((p) => p.coverage !== "deleted"), merged = prs.filter((p) => p.state === "MERGED"), open = prs.filter((p) => p.state === "OPEN");
  const covered = merged.filter((p) => p.coverage === "covered").length, decided = prs.length - open.length;
  const max = Math.max(1, ...ROLES.map((r) => pool(view, r.id, true).length));
  const who = groupBy(prs.filter((p) => p.state !== "CLOSED"), whose).map(([k, v]) => ({ k, n: v.length, m: v.filter((p) => p.state === "MERGED").length })).sort((a, b) => b.m - a.m || b.n - a.n).slice(0, 14);
  const langs = groupBy(merged.filter((p) => p.lang), (p) => p.lang!).sort((a, b) => b[1].length - a[1].length).slice(0, 8);
  const biggest = [...new Map([...merged].sort((a, b) => (b.stars ?? 0) - (a.stars ?? 0)).filter((p) => (p.add ?? 0) > 1 && p.stars).map((p) => [p.repo, p])).values()].slice(0, 10);
  const steps: Array<[string, number]> = [["Sent", prs.length], ["Merged", merged.length], ["Merged, in the bank", covered], ["Merged, impressive", merged.filter((p) => p.rating === "impressive").length]];
  const levels = (["impressive", "good", "average"] as const).map((l) => ({ l, m: merged.filter((p) => p.rating === l).length, o: open.filter((p) => p.rating === l).length }));
  return (
    <div className="os-an">
      <Kpis big items={[[merged.length, "merged pull requests"], [decided ? `${Math.round((100 * merged.length) / decided)}%` : "–", `of ${decided} decided were merged`], [open.length, "waiting on maintainers"], [new Set(merged.map((p) => p.repo)).size, "projects merged into"], [`+${merged.reduce((n, p) => n + (p.add ?? 0), 0).toLocaleString("en-US")}`, "lines in merged PRs"], [view.bullets.filter((b) => b.ready).length, `of ${view.bullets.length} bullets ready`]]} />
      <div className="os-table">
        <table>
          <caption>Bullets for each resume</caption>
          <thead><tr><th>Resume</th><th className="is-left">Bullets <button type="button" className="os-pill" aria-pressed={drafts} onClick={() => setDrafts(!drafts)}>Include drafts</button></th><th>Impressive</th><th>Good</th><th>Average</th><th>General ready</th><th>On master</th></tr></thead>
          <tbody>
            {ROLES.map((r) => {
              const p = pool(view, r.id, drafts), n = countLevels(p), ready = p.filter((b) => b.ready).length, m = view.masters[r.id]?.length;
              return (
                <tr key={r.id} className={r.sub ? "is-sub" : ""} onClick={() => onRole(r.id)}>
                  <td><button type="button" onClick={(e) => { e.stopPropagation(); onRole(r.id); }}>{r.label}</button></td>
                  <td className="is-bar"><LevelBar counts={n} max={max} /></td>
                  {n.map((v, i) => <td key={i} className={v ? "" : "is-zero"}>{v}</td>)}
                  <td className={ready ? "" : "is-zero"}><b>{ready}</b></td>
                  <td className={m ? "" : "is-zero"}>{r.sub ? "" : m ?? 0}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="os-key"><span><i className="os-f-impressive" />Impressive, 8 and up</span><span><i className="os-f-good" />Good, 6 or 7</span><span><i className="os-f-average" />Average</span><span>Click a resume to open it</span></div>
      </div>
      <div className="os-masonry">
        <Chart title="Merged per day"><MergedPerDay prs={prs} /></Chart>
        <Chart title="From pull request to resume" note={`${merged.length - covered} merged pull requests have no bullet in the bank yet.`}><Bars max={prs.length} rows={steps.map(([l, v]) => ({ label: l, parts: [["good", v]], end: String(v), tip: `${l}: ${v}` }))} /></Chart>
        <Chart title="Rating" note="Light is merged, dark is open."><Bars max={Math.max(1, ...levels.map((x) => x.m + x.o))} rows={levels.map((x) => ({ label: RATING[x.l], parts: [["impressive", x.m], ["average", x.o]], end: `${x.m} merged, ${x.o} open`, tip: `${RATING[x.l]}: ${x.m} merged, ${x.o} open` }))} /></Chart>
        <Chart title="Companies and projects" note="Light is merged, dark is open."><Bars max={Math.max(1, ...who.map((x) => x.n))} rows={who.map((x) => ({ label: x.k, parts: [["impressive", x.m], ["average", x.n - x.m]], end: `${x.m} of ${x.n}`, tip: `${x.k}: ${x.m} merged, ${x.n - x.m} open` }))} /></Chart>
        {biggest.length ? <Chart title="Biggest projects you merged into"><Bars max={biggest[0].stars ?? 1} rows={biggest.map((p) => ({ label: projectName(p.repo), parts: [["good", p.stars ?? 0]], end: stars(p.stars), tip: `${p.repo}: ${stars(p.stars)}` }))} /></Chart> : null}
        {langs.length ? <Chart title="Language of the project" note="The project's main language, so React work in Cockpit counts as Python."><Bars max={langs[0][1].length} rows={langs.map(([k, v]) => ({ label: k, parts: [["good", v.length]], end: String(v.length), tip: `${k}: ${v.length} merged` }))} /></Chart> : null}
      </div>
    </div>
  );
}

const PIE = ["ALL", "SWE", "AI", "DS", "FS", "FE", "FDE"];
const R = 54, LEN = 2 * Math.PI * R;

/** One donut under the pull request: ready, merged but not ready, open. Its legend filters the board. */
export function ReadyPie({ view, filter, onFilter, onBuild }: { view: View; filter: { role: string; seg: string } | null; onFilter: (f: { role: string; seg: string } | null) => void; onBuild: (role: string) => void }) {
  const [role, setRole] = useState(filter?.role ?? "ALL");
  const list = pool(view, role, true), n = list.length;
  const values = SEGMENTS.map((s) => list.filter(s.has).length), shown = values.filter(Boolean).length;
  const arcs = values.map((v, i) => ({ len: n ? (v / n) * LEN : 0, from: n ? (values.slice(0, i).reduce((x, y) => x + y, 0) / n) * LEN : 0 }));
  const gap = shown > 1 ? 3 : 0;
  return (
    <div className="os-pie">
      <div className="os-tabs" role="group" aria-label="Resume">{PIE.map((k) => <button key={k} type="button" aria-pressed={k === role} title={k === "ALL" ? "All resumes" : roleLabel(k)} onClick={() => { setRole(k); if (filter) onFilter({ role: k, seg: filter.seg }); }}>{k === "ALL" ? "All" : k}</button>)}</div>
      <div className="os-pie-body">
        <svg viewBox="0 0 138 138" role="img" aria-label={`${values[0]} of ${n} bullets resume ready, ${values[1]} merged but not ready, ${values[2]} open`}>
          <circle cx="69" cy="69" r={R} fill="none" className="os-ring" strokeWidth="17" />
          {SEGMENTS.map((s, i) => <circle key={s.id} className={`os-arc os-s-${s.level}`} cx="69" cy="69" r={R} fill="none" strokeWidth="17" transform="rotate(-90 69 69)" strokeDasharray={`${arcs[i].len ? Math.max(2, arcs[i].len - gap) : 0} ${LEN}`} strokeDashoffset={-(arcs[i].from + gap / 2)}><title>{`${s.label}: ${values[i]}`}</title></circle>)}
          <text className="os-pie-n" x="69" y="75">{values[0]}</text><text className="os-pie-t" x="69" y="91">{`ready of ${n}`}</text>
        </svg>
        <div className="os-legend">{SEGMENTS.map((s, i) => { const on = filter?.role === role && filter.seg === s.id; return <button key={s.id} type="button" aria-pressed={on} title="Show these on the board" onClick={() => onFilter(on ? null : { role, seg: s.id })}><i className={`os-f-${s.level}`} /><span>{s.label}</span><b>{values[i]}</b></button>; })}</div>
      </div>
      <div className="os-pie-foot"><span>{values[0] + values[1]} merged, {values[1] + values[2]} not ready</span>{role === "ALL" ? null : <button type="button" className="os-btn" onClick={() => onBuild(role)}>Build this resume</button>}</div>
    </div>
  );
}
