interface Props {
  selectedCount: number;
  visibleCount: number;
  copyMessage: string;
  onCopy: () => void;
  onAnalyze?: () => void;
  onTailor?: () => void;
  tailoring?: boolean;
  onSelectVisible: () => void;
  onClear: () => void;
  analysisMessage?: string;
  variant?: "default" | "board";
}

export default function BulkJobCopyBar({
  selectedCount,
  visibleCount,
  copyMessage,
  onCopy,
  onAnalyze,
  onTailor,
  tailoring,
  onSelectVisible,
  onClear,
  analysisMessage,
  variant = "default",
}: Props) {
  if (!visibleCount) return null;

  const compact = variant === "board";

  return (
    <div className={`bulk-copy-bar${selectedCount ? " has-selection" : ""}${compact ? " bulk-copy-bar--board" : ""}`}>
      <div className="bulk-copy-copy">
        {!compact && <span>Bulk copy</span>}
        <strong>{selectedCount ? `${selectedCount} selected` : "Select jobs to copy full JDs"}</strong>
        {!compact && <small>Copies title, company, scores, link, tags, and full JD when exported.</small>}
      </div>

      <div className="bulk-copy-actions">
        {(copyMessage || analysisMessage) && <span className="bulk-copy-status">{analysisMessage || copyMessage}</span>}
        <button
          type="button"
          className="bulk-copy-btn"
          onClick={() => {
            if (selectedCount > 0 && selectedCount === visibleCount) onClear();
            else onSelectVisible();
          }}
        >
          {selectedCount > 0 && selectedCount === visibleCount ? "Deselect all" : "Select all"}
        </button>
        {onAnalyze && (
          <button type="button" className="bulk-copy-btn" onClick={onAnalyze} disabled={!selectedCount}>
            Analyze JDs
          </button>
        )}
        {onTailor && (
          <button type="button" className="bulk-copy-btn primary" onClick={onTailor} disabled={!selectedCount || tailoring}>
            {tailoring ? "Compiling…" : "Compile selected"}
          </button>
        )}
        <button type="button" className="bulk-copy-btn" onClick={onCopy} disabled={!selectedCount}>
          Copy selected
        </button>
        {selectedCount > 0 && (
          <button type="button" className="bulk-copy-btn subtle" onClick={onClear}>
            Clear
          </button>
        )}
      </div>
    </div>
  );
}
