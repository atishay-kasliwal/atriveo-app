// Builds the public landing pages into dist-apply/landing/ (or the folder given as argv[2]).
// Runs at the end of `npm run build:apply`, after the console build has emptied dist-apply/.
// Output: index.html, workflow/index.html, 404.html, styles.css, sitemap.xml, assets/ (captures,
// font, favicon, og.png) and assets/motion.js (GSAP + Lenis, bundled by Vite).
import fs from 'node:fs';
import path from 'node:path';
import { build } from 'vite';
import { home, workflow, missing } from '../landing/pages.mjs';
import { site } from '../landing/content.mjs';

const out = path.resolve(process.argv[2] || 'dist-apply/landing');
const write = (file, text) => {
  fs.mkdirSync(path.dirname(path.join(out, file)), { recursive: true });
  fs.writeFileSync(path.join(out, file), text);
};

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
fs.cpSync('landing/assets', path.join(out, 'assets'), { recursive: true });
fs.copyFileSync('landing/styles.css', path.join(out, 'styles.css'));
write('index.html', home());
write('workflow/index.html', workflow());
write('404.html', missing());

const today = new Date().toISOString().slice(0, 10);
const urls = [site.url, `${site.url}workflow/`];
write(
  'sitemap.xml',
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
    .map((u) => `  <url><loc>${u}</loc><lastmod>${today}</lastmod></url>`)
    .join('\n')}\n</urlset>\n`,
);

await build({
  configFile: false,
  publicDir: false,
  logLevel: 'warn',
  build: {
    outDir: out,
    emptyOutDir: false,
    minify: true,
    target: 'es2020',
    rollupOptions: {
      input: 'landing/motion.js',
      output: { entryFileNames: 'assets/motion.js', chunkFileNames: 'assets/[name]-[hash].js' },
    },
  },
});
console.log(`landing built into ${path.relative(process.cwd(), out) || out}`);
