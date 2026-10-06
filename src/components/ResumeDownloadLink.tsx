import { useState } from "react";
import { getTailorServerBase } from "../utils/tailorServer";
import { resumeFolderZip, saveResumeToDirectory, splitResumeDownloadPath, type ResumeDirectory } from "../utils/resumeDownload";

/** All app resume downloads use one name; Atriveo Fill also creates the posting folder. */
export default function ResumeDownloadLink({ pdfPath, className }: { pdfPath: string; className?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const url = `${getTailorServerBase()}/serve-pdf?path=${encodeURIComponent(pdfPath)}&dl=1`;
  async function download() {
    setBusy(true); setError(""); setSaved("");
    try {
      const extension = document.documentElement.getAttribute("data-atriveo-resume-download") === "1";
      const picker = (window as unknown as { showDirectoryPicker?: (options: { mode: "readwrite"; id: string }) => Promise<ResumeDirectory> }).showDirectoryPicker;
      // Ask while the click still has user activation; fetching first can lose it.
      const directory = !extension && picker ? await picker.call(window, { mode: "readwrite", id: "atriveo-resumes" }) : null;
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Download failed (HTTP ${response.status})`);
      const blob = await response.blob();
      const filename = response.headers.get("X-Resume-Download-Path") || "";
      const [folder] = splitResumeDownloadPath(filename);
      if (extension) {
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result).split(",")[1]);
          reader.onerror = () => reject(new Error("Couldn't read resume PDF"));
          reader.readAsDataURL(blob);
        });
        await new Promise<void>((resolve, reject) => {
          const nonce = crypto.randomUUID();
          const done = (error?: string) => { clearTimeout(timer); window.removeEventListener("message", listener); error ? reject(new Error(error)) : resolve(); };
          const listener = (e: MessageEvent) => {
            if (e.source !== window || e.origin !== location.origin || e.data?.source !== "atriveo-fill" || e.data.type !== "resume-downloaded" || e.data.nonce !== nonce) return;
            done(e.data.reply?.ok ? undefined : e.data.reply?.error || "Couldn't download resume");
          };
          const timer = setTimeout(() => done("Resume download timed out. Reload this page and try again."), 30_000);
          window.addEventListener("message", listener);
          window.postMessage({ source: "atriveo-dashboard", type: "download-resume", nonce, filename, base64 }, location.origin);
        });
      } else if (directory) {
        await saveResumeToDirectory(directory, filename, blob);
      } else {
        const objectUrl = URL.createObjectURL(await resumeFolderZip(filename, blob));
        const a = Object.assign(document.createElement("a"), { href: objectUrl, download: `${folder}.zip` });
        document.body.append(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
        setSaved("Downloaded resume folder. Unzip it to find Atishay Kasliwal.pdf.");
        return;
      }
      setSaved(`Saved ${filename}`);
    } catch (e) { if (!(e instanceof DOMException && e.name === "AbortError")) setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  return <><a className={className} href={url} download="Atishay Kasliwal.pdf" aria-disabled={busy} onClick={(e) => { e.preventDefault(); if (!busy) void download(); }}>{busy ? "Downloading…" : "Download"}</a>{error && <span role="alert">{error}</span>}{saved && <span role="status">{saved}</span>}</>;
}
