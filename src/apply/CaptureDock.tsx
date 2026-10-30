import { Link } from "react-router-dom";
import { Component, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { clock, flushQueue, loopDone, loopsSummary, loopSnooze, newCaptureId, pickRecorderMime, submitCapture, waiting, type LoopOpen, type LoopsSummary } from "./loops";
import "./capture-dock.css";

// Loops: the capture control on every signed-in screen. A quiet ring in the corner; it opens in place (not a modal) into one text box with
// Speak beside it. Typing is Enter; speaking is Speak → Finish. Both make the same capture, saved on this device before it is sent.
type Phase = "rest" | "compose" | "recording" | "saving" | "kept";
const DRAFT = "loops-draft";
const MAX_RECORDING_MS = 5 * 60_000;
const read = (k: string) => { try { return sessionStorage.getItem(k) ?? ""; } catch { return ""; } };
const write = (k: string, v: string) => { try { v ? sessionStorage.setItem(k, v) : sessionStorage.removeItem(k); } catch { /* a private window: the draft just isn't kept */ } };

/** The dock is an extra: whatever goes wrong inside it, the page underneath keeps working. */
class DockBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? null : this.props.children; }
}
export default function CaptureDock() { return <DockBoundary><Dock /></DockBoundary>; }

function Dock() {
  const [phase, setPhase] = useState<Phase>("rest");
  const [text, setText] = useState(() => read(DRAFT));
  const [note, setNote] = useState("");
  const [kept, setKept] = useState<"sent" | "queued">("sent");
  const [summary, setSummary] = useState<LoopsSummary | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);
  const ring = useRef<HTMLButtonElement>(null), area = useRef<HTMLTextAreaElement>(null), panel = useRef<HTMLDivElement>(null), canvas = useRef<HTMLCanvasElement>(null);
  const rec = useRef<{ recorder: MediaRecorder; stream: MediaStream; chunks: Blob[]; started: number; mime: string; cancelled: boolean; stop: () => void } | null>(null);
  const closeTimer = useRef<number | undefined>(undefined);
  const refocus = useRef(false);
  const open = phase !== "rest";

  const refresh = useCallback(async () => { try { setSummary(await loopsSummary()); } catch { /* not signed in, or Loops is not reachable yet: the dock stays quiet */ } }, []);
  useEffect(() => {
    void refresh(); void flushQueue().then((n) => { if (n) void refresh(); });
    const tick = () => { if (document.visibilityState === "visible") { void refresh(); void flushQueue(); } };
    const timer = window.setInterval(tick, 60_000);
    window.addEventListener("online", tick); document.addEventListener("visibilitychange", tick);
    return () => { clearInterval(timer); window.removeEventListener("online", tick); document.removeEventListener("visibilitychange", tick); };
  }, [refresh]);

  const openDock = useCallback(() => { window.clearTimeout(closeTimer.current); setNote(""); setPhase((p) => (p === "rest" ? "compose" : p)); }, []);
  const closeDock = useCallback(() => {
    window.clearTimeout(closeTimer.current);
    if (rec.current) { rec.current.cancelled = true; rec.current.stop(); }
    refocus.current = !document.activeElement || document.activeElement === document.body || Boolean(panel.current?.contains(document.activeElement));
    setPhase("rest"); setNote("");
  }, []);
  // Back to the ring once it is visible again, if focus was inside the panel.
  useEffect(() => { if (phase === "rest" && refocus.current) { refocus.current = false; ring.current?.focus({ preventScroll: true }); } }, [phase]);

  // Global shortcut and Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.code === "Space") { e.preventDefault(); if (phase === "rest") openDock(); else if (phase === "compose" || phase === "kept") closeDock(); else area.current?.focus(); return; }
      if (e.key === "Escape" && phase !== "rest") { e.preventDefault(); closeDock(); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [phase, openDock, closeDock]);
  useEffect(() => { if (phase === "compose") area.current?.focus({ preventScroll: true }); }, [phase]);
  useEffect(() => write(DRAFT, text), [text]);
  useEffect(() => () => { window.clearTimeout(closeTimer.current); if (rec.current) { rec.current.cancelled = true; rec.current.stop(); } }, []);

  const finishKept = (how: "sent" | "queued") => {
    setKept(how); setPhase("kept"); void refresh();
    closeTimer.current = window.setTimeout(() => setPhase("rest"), how === "sent" ? 1800 : 3600);
  };
  const submitText = async () => {
    const body = text.trim();
    if (!body || phase !== "compose") return;
    setPhase("saving"); setNote("");
    try { const how = await submitCapture({ id: newCaptureId(), kind: "text", text: body, at: Date.now() }); setText(""); write(DRAFT, ""); finishKept(how); }
    catch (e) { setPhase("compose"); setNote(e instanceof Error ? e.message : "That could not be saved. Your text is still here."); }
  };

  // Voice.
  const startRecording = async () => {
    setNote("");
    const mime = pickRecorderMime();
    if (mime === null) { setNote("Mic unavailable. Type it instead."); area.current?.focus(); return; }
    let stream: MediaStream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch (e) { setNote((e as DOMException)?.name === "NotAllowedError" ? "Microphone access is blocked. Type it instead." : "Mic unavailable. Type it instead."); area.current?.focus(); return; }
    try {
      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const audio = Ctx ? new Ctx() : null; const analyser = audio?.createAnalyser();
      if (audio && analyser) { analyser.fftSize = 512; audio.createMediaStreamSource(stream).connect(analyser); }
      const r = { recorder, stream, chunks: [] as Blob[], started: Date.now(), mime: recorder.mimeType || mime || "audio/webm", cancelled: false, stop: () => { if (recorder.state !== "inactive") recorder.stop(); } };
      rec.current = r;
      recorder.ondataavailable = (ev) => { if (ev.data.size) r.chunks.push(ev.data); };
      recorder.onerror = () => { r.cancelled = true; r.stop(); setNote("Recording failed. Type it instead."); };
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop()); void audio?.close().catch(() => {}); stopDraw(); rec.current = null;
        if (r.cancelled) { setPhase((p) => (p === "recording" ? "compose" : p)); return; }
        const blob = new Blob(r.chunks, { type: r.mime }), durationMs = Date.now() - r.started;
        if (blob.size < 800) { setPhase("compose"); setNote("Nothing was recorded. Type it instead."); return; }
        setPhase("saving");
        submitCapture({ id: newCaptureId(), kind: "audio", blob, mime: r.mime, durationMs, at: Date.now() })
          .then(finishKept, (e) => { setPhase("compose"); setNote(e instanceof Error ? e.message : "That could not be saved."); });
      };
      recorder.start(1000);
      setPhase("recording"); setElapsed(0);
      startDraw(analyser ?? null, r.started);
    } catch { stream.getTracks().forEach((t) => t.stop()); setNote("Mic unavailable. Type it instead."); area.current?.focus(); }
  };
  const finishRecording = () => rec.current?.stop();
  const cancelRecording = () => { if (rec.current) { rec.current.cancelled = true; rec.current.stop(); } else setPhase("compose"); };

  // The live waveform: the last two seconds of loudness, one bar per frame slice. Its loop runs only while recording.
  const raf = useRef(0);
  const stopDraw = () => { cancelAnimationFrame(raf.current); };
  const startDraw = (analyser: AnalyserNode | null, started: number) => {
    const bars: number[] = []; const data = new Uint8Array(analyser?.fftSize ?? 0); let last = 0;
    const frame = (t: number) => {
      raf.current = requestAnimationFrame(frame);
      const now = Date.now(); setElapsed(now - started);
      if (now - started > MAX_RECORDING_MS) { rec.current?.stop(); return; }
      if (t - last < 45) return; last = t;
      let level = 0;
      if (analyser) { analyser.getByteTimeDomainData(data); for (const v of data) level = Math.max(level, Math.abs(v - 128) / 128); }
      bars.push(Math.min(1, level * 1.6)); if (bars.length > 56) bars.shift();
      const c = canvas.current; if (!c) return;
      const dpr = window.devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight;
      if (c.width !== w * dpr) { c.width = w * dpr; c.height = h * dpr; }
      const g = c.getContext("2d"); if (!g) return;
      g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
      g.fillStyle = getComputedStyle(c).color;
      const step = w / 56;
      bars.forEach((v, i) => { const bh = Math.max(2, v * h); g.globalAlpha = 0.35 + 0.65 * (i / bars.length); g.fillRect(w - (bars.length - i) * step + 1, (h - bh) / 2, Math.max(1.5, step - 2.5), bh); });
    };
    raf.current = requestAnimationFrame(frame);
  };

  const act = async (id: string, fn: () => Promise<unknown>) => { setBusyId(id); try { await fn(); } catch { /* the list refreshes below, so it shows what is still true */ } finally { setBusyId(null); void refresh(); } };

  const count = (summary?.counts.NEEDS_ACTION ?? 0);
  const due = (summary?.open ?? []).some((o) => o.nextAt && Date.parse(o.nextAt) <= Date.now());
  const list: LoopOpen[] = (summary?.open ?? []).slice(0, 3);
  const unreachable = summary == null;

  return (
    <div className={`cd cd-${phase}`} data-open={open} data-phase={phase}>
      <button ref={ring} type="button" className={`cd-ring ${due ? "is-due" : ""}`} aria-label={count ? `Capture a thought. ${count} unfinished.` : "Capture a thought"} aria-haspopup="dialog" aria-expanded={open} aria-keyshortcuts="Control+Shift+Space Meta+Shift+Space" title="Capture a thought (Ctrl/⌘ Shift Space)" tabIndex={open ? -1 : 0} onClick={openDock}>
        <span className="cd-dot" aria-hidden="true" />
        {count > 0 && <span className="cd-count" aria-hidden="true">{count}</span>}
      </button>
      {open && (
        <div ref={panel} className="cd-panel" role="dialog" aria-label="Capture a thought" aria-modal="false">
          {phase === "recording" ? (
            <div className="cd-rec">
              <div className="cd-rec-top"><span className="cd-live"><i aria-hidden="true" />Listening</span><span className="cd-time" role="timer" aria-live="off">{clock(elapsed)}</span></div>
              <canvas ref={canvas} className="cd-wave" aria-hidden="true" />
              <div className="cd-row"><button type="button" className="cd-btn" onClick={cancelRecording}>Cancel</button><button type="button" className="cd-btn cd-primary" onClick={finishRecording} autoFocus>Finish</button></div>
            </div>
          ) : phase === "kept" ? (
            <p className="cd-kept" role="status"><b>{kept === "sent" ? "Kept." : "Saved on this device."}</b> {kept === "sent" ? "It will be read next time your Mac is on." : "It will send as soon as Atriveo is reachable."}</p>
          ) : phase === "saving" ? (
            <p className="cd-kept" role="status">Keeping it…</p>
          ) : (
            <>
              <div className="cd-head">
                <label className="cd-label" htmlFor="cd-text">What's on your mind?</label>
                <button type="button" className="cd-close" aria-label="Close" title="Close (Esc)" onClick={closeDock}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg></button>
              </div>
              <textarea id="cd-text" ref={area} className="cd-text" rows={3} maxLength={12000} value={text} placeholder="Type it, or tap Speak" onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void submitText(); } }} />
              <div className="cd-row">
                <button type="button" className="cd-btn" onClick={() => void startRecording()}><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>Speak</button>
                <button type="button" className="cd-btn cd-primary" disabled={!text.trim()} onClick={() => void submitText()}>Capture <kbd>↵</kbd></button>
              </div>
              <p className="cd-note" role="status">{note || (unreachable ? "" : "")}</p>
              {list.length > 0 && (
                <ul className="cd-open" aria-label="Still open">
                  {list.map((o) => (
                    <li key={o.id}>
                      <div className="cd-open-text"><span className="cd-open-title">{o.firstTask ?? o.view?.summary ?? "Something you wanted to do"}</span><span className="cd-open-meta">{[o.view?.company, o.view?.position].filter(Boolean).join(" · ")}{o.view?.company || o.view?.position ? " · " : ""}{waiting(o.waitingSince)}</span></div>
                      <div className="cd-open-actions"><button type="button" className="cd-link" disabled={busyId === o.id} onClick={() => void act(o.id, () => loopDone(o.id))}>Done</button><button type="button" className="cd-link" disabled={busyId === o.id} onClick={() => void act(o.id, () => loopSnooze(o.id, 6))}>Remind in 6h</button></div>
                    </li>
                  ))}
                </ul>
              )}
              <Link className="cd-all" to="/loops" onClick={closeDock}>All loops</Link>
            </>
          )}
        </div>
      )}
    </div>
  );
}
