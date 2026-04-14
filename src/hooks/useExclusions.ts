import { useState, useCallback } from "react";
import { useAuth } from "./useAuth";
import type { Job } from "../types";

const KEY = (uid: string) => `atriveo_exclusions_v1_${uid}`;

interface Exclusions {
  companies: string[]; // lowercased
  keywords: string[];  // lowercased, matched against title
}

function empty(): Exclusions { return { companies: [], keywords: [] }; }

function load(uid: string): Exclusions {
  try {
    const raw = localStorage.getItem(KEY(uid));
    if (!raw) return empty();
    const p = JSON.parse(raw);
    return {
      companies: Array.isArray(p.companies) ? p.companies.map(String) : [],
      keywords:  Array.isArray(p.keywords)  ? p.keywords.map(String)  : [],
    };
  } catch { return empty(); }
}

function persist(uid: string, e: Exclusions) {
  try { localStorage.setItem(KEY(uid), JSON.stringify(e)); } catch { /* ignore */ }
}

export function useExclusions() {
  const { user } = useAuth();
  const uid = user?.email ?? "anon";

  const [exclusions, setExclusions] = useState<Exclusions>(() => load(uid));

  const mutate = useCallback((fn: (prev: Exclusions) => Exclusions) => {
    setExclusions((prev) => {
      const next = fn(prev);
      persist(uid, next);
      return next;
    });
  }, [uid]);

  const excludeCompany = useCallback((company: string) => {
    const key = company.toLowerCase().trim();
    if (!key) return;
    mutate((prev) =>
      prev.companies.includes(key) ? prev : { ...prev, companies: [...prev.companies, key] }
    );
  }, [mutate]);

  const excludeKeyword = useCallback((keyword: string) => {
    const key = keyword.toLowerCase().trim();
    if (!key) return;
    mutate((prev) =>
      prev.keywords.includes(key) ? prev : { ...prev, keywords: [...prev.keywords, key] }
    );
  }, [mutate]);

  const removeExclusion = useCallback((type: "company" | "keyword", value: string) => {
    mutate((prev) =>
      type === "company"
        ? { ...prev, companies: prev.companies.filter((c) => c !== value) }
        : { ...prev, keywords:  prev.keywords.filter((k)  => k !== value) }
    );
  }, [mutate]);

  const isExcluded = useCallback((job: Job): boolean => {
    const co    = (job.company || "").toLowerCase();
    const title = (job.title   || "").toLowerCase();
    return (
      exclusions.companies.some((c) => co.includes(c)) ||
      exclusions.keywords.some((k)  => title.includes(k))
    );
  }, [exclusions]);

  return { exclusions, excludeCompany, excludeKeyword, removeExclusion, isExcluded };
}
