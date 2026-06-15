// Gemma analyst layer for the AC resume engine.
// Analyst only: extraction, review, suggestions for the bank — never resume authoring.

import { parseAtsKeywords } from "./ac-bank.mjs";
import { ollamaChat } from "./ac-ollama.mjs";

const ANALYST_RULES = `You are an evidence analyst for a resume optimization engine.
You NEVER write or rewrite resume bullets for the final document.
You NEVER invent metrics, tools, clients, or experience the candidate does not have.
You ONLY analyze, classify, critique, or suggest bank improvements for human approval.
Output ONE valid JSON object only — no markdown, no prose outside JSON.`;

export function bankSummaryForAnalyst(bank) {
  return (bank.acs || []).map((ac) => ({
    id: ac.id,
    role: ac.role,
    slot_kind: ac.slot_kind,
    fact: String(ac.fact || "").slice(0, 280),
    facets: Object.keys(ac.facets || {}),
    variants: (ac.variants || []).map((variant) => ({
      emphasis: variant.emphasis || null,
      facet: variant.facet || null,
      preview: String(variant.text || "").slice(0, 160),
    })),
    ats_keywords: [...parseAtsKeywords(ac).values()].map((meta) => ({
      term: meta.display,
      confidence: meta.confidence,
    })),
    aliases: ac.aliases || {},
  }));
}

export function compactCompositionForAnalyst(result) {
  const bullets = [];
  for (const role of result.experience || []) {
    for (const { ac, face } of role.bullets || []) {
      bullets.push({
        id: `${role.role}:${ac.id}`,
        ac_id: ac.id,
        role: role.role,
        facet: face.facet || null,
        emphasis: face.emphasis || null,
        text: face.text,
      });
    }
  }
  for (const project of result.projects || []) {
    for (const { ac, face } of project.bullets || []) {
      bullets.push({
        id: `project:${project.role}:${ac.id}`,
        ac_id: ac.id,
        role: project.role,
        facet: face.facet || null,
        emphasis: face.emphasis || null,
        text: face.text,
      });
    }
  }
  return {
    theme: result.theme,
    skills: result.skills || [],
    bullets,
    plan_routes: result.plan?.routes || {},
    coverage_audit: result.coverage?.audit || {},
  };
}

const JD_EXTRACT_SCHEMA = {
  type: "object",
  properties: {
    capabilities: { type: "array", items: { type: "string" }, maxItems: 12 },
    keywords: { type: "array", items: { type: "string" }, maxItems: 20 },
    importance: {
      type: "object",
      additionalProperties: { type: "string", enum: ["high", "medium", "low"] },
    },
    notes: { type: "string" },
  },
  required: ["capabilities", "keywords", "importance"],
};

export async function extractJdCapabilities(jd, { model } = {}) {
  const system = `${ANALYST_RULES}

Extract what the JD emphasizes. Use capability families such as:
backend, api_design, distributed, cloud, data, ai, ml, devops, frontend, security, mobile.

For importance, only include keywords explicitly present in the JD text.
Do not infer candidate experience.`;
  const user = `JOB DESCRIPTION:\n${jd.trim()}`;
  return ollamaChat({ model, system, user, schema: JD_EXTRACT_SCHEMA, numPredict: 1024 });
}

const PLANNER_VERIFY_SCHEMA = {
  type: "object",
  properties: {
    overall_assessment: { type: "string" },
    route_changes: {
      type: "array",
      maxItems: 12,
      items: {
        type: "object",
        properties: {
          keyword: { type: "string" },
          current_route: { type: "string" },
          suggested_route: { type: "string" },
          suggested_ac_id: { type: ["string", "null"] },
          reason: { type: "string" },
        },
        required: ["keyword", "current_route", "suggested_route", "reason"],
      },
    },
    do_not_claim: { type: "array", items: { type: "string" }, maxItems: 10 },
    missing_but_supported: { type: "array", items: { type: "string" }, maxItems: 10 },
  },
  required: ["overall_assessment", "route_changes", "do_not_claim"],
};

export async function verifyPlanner(jd, plan, bank, { model } = {}) {
  const system = `${ANALYST_RULES}

Review a deterministic keyword planner against the supplied AC bank.
You may suggest moving a keyword between bullet ACs or skills ONLY if the bank summary shows explicit support.
You may NOT invent new ACs, facets, metrics, or tools.
If a keyword has no bank support, put it in do_not_claim.`;
  const user = JSON.stringify({
    job_description_excerpt: jd.trim().slice(0, 6000),
    planner: {
      jd_terms: plan?.jd_terms || [],
      routes: plan?.routes || {},
      ac_priority: plan?.ac_priority || {},
      facet_priority: plan?.facet_priority || {},
    },
    ac_bank: bankSummaryForAnalyst(bank),
  }, null, 2);
  return ollamaChat({ model, system, user, schema: PLANNER_VERIFY_SCHEMA, numPredict: 2048 });
}

const READABILITY_SCHEMA = {
  type: "object",
  properties: {
    score_1_to_10: { type: "integer" },
    flags: {
      type: "array",
      maxItems: 12,
      items: {
        type: "object",
        properties: {
          type: {
            type: "string",
            enum: ["repetition", "awkward_wording", "keyword_stuffing", "unnatural_phrasing", "duplicate_story", "weak_relevance"],
          },
          bullet_id: { type: ["string", "null"] },
          detail: { type: "string" },
        },
        required: ["type", "detail"],
      },
    },
    strongest_bullet_id: { type: ["string", "null"] },
    weakest_bullet_id: { type: ["string", "null"] },
    summary: { type: "string" },
  },
  required: ["score_1_to_10", "flags", "summary"],
};

export async function scoreReadability(jd, composition, { model } = {}) {
  const system = `${ANALYST_RULES}

Rate the composed resume for human readability and relevance to the JD.
Do NOT rewrite any bullet text.
Flag repetition, awkward wording, keyword stuffing, unnatural phrasing, duplicate stories, and weak relevance.`;
  const user = JSON.stringify({
    job_description_excerpt: jd.trim().slice(0, 4000),
    composition: compactCompositionForAnalyst(composition),
  }, null, 2);
  return ollamaChat({ model, system, user, schema: READABILITY_SCHEMA, numPredict: 1536 });
}

const WEAKEST_BULLET_SCHEMA = {
  type: "object",
  properties: {
    weakest_bullet_id: { type: "string" },
    why: { type: "string" },
    replacement_ac_id: { type: ["string", "null"] },
    replacement_reason: { type: "string" },
    do_not_rewrite: { type: "boolean" },
  },
  required: ["weakest_bullet_id", "why", "replacement_ac_id", "replacement_reason", "do_not_rewrite"],
};

export async function recommendWeakestSwap(jd, composition, bank, { model } = {}) {
  const system = `${ANALYST_RULES}

As a hiring manager, identify the single weakest or least relevant bullet in the composed resume.
Recommend replacing it with a DIFFERENT AC id from the bank bench for the same role if one would fit better.
You must NOT rewrite bullet text. replacement_ac_id must exist in the bank.
Set do_not_rewrite to true always.`;
  const user = JSON.stringify({
    job_description_excerpt: jd.trim().slice(0, 4000),
    composition: compactCompositionForAnalyst(composition),
    available_acs: bankSummaryForAnalyst(bank),
  }, null, 2);
  return ollamaChat({ model, system, user, schema: WEAKEST_BULLET_SCHEMA, numPredict: 1024 });
}

const UNSUPPORTED_EXPLAIN_SCHEMA = {
  type: "object",
  properties: {
    keyword: { type: "string" },
    status: { type: "string", enum: ["unclaimable", "missing_claimable", "skills_only", "supported"] },
    explanation: { type: "string" },
    closest_evidence: { type: "array", items: { type: "string" }, maxItems: 5 },
  },
  required: ["keyword", "status", "explanation", "closest_evidence"],
};

export async function explainUnsupportedKeyword(keyword, jd, bank, auditEntry, { model } = {}) {
  const system = `${ANALYST_RULES}

Explain why a JD keyword is or is not supported by the candidate bank.
Reference only AC facts and keywords supplied. Do not invent experience.`;
  const user = JSON.stringify({
    keyword,
    job_description_excerpt: jd.trim().slice(0, 3000),
    audit_entry: auditEntry || {},
    related_acs: bankSummaryForAnalyst(bank).filter((ac) =>
      JSON.stringify(ac).toLowerCase().includes(String(keyword).toLowerCase()),
    ).slice(0, 8),
  }, null, 2);
  return ollamaChat({ model, system, user, schema: UNSUPPORTED_EXPLAIN_SCHEMA, numPredict: 768 });
}

const DUPLICATE_STORIES_SCHEMA = {
  type: "object",
  properties: {
    duplicate_groups: {
      type: "array",
      maxItems: 8,
      items: {
        type: "object",
        properties: {
          ac_ids: { type: "array", items: { type: "string" } },
          reason: { type: "string" },
          recommendation: { type: "string" },
        },
        required: ["ac_ids", "reason", "recommendation"],
      },
    },
  },
  required: ["duplicate_groups"],
};

export async function findDuplicateStories(bank, { model } = {}) {
  const system = `${ANALYST_RULES}

Find ACs that tell essentially the same story and should rarely appear together on one resume.
Suggest which to keep for different JD types. Do not merge or rewrite facts.`;
  const user = JSON.stringify({ ac_bank: bankSummaryForAnalyst(bank) }, null, 2);
  return ollamaChat({ model, system, user, schema: DUPLICATE_STORIES_SCHEMA, numPredict: 2048 });
}

const FACET_SUGGEST_SCHEMA = {
  type: "object",
  properties: {
    ac_id: { type: "string" },
    suggested_facets: {
      type: "array",
      maxItems: 6,
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          phrase: { type: "string" },
          keywords: { type: "array", items: { type: "string" }, maxItems: 6 },
          rationale: { type: "string" },
        },
        required: ["name", "phrase", "keywords", "rationale"],
      },
    },
    suggested_variant_previews: {
      type: "array",
      maxItems: 4,
      items: {
        type: "object",
        properties: {
          facet: { type: "string" },
          preview_text: { type: "string" },
        },
        required: ["facet", "preview_text"],
      },
    },
  },
  required: ["ac_id", "suggested_facets"],
};

export async function suggestFacetsForAc(ac, { model } = {}) {
  const system = `${ANALYST_RULES}

Suggest additional semantic facets and preview variant wording for human approval.
Previews are authoring suggestions only — they do NOT go to the final resume automatically.
Preserve all metrics and facts exactly. Do not invent numbers.`;
  const user = JSON.stringify({
    ac: {
      id: ac.id,
      fact: ac.fact,
      facets: ac.facets || {},
      variants: (ac.variants || []).map((variant) => ({
        facet: variant.facet,
        emphasis: variant.emphasis,
        text: variant.text,
      })),
      ats_keywords: [...parseAtsKeywords(ac).values()],
    },
  }, null, 2);
  return ollamaChat({ model, system, user, schema: FACET_SUGGEST_SCHEMA, numPredict: 2048 });
}

const ALIAS_SUGGEST_SCHEMA = {
  type: "object",
  properties: {
    alias_groups: {
      type: "array",
      maxItems: 20,
      items: {
        type: "object",
        properties: {
          canonical: { type: "string" },
          aliases: { type: "array", items: { type: "string" }, maxItems: 6 },
          rationale: { type: "string" },
        },
        required: ["canonical", "aliases", "rationale"],
      },
    },
  },
  required: ["alias_groups"],
};

export async function suggestAliases(bank, { model } = {}) {
  const system = `${ANALYST_RULES}

Suggest alias groups for ATS semantic matching based on the bank's real terminology.
Only group terms that refer to the same underlying evidence.`;
  const user = JSON.stringify({ ac_bank: bankSummaryForAnalyst(bank) }, null, 2);
  return ollamaChat({ model, system, user, schema: ALIAS_SUGGEST_SCHEMA, numPredict: 2048 });
}

const MISSING_AC_SCHEMA = {
  type: "object",
  properties: {
    gaps: {
      type: "array",
      maxItems: 8,
      items: {
        type: "object",
        properties: {
          theme: { type: "string" },
          jd_signal: { type: "string" },
          frequency_note: { type: "string" },
          suggested_fact_angle: { type: "string" },
        },
        required: ["theme", "jd_signal", "frequency_note", "suggested_fact_angle"],
      },
    },
  },
  required: ["gaps"],
};

export async function recommendMissingAcs(jdSamples, bank, { model } = {}) {
  const system = `${ANALYST_RULES}

Given multiple JD excerpts and the current AC bank, recommend missing accomplishment themes the bank should add.
These are authoring recommendations for human review — not resume output.`;
  const user = JSON.stringify({
    jd_samples: (jdSamples || []).map((jd) => String(jd).slice(0, 1200)),
    ac_bank: bankSummaryForAnalyst(bank),
  }, null, 2);
  return ollamaChat({ model, system, user, schema: MISSING_AC_SCHEMA, numPredict: 2048 });
}

const LIBRARIAN_SCHEMA = {
  type: "object",
  properties: {
    bank_health_summary: { type: "string" },
    authoring_suggestions: {
      type: "array",
      maxItems: 12,
      items: {
        type: "object",
        properties: {
          ac: { type: "string" },
          suggestion: { type: "string" },
          rationale: { type: "string" },
          priority: { type: "string", enum: ["high", "medium", "low"] },
        },
        required: ["ac", "suggestion", "rationale", "priority"],
      },
    },
    alias_suggestions: {
      type: "array",
      maxItems: 10,
      items: {
        type: "object",
        properties: {
          canonical: { type: "string" },
          aliases: { type: "array", items: { type: "string" }, maxItems: 5 },
          rationale: { type: "string" },
        },
        required: ["canonical", "aliases", "rationale"],
      },
    },
    duplicate_story_warnings: {
      type: "array",
      maxItems: 6,
      items: {
        type: "object",
        properties: {
          ac_ids: { type: "array", items: { type: "string" } },
          recommendation: { type: "string" },
        },
        required: ["ac_ids", "recommendation"],
      },
    },
    coverage_gaps: {
      type: "array",
      maxItems: 10,
      items: {
        type: "object",
        properties: {
          keyword: { type: "string" },
          status: { type: "string" },
          recommendation: { type: "string" },
        },
        required: ["keyword", "status", "recommendation"],
      },
    },
  },
  required: ["bank_health_summary", "authoring_suggestions", "coverage_gaps"],
};

export async function librarianReview(jd, composition, plan, bank, { model } = {}) {
  const system = `${ANALYST_RULES}

You are the AC bank librarian. Your job is to improve the evidence library over time.
Suggest facets, aliases, splits, and coverage fixes for HUMAN APPROVAL.
Never modify production YAML. Never rewrite resume bullets.
Only suggest changes grounded in existing facts.`;
  const user = JSON.stringify({
    job_description_excerpt: jd.trim().slice(0, 5000),
    composition: compactCompositionForAnalyst(composition),
    planner: {
      routes: plan?.routes || {},
      missing_claimable: composition.coverage?.missing_claimable || [],
      unclaimable: composition.coverage?.unclaimable || [],
    },
    ac_bank: bankSummaryForAnalyst(bank),
  }, null, 2);
  return ollamaChat({ model, system, user, schema: LIBRARIAN_SCHEMA, numPredict: 2560 });
}

export async function runAnalystPipeline({
  jd,
  composition,
  plan,
  bank,
  tasks = ["extract", "verify", "readability", "weakest", "librarian"],
  model,
  onProgress,
}) {
  const out = { model: model || "gemma4:12b", tasks: {}, errors: {} };
  const run = async (name, fn) => {
    onProgress?.(name, "start");
    try {
      const result = await fn();
      out.tasks[name] = {
        parsed: result.parsed,
        parse_error: result.parseError,
        done_reason: result.doneReason,
        eval_count: result.evalCount,
      };
      if (result.parseError) out.errors[name] = result.parseError;
    } catch (error) {
      out.errors[name] = error.message;
      out.tasks[name] = { error: error.message };
    }
    onProgress?.(name, "done");
  };

  if (tasks.includes("extract")) await run("extract", () => extractJdCapabilities(jd, { model }));
  if (tasks.includes("verify")) await run("verify", () => verifyPlanner(jd, plan, bank, { model }));
  if (tasks.includes("readability")) await run("readability", () => scoreReadability(jd, composition, { model }));
  if (tasks.includes("weakest")) await run("weakest", () => recommendWeakestSwap(jd, composition, bank, { model }));
  if (tasks.includes("librarian")) await run("librarian", () => librarianReview(jd, composition, plan, bank, { model }));

  if (tasks.includes("unsupported")) {
    const audit = composition.coverage?.audit || {};
    const targets = Object.entries(audit)
      .filter(([, entry]) => entry.status === "unclaimable" || entry.status === "missing_claimable")
      .slice(0, 5);
    out.tasks.unsupported = [];
    for (const [keyword, entry] of targets) {
      onProgress?.(`unsupported:${keyword}`, "start");
      try {
        const result = await explainUnsupportedKeyword(keyword, jd, bank, entry, { model });
        out.tasks.unsupported.push({
          keyword,
          parsed: result.parsed,
          parse_error: result.parseError,
        });
      } catch (error) {
        out.errors[`unsupported:${keyword}`] = error.message;
        out.tasks.unsupported.push({ keyword, error: error.message });
      }
      onProgress?.(`unsupported:${keyword}`, "done");
    }
  }

  return out;
}
