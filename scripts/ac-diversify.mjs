// Reorder bullets to maximize opening-verb diversity (beam candidate variant).

function bulletText(bullet) {
  return String(bullet.face?.text || bullet.text || "").trim();
}

function openingVerb(bullet) {
  return bulletText(bullet).split(/\s+/)[0]?.toLowerCase().replace(/[^a-z]/g, "") || "";
}

export function diversifyBulletOrder(bullets, proofChain) {
  if (!bullets?.length) return bullets;
  const chainRank = new Map((proofChain || []).map((row, i) => [row.ac_id, i]));
  const usedVerbs = new Set();
  const remaining = [...bullets];
  const ordered = [];

  while (remaining.length) {
    remaining.sort((a, b) => {
      const aId = a.ac?.id || a.ac_id;
      const bId = b.ac?.id || b.ac_id;
      const aChain = chainRank.get(aId) ?? 50;
      const bChain = chainRank.get(bId) ?? 50;
      if (aChain !== bChain) return aChain - bChain;
      const aUnique = usedVerbs.has(openingVerb(a)) ? 1 : 0;
      const bUnique = usedVerbs.has(openingVerb(b)) ? 1 : 0;
      return aUnique - bUnique;
    });
    const pick = remaining.shift();
    ordered.push(pick);
    usedVerbs.add(openingVerb(pick));
  }

  return ordered;
}
