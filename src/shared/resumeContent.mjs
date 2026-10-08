/** AI patches contain content only. Clone the existing sections so all identity/layout metadata survives. */
export function applyContentChanges(sections, skills, changes) {
  const next = structuredClone(sections);
  let nextSkills = skills;
  const seen = new Set();
  for (const change of changes) {
    if (change.kind === 'skills') {
      if (seen.has('skills') || !Array.isArray(change.skills) || change.skills.some(s => typeof s !== 'string')) throw new Error('Invalid skills patch');
      if (skills !== change.current) throw new Error('Skills changed. Refresh AI Match.');
      nextSkills = change.skills.join('\n'); seen.add('skills');
    } else if (change.kind === 'section') {
      const section = next[change.si];
      if (!section || !['experience','project'].includes(section.kind) || seen.has(change.si)) throw new Error('Invalid content section');
      if (JSON.stringify(section.bullets) !== change.originalHashInput) throw new Error('Resume changed. Refresh AI Match.');
      if (!Array.isArray(change.bullets) || change.bullets.some(b => typeof b.text !== 'string' || typeof b.ac_id !== 'string')) throw new Error('Invalid bullets');
      // Only bullet fields cross this boundary; role, label, kind, stack and all other metadata are untouched.
      section.bullets = change.bullets.map(b => ({ ac_id:b.ac_id, facet:b.facet ?? null, text:b.text, custom:true }));
      seen.add(change.si);
    } else throw new Error('AI can modify only Experience, Technical Skills and Projects');
  }
  return {sections:next,skills:nextSkills};
}
