import type { TailorLogEntry, TailorLogKind, TailorPhase, TailorStreamEvent } from "../types/tailor";
import { formatProcessLogTime24 } from "./processLogTime";

const MAX_PERSISTED_LOGS = 300;

const PHASE_LOG: Record<TailorPhase, string> = {
  queued: "Queued — waiting for server",
  analyzing: "Phase 1/3 · Compose — AC pipeline (beam + RCS)",
  assembling: "Phase 2/3 · Assemble — writing resume.tex",
  compiling: "Phase 3/3 · Compile — Tectonic PDF",
  reviewing: "Phase 3/3 · Compile — Tectonic PDF", // legacy — Gemma disabled
  done: "Finished this job",
};

export function appendTailorLog(
  logs: TailorLogEntry[] | undefined,
  index: number,
  kind: TailorLogKind,
  text: string,
  meta?: { step?: number; elapsedMs?: number; at?: string },
): TailorLogEntry[] {
  const base = logs ?? [];
  return [
    ...base,
    {
      id: `${index}-${base.length}-${Date.now()}`,
      index,
      kind,
      text,
      at: meta?.at || new Date().toISOString(),
      step: meta?.step,
      elapsedMs: meta?.elapsedMs,
    },
  ];
}

let lastPhase: TailorPhase | null = null;

export function resetTailorLogCapture(): void {
  lastPhase = null;
}

export function captureTailorStreamEvent(
  logs: TailorLogEntry[],
  event: TailorStreamEvent,
  jobIndex = 0,
): TailorLogEntry[] {
  if (event.type === "log" && event.index === jobIndex) {
    return appendTailorLog(logs, jobIndex, event.kind, event.text, {
      step: event.step,
      elapsedMs: event.elapsedMs,
      at: event.ts,
    });
  }

  if (event.type === "job" && event.index === jobIndex && event.phase && event.phase !== "done") {
    if (event.phase === lastPhase) return logs;
    lastPhase = event.phase;
    return appendTailorLog(logs, jobIndex, "step", PHASE_LOG[event.phase] || event.phase);
  }

  if (event.type === "job" && event.index === jobIndex && event.phase === "done") {
    lastPhase = "done";
    let next = logs;
    if (event.status === "ok" && event.pdf) {
      next = appendTailorLog(next, jobIndex, "result", event.ats ? `PDF ready · ATS ${event.ats}` : "PDF ready");
    } else if (event.status === "no-go") {
      next = appendTailorLog(next, jobIndex, "warn", event.error || "No-Go · eligibility blocked");
    } else if (event.error) {
      next = appendTailorLog(next, jobIndex, "error", event.error);
    }
    return next;
  }

  if (event.type === "fatal") {
    return appendTailorLog(logs, jobIndex, "error", event.error);
  }

  return logs;
}

export function trimTailorLogs(logs: TailorLogEntry[]): TailorLogEntry[] {
  if (logs.length <= MAX_PERSISTED_LOGS) return logs;
  return logs.slice(-MAX_PERSISTED_LOGS);
}

export function fmtTailorLogTime(iso: string): string {
  return formatProcessLogTime24(iso);
}

export function fmtTailorLogElapsed(ms?: number): string {
  if (ms == null) return "";
  if (ms < 1000) return `+${ms}ms`;
  return `+${(ms / 1000).toFixed(1)}s`;
}

export function formatTailorLogsForCopy(logs: TailorLogEntry[]): string {
  return logs
    .map((entry) => {
      const step = entry.step != null ? `#${String(entry.step).padStart(3, "0")}` : "   ";
      const time = fmtTailorLogTime(entry.at);
      const elapsed = fmtTailorLogElapsed(entry.elapsedMs);
      return `${time} ${step} ${elapsed.padStart(8)} ${entry.kind.toUpperCase().padEnd(6)} ${entry.text}`;
    })
    .join("\n");
}

export const TAILOR_LOG_MARKER: Record<TailorLogKind, string> = {
  step: "▸",
  think: "·",
  result: "✓",
  warn: "⚠",
  error: "✕",
};
