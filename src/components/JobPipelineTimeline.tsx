export type OfferStatus = "pending" | "accepted" | "declined" | null;

export interface PipelineTimelineProps {
  compiledAt?: string | null;
  appliedAt?: string | null;
  interviewAt?: string | null;
  offerStatus?: OfferStatus;
  compact?: boolean;
}

type StageKey = "compiled" | "applied" | "interview" | "offer";

interface Stage {
  key: StageKey;
  label: string;
  at?: string | null;
  done: boolean;
  active: boolean;
  tone?: "warn" | "success" | "muted";
}

const TZ = "America/New_York";

function fmtShort(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-US", { timeZone: TZ, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function buildStages(props: PipelineTimelineProps): Stage[] {
  const { compiledAt, appliedAt, interviewAt, offerStatus } = props;
  const offerDone = offerStatus === "accepted" || offerStatus === "declined";
  const offerActive = offerStatus === "pending";

  return [
    { key: "compiled", label: "Compiled", at: compiledAt, done: Boolean(compiledAt), active: false },
    {
      key: "applied",
      label: "Applied",
      at: appliedAt,
      done: Boolean(appliedAt),
      active: Boolean(compiledAt) && !appliedAt,
    },
    {
      key: "interview",
      label: "Interview",
      at: interviewAt,
      done: Boolean(interviewAt),
      active: Boolean(appliedAt) && !interviewAt,
    },
    {
      key: "offer",
      label: offerStatus === "accepted" ? "Offer ✓" : offerStatus === "declined" ? "Offer ✗" : "Offer",
      at: offerDone ? appliedAt : null,
      done: offerDone,
      active: offerActive,
      tone: offerStatus === "accepted" ? "success" : offerStatus === "declined" ? "muted" : undefined,
    },
  ];
}

export default function JobPipelineTimeline(props: PipelineTimelineProps) {
  const stages = buildStages(props);
  const anyProgress = stages.some((s) => s.done || s.active);
  if (!anyProgress && !props.compiledAt) return null;

  if (props.compact) {
    return (
      <div className="pipeline-timeline pipeline-timeline--compact" aria-label="Pipeline progress">
        {stages.map((s) => (
          <span
            key={s.key}
            className={`pipeline-chip${s.done ? " is-done" : ""}${s.active ? " is-active" : ""}${s.tone ? ` is-${s.tone}` : ""}`}
            title={s.at ? `${s.label} · ${fmtShort(s.at)}` : s.label}
          >
            {s.label}
          </span>
        ))}
      </div>
    );
  }

  return (
    <ol className="pipeline-timeline" aria-label="Pipeline progress">
      {stages.map((s, i) => (
        <li
          key={s.key}
          className={`pipeline-step${s.done ? " is-done" : ""}${s.active ? " is-active" : ""}${s.tone ? ` is-${s.tone}` : ""}`}
        >
          <span className="pipeline-step-dot" aria-hidden />
          {i < stages.length - 1 ? <span className="pipeline-step-line" aria-hidden /> : null}
          <div className="pipeline-step-body">
            <span className="pipeline-step-label">{s.label}</span>
            {s.at ? <span className="pipeline-step-when">{fmtShort(s.at)}</span> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}
