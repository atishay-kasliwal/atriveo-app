// Rulebook eligibility screen — deterministic no-go before PDF generation.

const SPONSORSHIP_BLOCK = [
  /no\s+sponsorship/i,
  /cannot\s+(?:provide\s+)?sponsor/i,
  /will\s+not\s+sponsor/i,
  /unable\s+to\s+sponsor/i,
  /not\s+able\s+to\s+sponsor/i,
  /must\s+be\s+(?:a\s+)?u\.?s\.?\s+citizen/i,
  /u\.?s\.?\s+citizenship\s+required/i,
  /active\s+(?:secret|top\s+secret)\s+clearance\s+required/i,
  /security\s+clearance\s+required/i,
];

const ROLE_MISMATCH = [
  {
    test: (title) => /\bmarketing\b|marketing\s+assistant|graphic\s+design|brand\s+manager/i.test(title)
      && !/engineer|developer|software|ml\b|ai\b|data\s+scien/i.test(title),
    reason: "Role is marketing/non-engineering — profile is SWE/AI",
  },
  {
    test: (title) => /\bembedded\b|firmware|hardware\s+engineer/i.test(title)
      && !/software\s+engineer/i.test(title),
    reason: "Embedded/hardware role — no embedded evidence in AC bank",
  },
  {
    test: (title) => /\bintern\b/i.test(title)
      && !/graduate|new\s+grad/i.test(title),
    reason: "Intern role — senior experience profile; skip unless targeting internships",
  },
];

export function screenJdEligibility(jd, title = "") {
  const hay = `${String(jd || "")}\n${String(title || "")}`;

  for (const re of SPONSORSHIP_BLOCK) {
    if (re.test(hay)) {
      return {
        eligible: false,
        reason: "JD hard-blocks sponsorship or requires US citizenship/clearance",
        signal: re.source,
      };
    }
  }

  const roleLower = String(title || "").toLowerCase();
  for (const rule of ROLE_MISMATCH) {
    if (rule.test(roleLower)) {
      return { eligible: false, reason: rule.reason, signal: "role_mismatch" };
    }
  }

  return { eligible: true, reason: "", signal: null };
}
