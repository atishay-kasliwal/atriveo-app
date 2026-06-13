interface Props {
  matchCount: number;
  selectedCount: number;
}

export default function TodayBoardFooter({ matchCount, selectedCount }: Props) {
  return (
    <footer className="today-board-footer" aria-label="Board status">
      <div className="today-board-footer-start">
        <span>{matchCount} matches</span>
        <span className="today-board-footer-dot" aria-hidden>·</span>
        <span>Selected: {selectedCount}</span>
      </div>
      <div className="today-board-footer-center" aria-hidden>
        <kbd>J</kbd><kbd>K</kbd> navigate
        <span className="today-board-footer-dot">·</span>
        <kbd>↵</kbd> expand
        <span className="today-board-footer-dot">·</span>
        <kbd>⌘</kbd><kbd>K</kbd> search
      </div>
      <div className="today-board-footer-end">
        <span className="today-board-live-dot" aria-hidden />
        Live · synced now
      </div>
    </footer>
  );
}
