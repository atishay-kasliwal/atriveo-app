interface Props {
  readyCount: number;
  appliedToday: number;
  compilingCount: number;
  hideApplied: boolean;
  onToggleHideApplied: () => void;
  showApplied: number;
}

export default function ApplyModeBanner({
  readyCount,
  appliedToday,
  compilingCount,
  hideApplied,
  onToggleHideApplied,
  showApplied,
}: Props) {
  return (
    <div className="apply-mode-banner" role="status">
      <div className="apply-mode-banner-main">
        <span className="apply-mode-banner-kicker">Apply queue</span>
        <span className="apply-mode-banner-stat apply-mode-banner-stat--ready">
          <strong>{readyCount}</strong> ready
        </span>
        <span className="apply-mode-banner-stat">
          <strong>{appliedToday}</strong> applied today
        </span>
        {compilingCount > 0 ? (
          <span className="apply-mode-banner-stat apply-mode-banner-stat--live">
            <strong>{compilingCount}</strong> compiling
          </span>
        ) : null}
      </div>
      <p className="apply-mode-banner-hint">
        Review <strong>PDF</strong> on your Mac, then <strong>Apply</strong> — tracker syncs automatically.
      </p>
      <div className="apply-mode-banner-actions">
        <button
          type="button"
          className={`apply-mode-toggle${hideApplied ? " is-active" : ""}`}
          onClick={onToggleHideApplied}
          aria-pressed={hideApplied}
        >
          {hideApplied ? `Hiding ${showApplied} applied` : "Showing applied"}
        </button>
      </div>
    </div>
  );
}
