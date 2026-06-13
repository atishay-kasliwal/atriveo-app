import { useEffect, useRef } from "react";
import type { TailorLogEntry } from "../types/tailor";
import {
  fmtTailorLogElapsed,
  fmtTailorLogTime,
  TAILOR_LOG_MARKER,
} from "../utils/tailorLogCapture";

interface Props {
  logs: TailorLogEntry[];
  live?: boolean;
  emptyLabel?: string;
  className?: string;
}

export default function TailorLogStream({
  logs,
  live = false,
  emptyLabel = "No step log yet.",
  className = "",
}: Props) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (live) endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [logs.length, live]);

  if (logs.length === 0) {
    return (
      <p className={`tailor-log-stream-empty${className ? ` ${className}` : ""}`}>
        {emptyLabel}
      </p>
    );
  }

  return (
    <div
      className={`tailor-thought-stream tailor-log-stream${className ? ` ${className}` : ""}`}
      aria-label="Tailor step log"
    >
      {logs.map((entry, index) => {
        const prevAt = index > 0 ? logs[index - 1].at : undefined;
        const elapsed = entry.elapsedMs != null
          ? fmtTailorLogElapsed(entry.elapsedMs)
          : prevAt
            ? fmtTailorLogElapsed(Math.max(0, Date.parse(entry.at) - Date.parse(prevAt)))
            : "";

        return (
        <div key={entry.id} className={`tailor-thought-line is-${entry.kind}`}>
          <span className="tailor-thought-meta">
            <time dateTime={entry.at} className="tailor-thought-time">{fmtTailorLogTime(entry.at)}</time>
            {entry.step != null ? <span className="tailor-thought-step">#{entry.step}</span> : null}
            {elapsed ? (
              <span className="tailor-thought-elapsed">{elapsed}</span>
            ) : null}
          </span>
          <span className="tailor-thought-marker" aria-hidden="true">
            {TAILOR_LOG_MARKER[entry.kind]}
          </span>
          <span className="tailor-thought-text">{entry.text}</span>
        </div>
        );
      })}
      <div ref={endRef} />
    </div>
  );
}
