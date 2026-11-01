import { useSyncExternalStore } from "react";

// Phones get their own screens (Home, the bottom tab bar), not the desktop layout squeezed down. Same breakpoint as Today's phone list.
const QUERY = "(max-width: 759px)";
const media = () => (typeof window !== "undefined" && window.matchMedia ? window.matchMedia(QUERY) : null);

function subscribe(change: () => void): () => void {
  const m = media();
  if (!m) return () => {};
  m.addEventListener("change", change);
  return () => m.removeEventListener("change", change);
}

export function usePhone(): boolean {
  return useSyncExternalStore(subscribe, () => media()?.matches ?? false, () => false);
}
