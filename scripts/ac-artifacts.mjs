// Shared compose → tex → gate scoring path.

import { prepareResumeArtifacts } from "./ac-tex.mjs";
import { scoreOracle } from "./ac-oracle.mjs";
import { runPdfGate } from "./ac-pdf-gate.mjs";
import { analyzeAcContribution } from "./ac-contribution.mjs";
import { auditRulebookCompleteness } from "./ac-rulebook.mjs";

function gateInputFrom(composition, compact, skills) {
  return {
    ...compact,
    skills,
    skills_audit: composition.skills_audit,
    quality: composition.quality,
    narrative: composition.narrative,
    delete_test: composition.delete_test,
    coverage: composition.coverage,
    plan: composition.plan,
    selection_trace: composition.selection_trace,
  };
}

export function scoreResumeCandidate({ composition, bank, jd, title, location, pages = 1 }) {
  const { compact, skills, headerTitle, tex } = prepareResumeArtifacts({
    jd, composition, bank, headerTitle: title, location,
  });
  const oracle = scoreOracle(compact);
  const input = gateInputFrom(composition, compact, skills);
  const gate = runPdfGate({ composition: input, bank, skills, pages, oracle, tex });
  const contribution = analyzeAcContribution(input, { oracle, skills, invariantPass: gate.invariant.passes });
  const rulebook = auditRulebookCompleteness(composition);
  return {
    composition,
    compact,
    skills,
    headerTitle,
    tex,
    oracle,
    gate,
    contribution,
    resume_confidence_score: gate.resume_confidence_score,
    rulebook,
  };
}
