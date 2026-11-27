import { stateName } from "../../scripts/place.mjs";
import { detectHere, useHere } from "./place";

const PIN = <svg aria-hidden="true" viewBox="0 0 16 16"><path d="M8 14.5s4.6-4.3 4.6-8A4.6 4.6 0 0 0 3.4 6.5c0 3.7 4.6 8 4.6 8Z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/><circle cx="8" cy="6.5" r="1.7" fill="currentColor"/></svg>;

/**
 * "Use my location" on Today and Staffing: one click asks the browser where you are, and jobs in that state come
 * first (above your saved states). Once on, it shows the state; a click checks again.
 */
export default function HerePill() {
  const h = useHere();
  // Short on the toolbar (it sits beside Near me and the tracks); the title says the rest.
  const label = h.status === "asking" ? "…" : h.status === "on" && h.state ? h.state
    : h.status === "outside" ? "Not US" : h.status === "denied" ? "Blocked" : h.status === "unavailable" ? "Retry" : "";
  const name = h.status === "on" && h.state ? `Near ${stateName(h.state)}` : h.status === "outside" ? "Outside the US"
    : h.status === "denied" ? "Location blocked" : h.status === "unavailable" ? "Location unavailable" : h.status === "asking" ? "Locating" : "Use my location";
  const title = h.status === "on" && h.state ? `You're in ${stateName(h.state)}: its jobs come first. Click to check again.`
    : h.status === "outside" ? "Your location isn't in a US state, so your saved states are used. Click to check again."
    : h.status === "denied" ? "The browser blocked location for this site. Allow it in the browser's site settings, then click again."
    : h.status === "unavailable" ? "Your location couldn't be read. Click to try again."
    : "Put jobs in the state you're in first. Only the state is kept, on this device.";
  return (
    <button type="button" className={`td-mood td-here ${h.status === "on" ? "is-on" : ""} ${label ? "" : "is-icon"}`} aria-pressed={h.status === "on"} title={title} aria-label={name} disabled={h.status === "asking"} onClick={() => void detectHere()}>
      {PIN}{label}
    </button>
  );
}
