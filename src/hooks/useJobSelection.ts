import { useEffect, useMemo, useState } from "react";
import type { Job } from "../types";
import type { TailorJobState, TailorLogEntry, TailorLogKind, TailorRunState, TailorStreamEvent } from "../types/tailor";
import { analyzeSelectedJobs, type SelectedJobAnalysis } from "../utils/jobAnalysis";
import { loadJobDescriptions } from "../utils/jobDescriptionBuckets";
import { copyTextToClipboard, formatJobsForClipboard, jobCopyKey } from "../utils/jobCopy";
import { getTailorServerBase, isLocalTailorHost } from "../utils/tailorServer";

function tailorUnavailableMessage(): string {
  if (!isLocalTailorHost()) {
    return "Tailor relay unreachable. On your Mac: npm run tailor:install (or npm run tailor:prod). If DNS is missing, run once: cloudflared tunnel login && npm run tailor:dns";
  }
  return "Tailor server not running. In a second terminal run: cd ~/atriveo-app && npm run tailor";
}

function isTailorStreamNetworkError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("failed to fetch")
    || m.includes("network error")
    || m.includes("networkerror")
    || m.includes("load failed")
    || m.includes("connection reset")
    || m.includes("aborted")
  );
}

function tailorStreamErrorMessage(raw: string): string {
  if (isTailorStreamNetworkError(raw)) {
    if (!isLocalTailorHost()) {
      return "Connection dropped during tailoring — the relay likely idle-timed out while Ollama was thinking (often ~2 min). Restart the sidecar (npm run tailor:prod), redeploy if needed, and retry. The job may still have finished on your Mac; check the output folder.";
    }
    return "Connection dropped during tailoring while waiting on Ollama. Retry the run; if it keeps failing, restart npm run tailor.";
  }
  if (raw.includes("Failed to fetch")) return tailorUnavailableMessage();
  return raw;
}

async function assertTailorServerReady(): Promise<void> {
  const base = getTailorServerBase();
  try {
    const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(8000), credentials: "include" });
    if (res.status === 503) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || "Tailor relay not configured on Cloudflare.");
    }
    if (!res.ok) throw new Error("unreachable");
    const data = await res.json();
    if (!data.ok) throw new Error("unreachable");
    if (!data.driveMounted) {
      throw new Error('External drive not mounted. Plug in "Kasliwal v2" and retry.');
    }
  } catch (e) {
    const msg = (e as Error).message || String(e);
    if (msg.includes("drive") || msg.includes("relay not configured")) throw e;
    throw new Error(tailorUnavailableMessage());
  }
}

async function readTailorStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: TailorStreamEvent) => void,
) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        onEvent(JSON.parse(line) as TailorStreamEvent);
      } catch {
        onEvent({ type: "log", index: -1, kind: "warn", text: `Stream parse skip · ${line.slice(0, 120)}` });
      }
    }
  }
  if (buffer.trim()) {
    try {
      onEvent(JSON.parse(buffer) as TailorStreamEvent);
    } catch {
      /* ignore trailing partial */
    }
  }
}

function emptyJob(index: number, company = "Unknown", role = "Role"): TailorJobState {
  return { index, company, role, phase: "queued", logs: [] };
}

function appendLog(
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

function appendRunLog(prev: TailorRunState, kind: TailorLogKind, text: string): TailorRunState {
  return { ...prev, runLogs: appendLog(prev.runLogs ?? [], -1, kind, text) };
}

const PHASE_LOG: Record<TailorJobState["phase"], string> = {
  queued: "Queued — waiting for server",
  analyzing: "Phase 1/3 · Compose — AC pipeline (beam + RCS)",
  assembling: "Phase 2/3 · Assemble — writing resume.tex",
  compiling: "Phase 3/3 · Compile — Tectonic PDF",
  reviewing: "Phase 3/3 · Compile — Tectonic PDF", // legacy — Gemma disabled
  done: "Finished this job",
};

function applyTailorEvent(prev: TailorRunState, event: TailorStreamEvent): TailorRunState {
  if (event.type === "ping") return prev;
  const runLogs = prev.runLogs ?? [];
  if (event.type === "start") {
    return {
      ...prev,
      dateDir: event.dateDir,
      model: event.model,
      total: event.total ?? prev.total,
      runLogs: appendLog(runLogs, -1, "result", `Run started · ${event.total ?? prev.total} job(s) · model ${event.model || "Ollama"}`, {
        at: new Date().toISOString(),
      }),
    };
  }
  if (event.type === "fatal") {
    return {
      ...prev,
      active: false,
      fatalError: event.error,
      runLogs: appendLog(runLogs, -1, "error", event.error),
    };
  }
  if (event.type === "end") {
    const ok = prev.jobs.filter((j) => j.phase === "done" && j.status === "ok" && j.pdf).length;
    return {
      ...prev,
      active: false,
      completed: prev.total,
      summary: `Finished ${prev.total} job${prev.total === 1 ? "" : "s"} · ${ok} PDF${ok === 1 ? "" : "s"} saved to drive`,
      runLogs: appendLog(runLogs, -1, "result", `Run complete · ${ok}/${prev.total} PDFs saved`),
    };
  }
  if (event.type === "log" && event.index !== undefined) {
    const meta = { step: event.step, elapsedMs: event.elapsedMs, at: event.ts };
    if (event.index < 0) {
      return { ...prev, runLogs: appendLog(runLogs, -1, event.kind, event.text, meta) };
    }
    const jobs = [...prev.jobs];
    const current = jobs[event.index] || emptyJob(event.index);
    jobs[event.index] = { ...current, logs: appendLog(current.logs, event.index, event.kind, event.text, meta) };
    return { ...prev, jobs };
  }
  if (event.type !== "job" || event.index === undefined) return prev;

  const jobs = [...prev.jobs];
  const current = jobs[event.index] || emptyJob(event.index, event.company, event.role);
  const nextPhase = event.phase || current.phase;
  let logs = current.logs;
  if (nextPhase !== current.phase) {
    logs = appendLog(logs, event.index, "step", PHASE_LOG[nextPhase] || nextPhase);
  }
  jobs[event.index] = {
    ...current,
    company: event.company || current.company,
    role: event.role || current.role,
    phase: nextPhase,
    status: event.status ?? current.status,
    ats: event.ats ?? current.ats,
    folder: event.folder ?? current.folder,
    dir: event.dir ?? current.dir,
    pdfPath: event.pdfPath ?? current.pdfPath,
    pdf: event.pdf ?? current.pdf,
    error: event.error ?? current.error,
    headerTitle: event.headerTitle ?? current.headerTitle,
    explain: event.explain ?? current.explain,
    borderline: event.borderline ?? current.borderline,
    logs,
  };
  const completed = jobs.filter((j) => j.phase === "done").length;
  return { ...prev, jobs, completed };
}

export interface JobSelectionOptions {
  /** When set, "Tailor selected" enqueues Mongo compile jobs instead of the legacy /tailor stream. */
  onCompileSelected?: (jobs: Job[]) => void | Promise<void>;
}

export function useJobSelection(jobs: Job[], options?: JobSelectionOptions) {
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(() => new Set());
  const [copyMessage, setCopyMessage] = useState("");
  const [analysisMessage, setAnalysisMessage] = useState("");
  const [analysis, setAnalysis] = useState<SelectedJobAnalysis | null>(null);
  const [tailoring, setTailoring] = useState(false);
  const [tailorRun, setTailorRun] = useState<TailorRunState | null>(null);

  useEffect(() => {
    const visibleKeys = new Set(jobs.map(jobCopyKey));
    setSelectedKeys((previous) => {
      const next = new Set([...previous].filter((key) => visibleKeys.has(key)));
      return next.size === previous.size ? previous : next;
    });
  }, [jobs]);

  const selectedJobs = useMemo(() => {
    const seen = new Set<string>();
    return jobs.filter((job) => {
      const key = jobCopyKey(job);
      if (!selectedKeys.has(key) || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [jobs, selectedKeys]);

  const toggleJobSelection = (job: Job) => {
    const key = jobCopyKey(job);
    setCopyMessage("");
    setAnalysisMessage("");
    setAnalysis(null);
    setSelectedKeys((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleGroupSelection = (groupJobs: Job[]) => {
    if (!groupJobs.length) return;
    setCopyMessage("");
    setAnalysisMessage("");
    setAnalysis(null);
    const keys = groupJobs.map(jobCopyKey);
    setSelectedKeys((previous) => {
      const allSelected = keys.every((key) => previous.has(key));
      const next = new Set(previous);
      if (allSelected) keys.forEach((key) => next.delete(key));
      else keys.forEach((key) => next.add(key));
      return next;
    });
  };

  const isGroupFullySelected = (groupJobs: Job[]) =>
    groupJobs.length > 0 && groupJobs.every((job) => selectedKeys.has(jobCopyKey(job)));

  const selectVisibleJobs = () => {
    setCopyMessage("");
    setAnalysisMessage("");
    setAnalysis(null);
    setSelectedKeys(new Set(jobs.map(jobCopyKey)));
  };

  const clearSelectedJobs = () => {
    setCopyMessage("");
    setAnalysisMessage("");
    setAnalysis(null);
    setSelectedKeys(new Set());
  };

  const copySelectedJobs = async () => {
    if (!selectedJobs.length) return;
    setCopyMessage("Loading full JDs…");
    try {
      const descriptionsByUrl = await loadJobDescriptions(selectedJobs);
      const fullCount = selectedJobs.filter((job) => descriptionsByUrl[job.job_url]).length;
      await copyTextToClipboard(formatJobsForClipboard(selectedJobs, descriptionsByUrl));
      setCopyMessage(
        `Copied ${selectedJobs.length} job${selectedJobs.length === 1 ? "" : "s"} · ${fullCount} full JD${fullCount === 1 ? "" : "s"}`,
      );
    } catch {
      setCopyMessage("Copy failed — browser blocked clipboard");
    }
  };

  const analyzeSelectedJobDescriptions = async () => {
    if (!selectedJobs.length) return;
    setAnalysisMessage("Analyzing full JDs…");
    try {
      const descriptionsByUrl = await loadJobDescriptions(selectedJobs);
      const resumeText = localStorage.getItem("atriveo_resume") || "";
      setAnalysis(analyzeSelectedJobs(selectedJobs, descriptionsByUrl, resumeText));
      setAnalysisMessage(`Analyzed ${selectedJobs.length} job${selectedJobs.length === 1 ? "" : "s"}`);
    } catch {
      setAnalysis(null);
      setAnalysisMessage("Analysis failed — try again");
    }
  };

  // Stream selected jobs to the local tailor sidecar (npm run tailor). Each job
  // emits live NDJSON progress: queued → analyzing → assembling → compiling → done.
  const tailorSelectedJobs = async () => {
    if (!selectedJobs.length || tailoring) return;

    if (options?.onCompileSelected) {
      setTailoring(true);
      setAnalysisMessage("");
      try {
        await options.onCompileSelected(selectedJobs);
        setAnalysisMessage(`Queued ${selectedJobs.length} job${selectedJobs.length === 1 ? "" : "s"} for compile`);
        setSelectedKeys(new Set());
      } catch (e) {
        setAnalysisMessage(`Compile queue failed: ${(e as Error).message}`);
      } finally {
        setTailoring(false);
      }
      return;
    }

    setTailoring(true);
    const initialRun: TailorRunState = {
      active: true,
      total: 0,
      completed: 0,
      jobs: [],
      runLogs: appendLog([], -1, "step", `Client · ${selectedJobs.length} job(s) selected — preparing run`),
    };
    setTailorRun(initialRun);

    try {
      setTailorRun((prev) => prev ? appendRunLog(prev, "step", `Client · checking tailor server at ${getTailorServerBase()}/health`) : prev);
      await assertTailorServerReady();
      setTailorRun((prev) => prev ? appendRunLog(prev, "result", "Client · tailor server healthy · external drive mounted") : prev);

      setTailorRun((prev) => prev ? appendRunLog(prev, "step", "Client · loading full JD text from description buckets") : prev);
      const descriptionsByUrl = await loadJobDescriptions(selectedJobs);
      const jobsWithJd = selectedJobs
        .map((job) => ({
          company: job.company,
          title: job.title,
          job_url: job.job_url,
          score_pct: job.score_pct,
          jd: descriptionsByUrl[job.job_url] || job.summary || "",
        }))
        .filter((j) => j.jd.trim().length > 50);

      const skipped = selectedJobs.length - jobsWithJd.length;
      const resumeText = localStorage.getItem("atriveo_resume") || "";
      if (!jobsWithJd.length) {
        setTailorRun((prev) => ({
          active: false,
          total: 0,
          completed: 0,
          jobs: [],
          runLogs: appendLog(prev?.runLogs || [], -1, "error", "None of the selected jobs have a full JD captured."),
          fatalError: "None of the selected jobs have a full JD captured.",
        }));
        return;
      }

      setTailorRun((prev) => ({
        ...(prev || initialRun),
        active: true,
        total: jobsWithJd.length,
        completed: 0,
        jobs: jobsWithJd.map((job, index) => ({
          index,
          company: job.company || "Unknown",
          role: job.title || "Role",
          phase: "queued" as const,
          logs: [],
        })),
        runLogs: appendLog(prev?.runLogs || [], -1, "result", `Client · ${jobsWithJd.length} job(s) ready${skipped ? ` · ${skipped} skipped (no JD)` : ""} · resume ${resumeText.length.toLocaleString()} chars`),
      }));

      setTailorRun((prev) => prev ? appendRunLog(prev, "step", "Client · POST /tailor — opening NDJSON stream") : prev);
      const res = await fetch(`${getTailorServerBase()}/tailor`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ resumeText, jobs: jobsWithJd }),
      });

      const contentType = res.headers.get("content-type") || "";
      if (!res.ok && !contentType.includes("ndjson")) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || "tailor failed");
      }
      if (!res.body) throw new Error("no response from tailor server");

      setTailorRun((prev) => prev ? appendRunLog(prev, "result", "Client · stream connected — receiving live server logs") : prev);

      await readTailorStream(res.body, (event) => {
        setTailorRun((prev) => (prev ? applyTailorEvent(prev, event) : prev));
      });
    } catch (e) {
      const msg = (e as Error).message || String(e);
      const fatal = tailorStreamErrorMessage(msg);
      setTailorRun((prev) => ({
        active: false,
        total: prev?.total ?? 0,
        completed: prev?.completed ?? 0,
        jobs: prev?.jobs ?? [],
        runLogs: appendLog(prev?.runLogs || [], -1, "error", `Client · ${fatal}`),
        fatalError: fatal,
      }));
    } finally {
      setTailoring(false);
    }
  };

  const openTailorPath = async (targetPath: string) => {
    try {
      const res = await fetch(`${getTailorServerBase()}/open`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ path: targetPath }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "open failed");
    } catch (e) {
      const msg = (e as Error).message || String(e);
      setTailorRun((prev) => (prev ? { ...prev, fatalError: `Could not open in Finder: ${msg}` } : prev));
    }
  };

  const clearTailorRun = () => setTailorRun(null);

  return {
    selectedCount: selectedJobs.length,
    copyMessage,
    analysisMessage,
    analysis,
    tailoring,
    tailorRun,
    isJobSelected: (job: Job) => selectedKeys.has(jobCopyKey(job)),
    toggleJobSelection,
    toggleGroupSelection,
    isGroupFullySelected,
    selectVisibleJobs,
    clearSelectedJobs,
    copySelectedJobs,
    analyzeSelectedJobDescriptions,
    tailorSelectedJobs,
    openTailorPath,
    clearTailorRun,
  };
}
