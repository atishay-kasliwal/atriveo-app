import { useEffect, useMemo, useState } from "react";
import type { Job } from "../types";
import { copyTextToClipboard, formatJobsForClipboard, jobCopyKey } from "../utils/jobCopy";

export function useJobSelection(jobs: Job[]) {
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(() => new Set());
  const [copyMessage, setCopyMessage] = useState("");

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
    setSelectedKeys((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const selectVisibleJobs = () => {
    setCopyMessage("");
    setSelectedKeys(new Set(jobs.map(jobCopyKey)));
  };

  const clearSelectedJobs = () => {
    setCopyMessage("");
    setSelectedKeys(new Set());
  };

  const copySelectedJobs = async () => {
    if (!selectedJobs.length) return;
    try {
      await copyTextToClipboard(formatJobsForClipboard(selectedJobs));
      setCopyMessage(`Copied ${selectedJobs.length} job${selectedJobs.length === 1 ? "" : "s"}`);
    } catch {
      setCopyMessage("Copy failed — browser blocked clipboard");
    }
  };

  return {
    selectedCount: selectedJobs.length,
    copyMessage,
    isJobSelected: (job: Job) => selectedKeys.has(jobCopyKey(job)),
    toggleJobSelection,
    selectVisibleJobs,
    clearSelectedJobs,
    copySelectedJobs,
  };
}
