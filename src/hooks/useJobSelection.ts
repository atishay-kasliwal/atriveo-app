import { useEffect, useMemo, useState } from "react";
import type { Job } from "../types";
import { analyzeSelectedJobs, type SelectedJobAnalysis } from "../utils/jobAnalysis";
import { loadJobDescriptions } from "../utils/jobDescriptionBuckets";
import { copyTextToClipboard, formatJobsForClipboard, jobCopyKey } from "../utils/jobCopy";

const TAILOR_SERVER = "http://localhost:8787";

export function useJobSelection(jobs: Job[]) {
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(() => new Set());
  const [copyMessage, setCopyMessage] = useState("");
  const [analysisMessage, setAnalysisMessage] = useState("");
  const [analysis, setAnalysis] = useState<SelectedJobAnalysis | null>(null);
  const [tailoring, setTailoring] = useState(false);
  const [tailorMessage, setTailorMessage] = useState("");

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

  // Send selected jobs (with full JD text) to the local tailor sidecar, which
  // runs Ollama, applies bullet rewrites to the resume template, compiles a
  // PDF, and saves everything to the external drive. Requires `npm run tailor`.
  const tailorSelectedJobs = async () => {
    if (!selectedJobs.length || tailoring) return;
    const resumeText = localStorage.getItem("atriveo_resume") || "";
    if (resumeText.trim().length < 50) {
      setTailorMessage("Save your resume in Settings first.");
      return;
    }
    setTailoring(true);
    setTailorMessage("Loading full JDs…");
    try {
      const descriptionsByUrl = await loadJobDescriptions(selectedJobs);
      const payload = {
        resumeText,
        jobs: selectedJobs.map((job) => ({
          company: job.company,
          title: job.title,
          job_url: job.job_url,
          score_pct: job.score_pct,
          jd: descriptionsByUrl[job.job_url] || job.summary || "",
        })),
      };
      const withJd = payload.jobs.filter((j) => j.jd.trim().length > 50).length;
      if (!withJd) {
        setTailorMessage("None of the selected jobs have a full JD captured.");
        setTailoring(false);
        return;
      }
      setTailorMessage(`Tailoring ${withJd} job${withJd === 1 ? "" : "s"} locally… (~2 min each)`);
      const res = await fetch(`${TAILOR_SERVER}/tailor`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "tailor failed");
      const ok = data.results.filter((r: { pdf?: boolean }) => r.pdf).length;
      const applied = data.results.reduce((n: number, r: { applied?: number }) => n + (r.applied || 0), 0);
      setTailorMessage(`Done: ${ok}/${data.results.length} PDF${ok === 1 ? "" : "s"}, ${applied} bullets rewritten → saved to drive.`);
    } catch (e) {
      const msg = (e as Error).message || String(e);
      setTailorMessage(
        msg.includes("Failed to fetch")
          ? "Tailor server not running. Start it with: npm run tailor"
          : `Failed: ${msg}`,
      );
    } finally {
      setTailoring(false);
    }
  };

  return {
    selectedCount: selectedJobs.length,
    copyMessage,
    analysisMessage,
    analysis,
    tailoring,
    tailorMessage,
    isJobSelected: (job: Job) => selectedKeys.has(jobCopyKey(job)),
    toggleJobSelection,
    selectVisibleJobs,
    clearSelectedJobs,
    copySelectedJobs,
    analyzeSelectedJobDescriptions,
    tailorSelectedJobs,
  };
}
