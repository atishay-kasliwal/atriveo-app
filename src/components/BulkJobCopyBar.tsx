interface Props {
  selectedCount: number;
  visibleCount: number;
  copyMessage: string;
  onCopy: () => void;
  onAnalyze?: () => void;
  onSelectVisible: () => void;
  onClear: () => void;
  analysisMessage?: string;
}

export default function BulkJobCopyBar({
  selectedCount,
  visibleCount,
  copyMessage,
  onCopy,
  onAnalyze,
  onSelectVisible,
  onClear,
  analysisMessage,
}: Props) {
  if (!visibleCount) return null;

  return (
    <div className={`bulk-copy-bar${selectedCount ? " has-selection" : ""}`}>
      <div className="bulk-copy-copy">
        <span>Bulk copy</span>
        <strong>{selectedCount ? `${selectedCount} selected` : "Select jobs to copy full JDs"}</strong>
        <small>Copies title, company, scores, link, tags, and full JD when exported.</small>
      </div>

      <div className="bulk-copy-actions">
        {(copyMessage || analysisMessage) && <span className="bulk-copy-status">{analysisMessage || copyMessage}</span>}
        <button type="button" className="bulk-copy-btn" onClick={onSelectVisible}>
          Select visible
        </button>
        {onAnalyze && (
          <button type="button" className="bulk-copy-btn" onClick={onAnalyze} disabled={!selectedCount}>
            Analyze JDs
          </button>
        )}
        <button type="button" className="bulk-copy-btn primary" onClick={onCopy} disabled={!selectedCount}>
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
