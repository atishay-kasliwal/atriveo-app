// Resume text must remain an exact bank variant. Reject repeated opening verbs
// instead of changing a selected bullet after composition.

export function assertUniqueCompositionVerbs(composition) {
  const seen = new Map();
  for (const block of [...(composition.experience || []), ...(composition.projects || [])]) {
    for (const bullet of block.bullets || []) {
      const text = bullet.face?.text || bullet.text || "";
      const verb = (String(text).trim().match(/^([A-Za-z]+)/) || [])[1]?.toLowerCase();
      if (!verb) throw new Error(`Missing opening verb in ${bullet.ac?.id || block.role}`);
      const id = bullet.ac?.id || block.role;
      if (seen.has(verb)) {
        throw new Error(`Repeated resume opening verb "${verb}" in ${seen.get(verb)} and ${id}`);
      }
      seen.set(verb, id);
    }
  }
}
