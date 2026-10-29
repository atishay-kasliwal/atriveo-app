const TZ = "America/New_York";
/** The New York wall clock, and the New York wall clock back to the real moment. */
export const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
export function nyToIso(value: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!m) return null;
  const want = Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!);
  let guess = want;
  for (let i = 0; i < 3; i += 1) { const p = Object.fromEntries(fmt.formatToParts(new Date(guess)).map((x) => [x.type, x.value])); guess += want - Date.UTC(+p.year!, +p.month! - 1, +p.day!, +p.hour!, +p.minute!); }
  return new Date(guess).toISOString();
}
