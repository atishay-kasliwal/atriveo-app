import { useState, useCallback, useEffect } from "react";
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
    // Try user-scoped key, fall back to anon key for migration
    const raw = localStorage.getItem(KEY(uid)) ?? localStorage.getItem(KEY("anon"));
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

function syncToServer(e: Exclusions) {
  fetch("/api/prefs", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(e),
  }).catch(() => { /* non-fatal — localStorage is the fallback */ });
}

export function useExclusions() {
  const { user, loading: authLoading } = useAuth();
  const uid = user?.email ?? "anon";

  const [exclusions, setExclusions] = useState<Exclusions>(empty);

  // On auth resolved: load cache instantly, then pull server state
  useEffect(() => {
    if (authLoading) return;

    // Instant render from localStorage cache (may be migrated from anon)
    const cached = load(uid);
    setExclusions(cached);

    // Then fetch from server (cross-device source of truth)
    if (uid !== "anon") {
      fetch("/api/prefs")
        .then((r) => (r.ok ? r.json() : null))
        .then((data: Exclusions | null) => {
          // If server has no data yet but we have local/anon data, push it up
          const serverIsEmpty = !data || (data.companies.length === 0 && data.keywords.length === 0);
          if (serverIsEmpty && (cached.companies.length > 0 || cached.keywords.length > 0)) {
            persist(uid, cached);
            syncToServer(cached);
          } else if (data) {
            setExclusions(data);
            persist(uid, data);
          }
        })
        .catch(() => { /* stick with localStorage on network error */ });
    }
  }, [uid, authLoading]);

  const mutate = useCallback((fn: (prev: Exclusions) => Exclusions) => {
    setExclusions((prev) => {
      const next = fn(prev);
      persist(uid, next);
      if (uid !== "anon") syncToServer(next);
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
