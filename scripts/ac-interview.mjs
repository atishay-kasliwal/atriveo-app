// Interview Mode: deterministic prep packet from the same AC evidence graph.

import { loadBank } from "./ac-bank.mjs";

function selectedAcEntries(composition, bank) {
  const byId = new Map((bank.acs || []).map((ac) => [ac.id, ac]));
  const entries = [];

  for (const role of composition.experience || []) {
    for (const { ac, face } of role.bullets || []) {
      const full = byId.get(ac.id) || ac;
      entries.push({ section: "experience", role: role.role, ac: full, face });
    }
  }
  for (const project of composition.projects || []) {
    for (const { ac, face } of project.bullets || []) {
      const full = byId.get(ac.id) || ac;
      entries.push({ section: "project", role: project.role, ac: full, face });
    }
  }
  return entries;
}

function normalizeInterview(ac) {
  const interview = ac.interview || {};
  return {
    likely_questions: interview.likely_questions || interview.questions || [],
    star: interview.star || interview.star_answer || null,
    metrics: interview.metrics || extractMetricsFromFact(ac),
    evidence: interview.evidence || ac.evidence || [],
    talking_points: interview.talking_points || [],
  };
}

function extractMetricsFromFact(ac) {
  const text = `${ac.fact || ""} ${(ac.variants || []).map((v) => v.text).join(" ")}`;
  const matches = text.match(/(\d+\.?\d*%|\$\d[\d,]*|\d+[kK]\+?|\d+\+ users|\d+ req\/s)/g) || [];
  return [...new Set(matches)];
}

export function buildInterviewPacket(composition, bank) {
  const entries = selectedAcEntries(composition, bank);
  return {
    generated_at: new Date().toISOString(),
    theme: composition.theme,
    resume_bullets: entries.length,
    acs: entries.map(({ section, role, ac, face }) => ({
      ac_id: ac.id,
      section,
      role,
      facet: face.facet || face.emphasis || null,
      bullet_text: face.text,
      fact: ac.fact || null,
      interview: normalizeInterview(ac),
    })),
  };
}

export function formatInterviewPacketMarkdown(packet) {
  const lines = ["# Interview Prep Packet", ""];
  for (const ac of packet.acs || []) {
    lines.push(`## ${ac.ac_id} (${ac.role})`);
    lines.push(`**Bullet:** ${ac.bullet_text}`);
    if (ac.fact) lines.push(`**Fact:** ${ac.fact}`);
    lines.push("");
    if (ac.interview.likely_questions?.length) {
      lines.push("**Likely questions:**");
      for (const q of ac.interview.likely_questions) lines.push(`- ${q}`);
      lines.push("");
    }
    if (ac.interview.star) {
      lines.push("**STAR answer:**");
      lines.push(ac.interview.star);
      lines.push("");
    }
    if (ac.interview.metrics?.length) {
      lines.push(`**Metrics:** ${ac.interview.metrics.join(", ")}`);
      lines.push("");
    }
    if (ac.interview.evidence?.length) {
      lines.push("**Evidence:**");
      for (const e of ac.interview.evidence) lines.push(`- ${e}`);
      lines.push("");
    }
  }
  return lines.join("\n");
}
