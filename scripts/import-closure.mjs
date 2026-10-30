import fs from "node:fs";
import path from "node:path";

/** Every local file an entry script imports, directly or not (relative imports only), as paths relative to `root`, entry first. */
export function importClosure(entry, root = process.cwd()) {
  const seen = new Set(), queue = [path.resolve(root, entry)];
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    const source = fs.readFileSync(file, "utf8");
    for (const m of source.matchAll(/(?:from\s*|import\s*\(\s*|import\s+)["'](\.{1,2}\/[^"']+)["']/g)) {
      const target = path.resolve(path.dirname(file), m[1]);
      if (fs.existsSync(target) && fs.statSync(target).isFile()) queue.push(target);
    }
  }
  return [...seen].map((f) => path.relative(root, f)).sort((a, b) => (a === entry ? -1 : b === entry ? 1 : a.localeCompare(b)));
}

if (import.meta.url === `file://${process.argv[1]}`) for (const f of importClosure(process.argv[2])) console.log(f);
