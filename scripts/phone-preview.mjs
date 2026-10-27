import { buildMessage, publishNtfy } from "./phone-summary.mjs";

// node scripts/phone-preview.mjs            print every phone message with sample numbers (sends nothing)
// node scripts/phone-preview.mjs --send     also send one test to NTFY_TOPIC (title starts with "[test]")
const ctx = { day: "2026-10-27", applied: 34, goal: 20, streak: 3, yesterday: 25, replies: 2, interviews: 1, reviewCount: 3 };
const samples = [["Morning plan, 3-day streak", "morning", ctx], ["Morning plan, no streak", "morning", { ...ctx, streak: 0, yesterday: 4 }], ["Goal reached", "m1", { ...ctx, applied: 20 }],
  ["Double the goal", "m2", { ...ctx, applied: 40 }], ["Four times the goal", "m3", { ...ctx, applied: 80 }], ["Evening, goal met", "evening", ctx], ["Evening, short of goal", "evening", { ...ctx, applied: 12 }]];
for (const [name, kind, c] of samples) { const m = buildMessage(kind, c); console.log(`\n${name}\n  ${m.title}\n  ${m.message}`); }
if (process.argv.includes("--send")) {
  const m = buildMessage("m1", { ...ctx, applied: 20 });
  const ok = await publishNtfy({ ...m, title: `[test] ${m.title}` });
  console.log(ok ? "\nTest message sent." : "\nNot sent (NTFY_TOPIC missing or ntfy refused it).");
}
