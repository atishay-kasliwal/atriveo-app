#!/usr/bin/env node
/**
 * Rebuilds src/data/us-states.json (state borders for "Use my location") from us-atlas.
 *   npm pack us-atlas@3 && tar xzf us-atlas-*.tgz
 *   node scripts/build-us-states.mjs package/states-10m.json scripts/place.mjs src/data/us-states.json
 * Output: { "WA": [ring, ...] }, each ring a flat list of hundredths of a degree, the first pair absolute and the rest
 * deltas: [lon0, lat0, dlon1, dlat1, ...]. About 1 km of precision, enough to tell which state you are in.
 */
import fs from 'node:fs';
const [, , input, placeModule, output] = process.argv;
const topo = JSON.parse(fs.readFileSync(input, 'utf8'));
const { STATES } = await import(new URL(placeModule, `file://${process.cwd()}/`).href);
const byName = new Map(STATES.map(([c, n]) => [n, c]));
const { scale: [sx, sy], translate: [tx, ty] } = topo.transform;
const arcs = topo.arcs.map((arc) => { let x = 0, y = 0; return arc.map(([dx, dy]) => { x += dx; y += dy; return [x * sx + tx, y * sy + ty]; }); });
const ring = (ids) => { const pts = []; ids.forEach((i, k) => { const a = i < 0 ? arcs[~i].slice().reverse() : arcs[i]; pts.push(...(k ? a.slice(1) : a)); }); return pts; };
const out = {}; const skipped = [];
for (const g of topo.objects.states.geometries) {
  const code = byName.get(g.properties.name);
  if (!code) { skipped.push(g.properties.name); continue; }
  const polys = g.type === 'Polygon' ? [g.arcs] : g.arcs;
  const rings = [];
  for (const poly of polys) for (const r of poly) {
    let px = null, py = null; const flat = [];
    for (const [lon, lat] of ring(r)) {
      const x = Math.round(lon * 100), y = Math.round(lat * 100);
      if (x === px && y === py) continue;
      flat.push(px === null ? x : x - px, py === null ? y : y - py); px = x; py = y;
    }
    if (flat.length >= 6) rings.push(flat);
  }
  out[code] = rings;
}
fs.writeFileSync(output, JSON.stringify(out));
console.log('states', Object.keys(out).length, 'skipped', skipped.join(', '), 'bytes', fs.statSync(output).size);
