import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import ApplicationReview from "./ApplicationReview";
import CompanyLogo from "../components/CompanyLogo";
import PriorityTags from "../components/PriorityTags";
import { postAction, when } from "./engine";
import { armExtension } from "./openFill";
import { adjustCounts, refreshReady, refreshUnanswered, useReadyQueue, useUnansweredQueue, type ManualApp, type QueuedApp, type ReadyApp } from "./reviewQueue";
import "../styles/applications.css";
import "./review-pages.css";
import "./today.css";

// Today: every application waiting for you, in one place, five at a time. Each card shows the one thing it
// needs next, closest to submission first: submit it yourself (Open & Fill), approve the submission, start
// filling a form whose answers you approved, or review its answers. Long forms open in the answer view;
// everything else happens on the card. Nothing is submitted from here without your click on that card.

type Kind = "you_submit" | "approve" | "fill" | "answer";
interface Item { id: string; kind: Kind; company: string; title: string; ats: string | null; updatedAt: string; priorityTags?: string[]; ready?: ReadyApp | ManualApp; queued?: QueuedApp }

const STAGE: Record<Kind, { label: string; tone: string }> = {
  you_submit: { label: "You submit", tone: "go" },
  approve: { label: "Approve to submit", tone: "go" },
  fill: { label: "Answers approved", tone: "info" },
  answer: { label: "Review answers", tone: "warn" },
};

/** Cards across, and rows that fit the window (a second row of five on a tall screen). */
function useLayout() {
  const pick = () => ({
    columns: window.innerWidth >= 1400 ? 5 : window.innerWidth >= 1100 ? 4 : window.innerWidth >= 760 ? 2 : 1,
    rows: window.innerWidth >= 760 && window.innerHeight >= 860 ? 2 : 1,
  });
  const [n, setN] = useState(pick);
  useEffect(() => { const f = () => setN(pick()); window.addEventListener("resize", f); return () => window.removeEventListener("resize", f); }, []);
  return n;
}

export default function TodayPage({ header }: { header?: React.ReactNode }) {
  const unanswered = useUnansweredQueue(60_000);
  const ready = useReadyQueue(60_000);
  const navigate = useNavigate();
  const { columns, rows } = useLayout();
  const perPage = columns * rows;
  const [review, setReview] = useState<{ id: string; updatedAt: string; company: string; mode: "answers" | "resume" } | null>(null);
  const [page, setPage] = useState(0);
  const [done, setDone] = useState<Record<string, string>>({});
  const [later, setLater] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState("");
  const [confirmAll, setConfirmAll] = useState<"approve" | "fill" | null>(null);
  useEffect(() => { if (!notice) return; const t = setTimeout(() => setNotice(""), 7000); return () => clearTimeout(t); }, [notice]);

  const items = useMemo<Item[]>(() => {
    const manual = ready.data?.manual ?? [];
    const manualIds = new Set(manual.map((r) => r.id));
    const fromReady = (r: ReadyApp, kind: Kind): Item => ({ id: r.id, kind, company: r.company, title: r.title, ats: r.ats, updatedAt: r.updatedAt, priorityTags: r.priorityTags, ready: r });
    const fromQueue = (q: QueuedApp): Item => ({ id: q.id, kind: q.n ? "answer" : "fill", company: q.company ?? "Loading…", title: q.title ?? "", ats: null, updatedAt: q.updatedAt, queued: q });
    const order: Kind[] = ["you_submit", "approve", "fill", "answer"];
    const all = [
      ...manual.map((r) => fromReady(r, "you_submit")),
      ...(ready.data?.ready ?? []).filter((r) => !manualIds.has(r.id)).map((r) => fromReady(r, "approve")),
      ...(unanswered.data?.unanswered ?? []).map(fromQueue),
    ];
    return all
      .filter((i) => done[i.id] !== i.updatedAt)
      .sort((a, b) => Number(later.includes(a.id)) - Number(later.includes(b.id)) || order.indexOf(a.kind) - order.indexOf(b.kind));
  }, [ready.data, unanswered.data, done, later]);

  const pages = Math.max(1, Math.ceil(items.length / perPage));
  const current = Math.min(page, pages - 1);
  const shown = items.slice(current * perPage, (current + 1) * perPage);
  const count = (k: Kind) => items.filter((i) => i.kind === k).length;
  const approvable = items.filter((i) => i.kind === "approve");
  const fillable = items.filter((i) => i.kind === "fill");
  const worker = unanswered.data?.worker ?? ready.data?.worker ?? null;

  const finish = (item: Item, message: string, delta: Parameters<typeof adjustCounts>[0]) => {
    setDone((d) => ({ ...d, [item.id]: item.updatedAt }));
    adjustCounts(delta);
    setNotice(message);
    setTimeout(() => { void refreshReady(); void refreshUnanswered(); }, 1500);
  };
  const run = async (item: Item, body: object, onOk: () => void) => {
    setBusy(item.id);
    setErrors((e) => ({ ...e, [item.id]: "" }));
    const res = await postAction({ ...body, applicationId: item.id, expectedUpdatedAt: item.updatedAt });
    setBusy(null);
    if (!res.ok) { setErrors((e) => ({ ...e, [item.id]: res.error ?? "Couldn't do that" })); if (/changed/i.test(res.error ?? "")) { void refreshReady(); void refreshUnanswered(); } return; }
    onOk();
  };

  /** Open & Fill, as on the Ready page: the tab opens during your click, then points at the form once armed. */
  const openFill = async (item: Item) => {
    const tab = window.open("about:blank", "_blank");
    setBusy(item.id);
    setErrors((e) => ({ ...e, [item.id]: "" }));
    const res = await postAction({ action: "open_and_fill", applicationId: item.id, expectedUpdatedAt: item.updatedAt });
    const armed = res.ok && res.url ? await armExtension(res.url, item.id) : null;
    setBusy(null);
    if (!res.ok || !res.url || !armed?.ok) {
      tab?.close();
      setErrors((e) => ({ ...e, [item.id]: !res.ok ? res.error ?? "Couldn't open it" : armed?.error ?? "Couldn't open it" }));
      return;
    }
    if (tab) { tab.opener = null; tab.location.href = res.url; } else window.open(res.url, "_blank", "noopener");
    setNotice(`Opened ${item.company}. Atriveo Fill fills it and stops; review it and click Submit yourself.`);
    setTimeout(() => void refreshReady(), 1500);
  };

  /** Start filling every application whose answers you approved. Filling checks the form; it never submits. */
  const fillAll = async () => {
    setConfirmAll(null);
    let ok = 0;
    for (const item of fillable) {
      setBusy(item.id);
      const res = await postAction({ action: "continue_application", applicationId: item.id, expectedUpdatedAt: item.updatedAt });
      if (res.ok) { ok += 1; setDone((d) => ({ ...d, [item.id]: item.updatedAt })); }
      else setErrors((e) => ({ ...e, [item.id]: res.error ?? "Couldn't start filling" }));
    }
    setBusy(null);
    setNotice(`Started filling ${ok} of ${fillable.length}. Each moves on once its answers check out. Nothing is submitted.`);
    void refreshUnanswered();
  };

  const approveAll = async () => {
    setConfirmAll(null);
    let ok = 0;
    for (const item of approvable) {
      setBusy(item.id);
      const res = await postAction({ action: "approve_submit", applicationId: item.id, expectedUpdatedAt: item.updatedAt });
      if (res.ok) { ok += 1; setDone((d) => ({ ...d, [item.id]: item.updatedAt })); adjustCounts({ ready: -1 }); }
      else setErrors((e) => ({ ...e, [item.id]: res.error ?? "Couldn't approve" }));
    }
    setBusy(null);
    setNotice(`Approved ${ok} of ${approvable.length}. The worker refills, checks and submits them one by one.`);
    void refreshReady();
  };

  const card = (item: Item) => {
    const stage = STAGE[item.kind];
    const q = item.queued;
    const r = item.ready as ManualApp | undefined;
    const drafted = q ? (q.readyForReview ?? q.suggestions ?? 0) : 0;
    const needYou = q ? (q.needsInput ?? 0) + (q.actionRequired ?? 0) : 0;
    const isBusy = busy === item.id;
    return (
      <article key={item.id} className={`td-card is-${stage.tone}`} aria-label={`${item.company}: ${stage.label}`} aria-busy={isBusy}>
        <header className="td-head">
          <CompanyLogo company={item.company} size="sm" />
          <div className="td-id"><strong title={item.company}>{item.company}</strong><span title={item.title}>{item.title}</span></div>
        </header>
        <span className={`td-stage is-${stage.tone}`}>{stage.label}</span>
        <PriorityTags tags={item.priorityTags} />
        <div className="td-body">
          {item.kind === "answer" && q && <>
            <p className="td-big">{q.n} question{q.n === 1 ? "" : "s"}</p>
            <ul className="td-facts">
              <li><b>{drafted}</b> drafted for you</li>
              <li className={needYou ? "warn" : ""}><b>{needYou}</b> need{needYou === 1 ? "s" : ""} your answer</li>
            </ul>
            <p className="td-note">Check the drafts, answer the rest, then Approve all & fill.</p>
          </>}
          {item.kind === "fill" && <p className="td-note">Every answer is approved. Filling checks each one on the form; it never submits.</p>}
          {item.kind === "approve" && r && <>
            <p className="td-big">{r.answered} answers verified</p>
            <p className="td-note">Filled {when(r.filledAt)}{r.resumeFile ? ` · ${r.resumeFile}` : ""}.</p>
            {r.companySubmittedToday && <p className="td-note warn">Already submitted to {item.company} today: this one goes out tomorrow.</p>}
          </>}
          {item.kind === "you_submit" && r && <>
            <p className="td-big">{r.answered} answers verified</p>
            <p className="td-note">{r.openFill?.filledAt ? `Atriveo Fill filled ${r.openFill.filled ?? 0} fields ${when(r.openFill.filledAt)}.` : "Opens in your Chrome; Atriveo Fill fills it and you click Submit."}</p>
          </>}
          {errors[item.id] && <p className="td-error" role="alert">{errors[item.id]}</p>}
        </div>
        <footer className="td-foot">
          {item.kind === "answer" && <button className="rv-primary" disabled={isBusy} onClick={() => navigate(`/unanswered?app=${encodeURIComponent(item.id)}`)}>Review answers</button>}
          {item.kind === "fill" && <button className="rv-primary" disabled={isBusy} onClick={() => void run(item, { action: "continue_application" }, () => finish(item, `Filling ${item.company} now. It moves on once every answer checks out. Nothing is submitted.`, {}))}>{isBusy ? "Starting…" : "Fill and verify"}</button>}
          {item.kind === "approve" && <button className="rv-primary" disabled={isBusy} onClick={() => void run(item, { action: "approve_submit" }, () => finish(item, `Approved ${item.company}. The worker refills it, checks it again and submits.`, { ready: -1 }))}>{isBusy ? "Approving…" : "Approve submit"}</button>}
          {item.kind === "you_submit" && <button className="rv-primary" disabled={isBusy} onClick={() => void openFill(item)}>{isBusy ? "Opening…" : "Open & Fill"}</button>}
          <div className="td-review-links">
            {item.kind !== "answer" && <button className="apps-btn" onClick={() => setReview({ ...item, mode: "answers" })}>Review answers</button>}
            <button className="apps-btn" onClick={() => setReview({ ...item, mode: "resume" })}>Review resume</button>
          </div>
          <div className="td-links">
            <button className="apps-link" disabled={isBusy} onClick={() => setLater((l) => [...l.filter((id) => id !== item.id), item.id])}>Later</button>
            {(item.kind === "approve" || item.kind === "you_submit") && <Link to={`/ready?app=${encodeURIComponent(item.id)}`}>Details</Link>}
          </div>
        </footer>
      </article>
    );
  };

  const loading = !unanswered.data && !ready.data;
  return (
    <div className="rv-page td-page">
      {header}
      <div className="td-bar">
        <div className="td-title"><h1>Today</h1><span className="apps-muted">{loading ? "Loading…" : `${items.length} application${items.length === 1 ? "" : "s"} waiting for you`}</span></div>
        <ol className="td-strip" aria-label="Where your applications are">
          <li><b>{count("answer")}</b><span>Review answers</span></li>
          <li><b>{count("fill")}</b><span>Answers approved</span></li>
          <li className="go"><b>{count("approve")}</b><span>Approve to submit</span></li>
          <li className="go"><b>{count("you_submit")}</b><span>You submit</span></li>
        </ol>
        <div className="td-actions">
          {worker && <span className={`apps-state ${worker.online ? "" : "bad"}`}><i aria-hidden />{worker.online ? "Worker running" : "Worker offline"}</span>}
          {fillable.length > 0 && <button className="apps-btn" disabled={busy !== null} onClick={() => setConfirmAll("fill")}>Fill and verify all {fillable.length}</button>}
          {approvable.length > 0 && <button className="apps-btn" disabled={busy !== null} onClick={() => setConfirmAll("approve")}>Approve all {approvable.length} ready</button>}
        </div>
      </div>
      {(unanswered.error || ready.error) && <p className="ar-error" role="alert">{unanswered.error || ready.error}</p>}
      <main className="td-grid" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))` }}>
        {loading && <div className="td-empty">Loading your applications…</div>}
        {!loading && !items.length && <div className="td-empty"><strong>Nothing is waiting for you.</strong><span>New applications show up here once their questions are collected.</span></div>}
        {shown.map(card)}
      </main>
      {items.length > perPage && (
        <nav className="td-pager" aria-label="More applications">
          <button className="apps-btn" disabled={current === 0} onClick={() => setPage(current - 1)} aria-label="Previous applications">←</button>
          <span>{current * perPage + 1}–{Math.min((current + 1) * perPage, items.length)} of {items.length}</span>
          <button className="apps-btn" disabled={current + 1 >= pages} onClick={() => setPage(current + 1)} aria-label="Next applications">→</button>
        </nav>
      )}
      {confirmAll && (() => {
        const list = confirmAll === "approve" ? approvable : fillable;
        return (
          <div className="td-modal" role="dialog" aria-modal="true" aria-label={confirmAll === "approve" ? "Approve all ready applications" : "Fill and verify all approved applications"}>
            <div className="td-modal-card">
              <h2>{confirmAll === "approve" ? `Approve ${list.length} for submission?` : `Fill and verify ${list.length}?`}</h2>
              <p className="apps-muted">{confirmAll === "approve" ? "The worker refills each one, checks every answer again, and submits it. One per company per day." : "The worker fills each form with your approved answers and checks every one. Nothing is submitted: each comes back to you to approve."}</p>
              <ul>{list.map((i) => <li key={i.id}><b>{i.company}</b> · {i.title}</li>)}</ul>
              <div className="td-modal-actions"><button className="apps-btn" onClick={() => setConfirmAll(null)}>Cancel</button><button className="rv-primary" onClick={() => void (confirmAll === "approve" ? approveAll() : fillAll())}>{confirmAll === "approve" ? `Approve ${list.length}` : `Fill and verify ${list.length}`}</button></div>
            </div>
          </div>
        );
      })()}
      {review && <ApplicationReview key={`${review.id}:${review.mode}`} application={review} onClose={() => setReview(null)} />}
      {notice && <p className="apps-toast" role="status">{notice}</p>}
    </div>
  );
}
