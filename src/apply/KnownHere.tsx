import { useEffect, useState } from "react";
import { knownCompanies, sameCompany, type KnownCompany } from "./network";

/**
 * On a job card: "You know Dana here" when someone in your Network works at this company. Opens them, with that company's jobs; given
 * the job's link (Matching), it reads "Ask Dana for a referral" and opens the referral email for that job.
 */
export default function KnownHere({ company, jobUrl }: { company: string; jobUrl?: string }) {
  const [hit, setHit] = useState<KnownCompany | null>(null);
  useEffect(() => { let on = true; knownCompanies().then((list) => on && setHit(list.find((c) => sameCompany(c.name, company)) ?? null)); return () => { on = false; }; }, [company]);
  if (!hit) return null;
  const first = hit.people[0];
  return (
    <a className="nw-known" href={`/network?person=${encodeURIComponent(first.id)}${jobUrl ? `&job=${encodeURIComponent(jobUrl)}` : "&jobs=1"}`} title={`In your Network: ${hit.people.map((p) => p.name).join(", ")}. Ask for a referral.`}>
      <i aria-hidden="true" />{jobUrl ? `Ask ${first.name.split(" ")[0]} for a referral` : hit.people.length === 1 ? `You know ${first.name.split(" ")[0]} here` : `You know ${hit.people.length} people here`}
    </a>
  );
}
