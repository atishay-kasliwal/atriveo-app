import { createContext, useContext, type ReactNode } from "react";
import { useScrapeRun, type UseScrapeRunResult } from "../hooks/useScrapeRun";

/**
 * One shared scrape poller for the whole app.
 *
 * The header button and the blocking overlay both need the same run state.
 * Calling useScrapeRun in each would run two independent pollers against the
 * Mac and let them disagree about whether a run is in flight.
 */
const ScrapeRunContext = createContext<UseScrapeRunResult | null>(null);

export function ScrapeRunProvider({ children }: { children: ReactNode }) {
  const value = useScrapeRun();
  return <ScrapeRunContext.Provider value={value}>{children}</ScrapeRunContext.Provider>;
}

export function useScrapeRunContext(): UseScrapeRunResult {
  const ctx = useContext(ScrapeRunContext);
  if (!ctx) throw new Error("useScrapeRunContext must be used inside <ScrapeRunProvider>");
  return ctx;
}
