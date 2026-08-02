import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchScrapeStatus, startScrapeRun, cancelScrapeRun, fetchScrapeLog, ScrapeOfflineError,
} from "../utils/scrapeControl";
import type { ScrapeRunState, ScrapePhaseName } from "../types/scrape";

const IDLE: ScrapeRunState = { runId: null, status: "idle", phase: null, phases: [] };

/** Fast enough to feel live, slow enough that a 15-minute run is ~450 requests. */
const POLL_ACTIVE_MS = 2_000;
/** Idle polling exists only to notice a run started from the CLI or another tab. */
const POLL_IDLE_MS = 30_000;

export interface UseScrapeRunResult {
  state: ScrapeRunState;
  knownPhases: ScrapePhaseName[];
  running: boolean;
  /** Mac unreachable — asleep, offline, or the sidecar is down. */
  offline: boolean;
  error: string | null;
  starting: boolean;
  logLines: string[];
  loadingLog: boolean;
  start: () => Promise<void>;
  cancel: () => Promise<void>;
  refresh: () => Promise<void>;
  loadLog: () => Promise<void>;
  dismissError: () => void;
}

const DEFAULT_PHASES: ScrapePhaseName[] = ["scrape", "jd_export", "feed_deploy", "resume_queue"];

/**
 * Owns the lifecycle of an on-demand scrape.
 *
 * Deliberately polls instead of streaming: a run outlives the tab that started
 * it, so reloading mid-scrape must reattach to the run in progress, and the
 * Cloudflare relay idles out long-lived connections at ~100s anyway.
 *
 * @param onComplete fired once per successful run — used to refetch the feed.
 */
export function useScrapeRun(onComplete?: (state: ScrapeRunState) => void): UseScrapeRunResult {
  const [state, setState] = useState<ScrapeRunState>(IDLE);
  const [knownPhases, setKnownPhases] = useState<ScrapePhaseName[]>(DEFAULT_PHASES);
  const [running, setRunning] = useState(false);
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [logLines, setLogLines] = useState<string[]>([]);
  const [loadingLog, setLoadingLog] = useState(false);

  const mounted = useRef(true);
  // Which run we have already reported, so onComplete fires once even though
  // polling keeps seeing the same terminal state afterwards.
  const completedRunId = useRef<string | null>(null);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const poll = useCallback(async () => {
    try {
      const res = await fetchScrapeStatus();
      if (!mounted.current) return;
      setOffline(false);
      setRunning(res.running);
      setState(res.state);
      if (res.knownPhases?.length) setKnownPhases(res.knownPhases);

      const finished = !res.running && res.state.status === "done";
      if (finished && res.state.runId && completedRunId.current !== res.state.runId) {
        completedRunId.current = res.state.runId;
        onCompleteRef.current?.(res.state);
      }
    } catch (e) {
      if (!mounted.current) return;
      if (e instanceof ScrapeOfflineError) {
        setOffline(true);
        setRunning(false);
      } else {
        setError(e instanceof Error ? e.message : String(e));
      }
    }
  }, []);

  // One immediate poll on mount reattaches to a run already in flight; the
  // interval then tracks it, tightening while active.
  useEffect(() => {
    void poll();
    const interval = setInterval(() => { void poll(); }, running ? POLL_ACTIVE_MS : POLL_IDLE_MS);
    return () => clearInterval(interval);
  }, [poll, running]);

  const start = useCallback(async () => {
    setStarting(true);
    setError(null);
    try {
      const res = await startScrapeRun();
      if (!mounted.current) return;
      if (!res.ok && res.code !== 409) {
        setError(res.error || "Could not start the scrape.");
      } else {
        // 409 = already running; attaching to it is the right outcome, not an error.
        if (res.state) setState(res.state);
        setRunning(true);
        setOffline(false);
      }
    } catch (e) {
      if (!mounted.current) return;
      if (e instanceof ScrapeOfflineError) setOffline(true);
      else setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (mounted.current) setStarting(false);
      void poll();
    }
  }, [poll]);

  const cancel = useCallback(async () => {
    setError(null);
    try {
      const res = await cancelScrapeRun();
      if (!res.ok && res.error) setError(res.error);
    } catch (e) {
      if (e instanceof ScrapeOfflineError) setOffline(true);
      else setError(e instanceof Error ? e.message : String(e));
    } finally {
      void poll();
    }
  }, [poll]);

  const loadLog = useCallback(async () => {
    setLoadingLog(true);
    const lines = await fetchScrapeLog(200);
    if (!mounted.current) return;
    setLogLines(lines);
    setLoadingLog(false);
  }, []);

  const dismissError = useCallback(() => setError(null), []);

  return {
    state, knownPhases, running, offline, error, starting,
    logLines, loadingLog, start, cancel, refresh: poll, loadLog, dismissError,
  };
}
