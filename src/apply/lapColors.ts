// Which lap of the daily goal a count is on, and its colour: the same rule as the Mac app and widget. Under the goal is lap 0 (your accent);
// every further goal's worth of applications is a new lap with its own colour, up to 2000 applications (a goal of 30: 30, 60, 90 ... 2000).
export const LAP_CEILING = 2000;
const ACCENT = "#6d7bff";
/** Lap 1 onward: green, red, purple, gold, teal, pink, orange, sky, lime, indigo, coral; then a new hue every time (the golden angle keeps neighbouring laps far apart). */
const PALETTE = ["#2fb87a", "#ee5d52", "#a86be0", "#f7b838", "#3fc6c0", "#e56fb0", "#f08a3b", "#4f9dff", "#b8d94a", "#8a7bff", "#ff7a90"];

export function lapOf(applied: number, goal: number): number {
  const g = Math.max(1, goal), top = Math.max(1, Math.floor(LAP_CEILING / g));
  return Math.min(top, Math.floor(Math.max(0, applied) / g));
}
/** The share of the current lap covered (0..1): the arc drawn over the previous lap's full ring. */
export function lapProgress(applied: number, goal: number): number {
  const g = Math.max(1, goal), a = Math.max(0, applied), top = Math.max(1, Math.floor(LAP_CEILING / g)), lap = lapOf(a, g);
  return lap >= top ? 1 : (a - lap * g) / g;
}
export function lapColor(lap: number, accent = ACCENT): string {
  if (lap <= 0) return accent;
  if (lap <= PALETTE.length) return PALETTE[lap - 1]!;
  return `hsl(${Math.round(((lap * 137.508) % 360) * 10) / 10} 66% 62%)`;
}
export function lapCaption(applied: number, goal: number): string {
  const lap = lapOf(applied, goal);
  if (lap === 0) return `${Math.max(0, goal - applied)} to go`;
  if (lap === 1) return applied === goal ? "Goal reached" : `+${applied - goal} past goal`;
  return `${lap === 2 ? "Double goal" : `${lap}× goal`} · +${applied - lap * goal}`;
}
