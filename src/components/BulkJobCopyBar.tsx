interface Props {
  selectedCount: number;
  visibleCount: number;
  copyMessage: string;
  onCopy: () => void;
  onSelectVisible: () => void;
  onClear: () => void;
}

export default function BulkJobCopyBar({
  selectedCount,
  visibleCount,
  copyMessage,
  onCopy,
  onSelectVisible,
  onClear,
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
        {copyMessage && <span className="bulk-copy-status">{copyMessage}</span>}
        <button type="button" className="bulk-copy-btn" onClick={onSelectVisible}>
          Select visible
        </button>
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
