// Rulebook unique-verb helpers — NOT applied to final PDF text (INVARIANT requires exact variants).
// Gemma review (ac-analyst) may recommend swaps; human/bank updates only.

const VERB_SYNONYMS = {
  built: ["Engineered", "Architected", "Developed", "Deployed"],
  engineered: ["Built", "Architected", "Designed", "Developed"],
  developed: ["Built", "Engineered", "Designed", "Implemented"],
  designed: ["Architected", "Built", "Engineered", "Structured"],
  architected: ["Built", "Engineered", "Designed", "Structured"],
  automated: ["Streamlined", "Optimized", "Orchestrated", "Accelerated"],
  optimized: ["Improved", "Reduced", "Streamlined", "Tuned"],
  reduced: ["Cut", "Lowered", "Decreased", "Shrunk"],
  scaled: ["Grew", "Expanded", "Extended"],
  deployed: ["Shipped", "Released", "Launched", "Rolled out"],
  implemented: ["Built", "Developed", "Deployed", "Integrated"],
  owned: ["Drove", "Directed", "Managed"],
};

function firstWord(text) {
  return (String(text).trim().match(/^([A-Za-z]+)/) || [])[1] || "";
}

function swapVerb(text, used) {
  const w = firstWord(text);
  if (!w) return text;
  const lower = w.toLowerCase();
  if (!used.has(lower)) {
    used.add(lower);
    return text;
  }
  const opts = VERB_SYNONYMS[lower] || [];
  for (const alt of opts) {
    const key = alt.toLowerCase();
    if (!used.has(key)) {
      used.add(key);
      return alt + text.slice(w.length);
    }
  }
  return text;
}

function patchBulletText(bullet, used) {
  if (bullet.face?.text) {
    bullet.face = { ...bullet.face, text: swapVerb(bullet.face.text, used) };
  } else if (bullet.text) {
    bullet.text = swapVerb(bullet.text, used);
  }
}

export function dedupeCompositionVerbs(composition) {
  const used = new Set();
  const next = {
    ...composition,
    experience: (composition.experience || []).map((role) => ({
      ...role,
      bullets: (role.bullets || []).map((b) => {
        const copy = { ...b, ac: b.ac, face: b.face ? { ...b.face } : undefined };
        patchBulletText(copy, used);
        return copy;
      }),
    })),
    projects: (composition.projects || []).map((project) => ({
      ...project,
      bullets: (project.bullets || []).map((b) => {
        const copy = { ...b, ac: b.ac, face: b.face ? { ...b.face } : undefined };
        patchBulletText(copy, used);
        return copy;
      }),
    })),
  };
  return next;
}
