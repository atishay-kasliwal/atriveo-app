import TailorExplainPanel from "./TailorExplainPanel";
import type { TailorExplainSummary } from "../types/tailorExplain";
import { summarizeExplain } from "../utils/summarizeExplain";

interface Props {
  explain?: TailorExplainSummary | null;
  showDetails?: boolean;
}

export default function ExplainSummary({ explain, showDetails = true }: Props) {
  if (!explain) return null;
  const { bullets, confidence } = summarizeExplain(explain);

  if (!bullets.length && !showDetails) return null;

  return (
    <div className="explain-summary">
      {bullets.length > 0 ? (
        <>
          <p className="explain-summary-kicker">Why this resume?</p>
          <ul className="explain-summary-list">
            {bullets.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
          <p className="explain-summary-conf">Confidence: {confidence}</p>
        </>
      ) : null}
      {showDetails ? (
        <TailorExplainPanel explain={explain} compact />
      ) : null}
    </div>
  );
}
