const STAR = <svg aria-hidden="true" viewBox="0 0 16 16"><path d="M8 1.8l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6z" fill="currentColor"/></svg>;

/**
 * Near me on Today and Staffing: show only the starred jobs (the state you are in, your states, then remote /
 * US-wide when you count those). The count is how many there are with the other filters as they are. Key N.
 */
export default function NearMePill({ on, count, onToggle }: { on: boolean; count: number | null; onToggle: () => void }) {
  return (
    <button type="button" className={`td-mood td-near ${on ? "is-on" : ""}`} aria-pressed={on} title="Only jobs near you: the ★ ones (key N). Set your states in Settings → Where I am." onClick={onToggle}>
      {STAR}<span className="td-near-label">Near me</span><b>{count ?? "…"}</b>
    </button>
  );
}
