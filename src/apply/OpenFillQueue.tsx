import { useEffect, useRef, useState } from "react";
import { getJson, postAction } from "./engine";
import { armExtension } from "./openFill";
import { refreshReady, type ManualApp, type ReadyQueue } from "./reviewQueue";

type Entry = Pick<ManualApp, "id" | "company">;
const wait = () => new Promise<void>(resolve => setTimeout(resolve, 1000));
export default function OpenFillQueue({ selected, onFinish, onRunning }: { selected: Entry[]; onFinish: () => void; onRunning: (running: boolean) => void }) {
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState("");
  const [paused, setPaused] = useState(false);
  const [error, setError] = useState(false);
  const controls = useRef({ stop: false, pause: false, skip: false });
  useEffect(() => () => { controls.current.stop = true; }, []);
  async function start() {
    if (running) return;
    if (document.documentElement.getAttribute("data-atriveo-fill-queue") !== "1") {
      setMessage("Update Atriveo Fill to 0.2.2 and reload this dashboard to use the queue."); return;
    }
    const jobs = [...selected];
    controls.current = { stop: false, pause: false, skip: false };
    setRunning(true); onRunning(true); setError(false); setPaused(false);
    for (let i = 0; i < jobs.length && !controls.current.stop; i++) {
      while (controls.current.pause && !controls.current.stop) await wait();
      if (controls.current.stop) break;
      const job = jobs[i];
      try {
        setMessage(`${i + 1}/${jobs.length} · Opening ${job.company}`);
        const fresh = await getJson<ReadyQueue>("/applications/review-queue?view=ready");
        if (controls.current.stop) break;
        const current = fresh.manual?.find(a => a.id === job.id);
        if (!current) throw new Error("This application is no longer eligible for Open & Fill.");
        const res = await postAction({ action: "open_and_fill", applicationId: current.id, expectedUpdatedAt: current.updatedAt });
        if (!res.ok || !res.url) throw new Error(res.error || "Could not arm application");
        if (controls.current.stop) break;
        const reply = await armExtension(res.url, current.id, 5000, true);
        if (!reply.ok) throw new Error(reply.error || "Extension could not open the form");
        setMessage(`${i + 1}/${jobs.length} · Filling ${job.company}. Submit remains yours.`);
        let complete = false;
        const deadline = Date.now() + 180_000;
        while (!controls.current.stop && Date.now() < deadline) {
          await wait();
          if (controls.current.stop) break;
          const next = await getJson<ReadyQueue>("/applications/review-queue?view=ready");
          const result = next.manual?.find(a => a.id === job.id)?.openFill;
          if (result?.armedAt && result.armedAt !== current.openFill?.armedAt && result.filledAt && Date.parse(result.filledAt) >= Date.parse(result.armedAt)) {
            if (result.toCheck !== 0) throw new Error("The form needs your attention. Check its tab before continuing.");
            complete = true; break;
          }
        }
        if (controls.current.stop) break;
        if (!complete) throw new Error("No completed fill report arrived. Check the form for verification, CAPTCHA, or errors.");
        void refreshReady();
      } catch (e) {
        setMessage(`${job.company}: ${e instanceof Error ? e.message : String(e)}`);
        setError(true); setPaused(true); controls.current.skip = false;
        while (!controls.current.skip && !controls.current.stop) await wait();
        setError(false); setPaused(false); controls.current.pause = false;
      }
    }
    const stopped = controls.current.stop;
    setRunning(false); onRunning(false); setPaused(false); setError(false);
    setMessage(stopped ? "Queue stopped. Already opened forms remain available for your review." : "Queue finished. Review the open forms and submit each yourself.");
    onFinish();
  }
  return <div className="td-fill-queue">
    {!running && <button className="apps-btn" disabled={!selected.length} onClick={() => void start()}>Open & Fill selected ({selected.length})</button>}
    {running && <>
      {!error && <button className="apps-btn" onClick={() => { controls.current.pause = !controls.current.pause; setPaused(controls.current.pause); }}>{paused ? "Resume queue" : "Pause after current"}</button>}
      {error && <button className="apps-btn" onClick={() => { controls.current.skip = true; }}>Skip & continue</button>}
      <button className="apps-btn" onClick={() => { controls.current.stop = true; }}>Stop queue</button>
    </>}
    {message && <span role="status">{message}</span>}
  </div>;
}
