// Metric helpers extracted from PDF gate (shared with scorer).

function bulletText(bullet) {
  return String(bullet.face?.text || bullet.text || "").trim();
}

function collectBullets(composition) {
  const bullets = [];
  for (const role of composition.experience || []) {
    for (const b of role.bullets || []) bullets.push(b);
  }
  for (const project of composition.projects || []) {
    for (const b of project.bullets || []) bullets.push(b);
  }
  return bullets;
}

function wordCount(composition, skills) {
  const bullets = collectBullets(composition);
  const text = [...bullets.map(bulletText), ...(skills || composition.skills || [])].join(" ");
  return text.split(/\s+/).filter(Boolean).length;
}

export function evidenceCompressionRatio(composition, skills) {
  const bullets = collectBullets(composition);
  const words = wordCount(composition, skills);
  const quantified = bullets.filter((b) => /\d/.test(bulletText(b))).length;
  const technologies = new Set();
  for (const b of bullets) {
    for (const t of (bulletText(b).match(/\b(fastapi|aws|kafka|docker|python|react|langchain|pytorch|redis|postgresql|spring|firebase|lambda)\b/gi) || [])) {
      technologies.add(t.toLowerCase());
    }
  }
  const systems = bullets.filter((b) => /platform|pipeline|system|microservice/i.test(bulletText(b))).length;
  const aiPipelines = bullets.filter((b) => /rag|agent|llm|ai\b/i.test(bulletText(b))).length;
  const verifiedImpact = quantified * 3 + technologies.size * 2 + systems * 4 + aiPipelines * 5;
  const ratio = words > 0 ? Number((verifiedImpact / words).toFixed(3)) : 0;
  return {
    verified_impact: { quantified_achievements: quantified, technologies: technologies.size, major_systems: systems, production_ai_pipelines: aiPipelines, bullet_count: bullets.length },
    words_in_resume: words,
    ratio,
  };
}
