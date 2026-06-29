import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { isTop500 as staticIsTop500, normCompany } from "../data/top500";

export interface Top500Company {
  id: string;
  name: string;
  domain: string | null;
  normalized_name: string;
  ticker: string | null;
  sector: string | null;
  logo_url: string | null;
  created_at: string;
  updated_at: string;
}

interface Top500ContextValue {
  companies: Top500Company[];
  isTop500: (company: string) => boolean;
  loading: boolean;
  seeded: boolean;
  reload: () => void;
}

const Top500Context = createContext<Top500ContextValue>({
  companies: [],
  isTop500: staticIsTop500,
  loading: false,
  seeded: false,
  reload: () => {},
});

export function Top500Provider({ children }: { children: React.ReactNode }) {
  const [companies, setCompanies] = useState<Top500Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [seeded, setSeeded] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/top500");
      if (res.ok) {
        const data = await res.json() as { companies: Top500Company[]; total: number };
        setCompanies(data.companies ?? []);
        setSeeded((data.companies ?? []).length > 0);
      }
    } catch {
      // fall through — isTop500 falls back to static list
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const isTop500 = useMemo(() => {
    if (!seeded || !companies.length) return staticIsTop500;
    const nameSet = new Set(companies.map((c) => c.normalized_name));
    const domainSet = new Set(
      companies.map((c) => c.domain).filter(Boolean) as string[],
    );
    return (company: string): boolean => {
      if (!company) return false;
      const norm = normCompany(company);
      if (!norm) return false;
      if (nameSet.has(norm)) return true;
      // partial match — same logic as static version
      for (const entry of nameSet) {
        if (norm.includes(entry) || entry.includes(norm)) return true;
      }
      // domain check not possible from just a company name here,
      // but domain data is available for the management UI
      return domainSet.size > 0 && false; // placeholder for future domain-aware matching
    };
  }, [companies, seeded]);

  return (
    <Top500Context.Provider value={{ companies, isTop500, loading, seeded, reload: load }}>
      {children}
    </Top500Context.Provider>
  );
}

export function useTop500() {
  return useContext(Top500Context);
}
