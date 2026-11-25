// How impressive a pull request is, 0-10, from its own facts (docs/open-source-page.md). Pure.
//   recognition 0-3  a project with 10K+ stars or NVIDIA 3, 1K+ stars or a known company 2, 100+ stars or any company 1
//   size        0-3  code and test lines added: none 0, under 30 1, under 200 2, more 3
//   proof       0-2  tests 1, a measured result in the description 1
//   status      0-2  merged 2, approved 1
// Caps keep small work honest: docs or CI only 4, under 5 lines or a 100+ file sweep 5, under 10 lines (or under 30
// without a measured result) 7; work shared with the maintainers loses a point.

/** GitHub owner -> the company a reader knows. */
export const COMPANIES = {
  NVIDIA: "NVIDIA", "dsx-ai-factory": "NVIDIA", "redhat-developer": "Red Hat", intuit: "Intuit", mezmo: "Mezmo", "google-research": "Google",
  neo4j: "Neo4j", grafana: "Grafana", splunk: "Splunk", CiscoTestAutomation: "Cisco", ansible: "Ansible", Nixtla: "Nixtla",
};
// Ansible, Nixtla and Mezmo are project homes: they name the work but add no recognition beyond their stars.
const RECOGNISED = new Set(["NVIDIA", "Red Hat", "Intuit", "Google", "Neo4j", "Grafana", "Splunk", "Cisco"]);

const DOC = /\.(md|rst|adoc|txt)$|^docs\/|(^|\/)CHANGELOG|^\.github\/|\/messages_.*properties/;
const TEST = /(^|\/)(tests?|testdata|tests-e2e)\/|_test\.|\.test\.|\.spec\.|test_[^/]*\.py|_tests?\.rs/;
const MEASURED = /\d[\d,.]*\s*(ms|s|x|%)?\s*(→|->)\s*\d|\|\s*(before|after|main|master|this PR)\b|\d[\d,]* (problems|cases|runs|grid points|simulated)|\d+ of \d+ runs|from [\d.,]+ ?(ms|s)\b/i;

/** Lines that count, and the proof signals, from a pull request's files and description. */
export function measure({ files = [], body = "" } = {}) {
  const sum = (f) => files.filter(f).reduce((n, x) => n + (x.additions || 0), 0);
  const test = sum((x) => TEST.test(x.path));
  const code = sum((x) => !DOC.test(x.path) && !TEST.test(x.path));
  return { code, test, files: files.length, tested: test > 0 || (code > 0 && /\btests?\b/i.test(body)), measured: MEASURED.test(body) };
}

/** Rating of a stored pull request, or null while its size is unknown (synced without a token). */
export function rate(pr) {
  if (pr.code == null || pr.test == null) return null;
  const company = COMPANIES[pr.owner] || "";
  const size = pr.code + pr.test;
  const recognition = pr.stars >= 10_000 || company === "NVIDIA" ? 3 : pr.stars >= 1000 || RECOGNISED.has(company) ? 2 : pr.stars >= 100 || company ? 1 : 0;
  const depth = size === 0 ? 0 : size < 30 ? 1 : size < 200 ? 2 : 3;
  const proof = (pr.tested ? 1 : 0) + (pr.measured ? 1 : 0);
  const status = pr.state === "MERGED" ? 2 : pr.review === "APPROVED" ? 1 : 0;
  let score = recognition + depth + proof + status;
  if (size === 0) score = Math.min(score, 4);
  else if (size < 5 || pr.files >= 100) score = Math.min(score, 5);
  else if (size < 10 || (size < 30 && !pr.measured)) score = Math.min(score, 7);
  if (pr.shared) score = size < 30 ? Math.min(score, 7) : score - 1;
  return { score, parts: { recognition, size: depth, proof, status }, rating: ratingOf(score) };
}

export const ratingOf = (score) => (score >= 8 ? "impressive" : score >= 6 ? "good" : "average");
/** The score a rating you set by hand stands for. */
export const SCORE_OF = { impressive: 8, good: 6, average: 4 };
