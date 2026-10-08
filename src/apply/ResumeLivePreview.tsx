import { useEffect, useMemo, useRef, useState } from "react";
// By file path: the package's exports map leaves out the polyfill build.
import pagedPolyfill from "../../node_modules/pagedjs/dist/paged.polyfill.min.js?url";

// The resume builder's live preview: the resume as HTML in the PDF template's layout (Letter, 0.5in margins, 11pt,
// Computer Modern), paginated by Paged.js in its own frame, so every edit shows at once with its page count.
// It mirrors the LaTeX template (scripts/ac-tex.mjs assembleAcResume) closely but not to the pixel: the compiled PDF
// stays the one that's sent, and Save waits for it (docs/resume-builder.md).

export interface Layout {
  name: string; phone: string | null; linkedin: string | null; github: string | null;
  education: Array<{ school: string; place: string; degree: string; dates: string }>;
  roles: Record<string, { name: string; dates: string; place: string; order: number; title: string | null }>;
  projects: Record<string, { name: string; dates: string; rank: number }>;
  sbTitleOverrides: Record<string, string>;
}
export interface PreviewSection { role: string; kind: "experience" | "project"; bullets: Array<{ text: string }>; tools?: string[] }

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const dates = (s: string) => esc(s).replace(/--/g, "–");
// As ac-tracks.employerTitle: Stony Brook shows the header title without seniority words.
const LEVEL_WORDS = /\b(?:senior|sr|staff|lead|principal|junior|jr|associate|entry level|new grad(?:uate)?|graduate|intern(?:ship)?|[ivx]+|\d+)\b\.?/gi;
const sbTitle = (title: string, overrides: Record<string, string>) => {
  const role = title.replace(LEVEL_WORDS, " ").replace(/[\s,–—-]+$/, "").replace(/\s+/g, " ").trim();
  return overrides[role] ?? role;
};

const CSS = `
@import url("https://cdn.jsdelivr.net/gh/bitmaks/cm-web-fonts@latest/fonts.css");
@page { size: letter; margin: 0.5in; }
html, body { margin: 0; }
body { font-family: "Computer Modern Serif", "Latin Modern Roman", "CMU Serif", "Times New Roman", serif; font-size: 11pt; line-height: 1.2; color: #000; }
.name { text-align: center; font-size: 24.9pt; font-weight: bold; font-variant: small-caps; line-height: 1.1; }
.contact { text-align: center; font-size: 9pt; margin-top: 1pt; white-space: nowrap; }
h2 { font-size: 12pt; font-weight: normal; margin: 4pt 0 3pt; padding-bottom: 1pt; border-bottom: 0.6pt solid #000; }
.row { display: flex; justify-content: space-between; gap: 8pt; }
.entry { margin: 0 0 1pt 0.15in; }
.entry + .entry { margin-top: 2pt; }
.sub { font-style: italic; font-size: 10pt; }
ul { margin: 1pt 0 3pt; padding-left: 0.3in; }
li { font-size: 10pt; margin: 0; }
.proj { font-size: 10pt; } .proj em { font-style: italic; }
.tools { font-size: 10pt; }
.row > .head { white-space: nowrap; min-width: 0; overflow: hidden; } /* as the PDF: a long name | tools line never wraps */
.skills { margin-left: 0.15in; font-size: 10pt; }
.pagedjs_page { background: #fff; box-shadow: 0 2px 14px rgba(0,0,0,.45); margin: 0 auto 12px; }
@media screen { body { background: #3a3d42; padding: 10px 0; } }
`;

function resumeHtml(layout: Layout, p: { title: string; email: string; city: string; sections: PreviewSection[]; skills: string[] }) {
  const contact = [p.title, layout.phone, p.email, layout.linkedin, layout.github, p.city].filter(Boolean).map((x) => esc(String(x))).join(" | ");
  const exp = p.sections.filter((s) => s.kind === "experience" && s.bullets.length)
    .sort((a, b) => (layout.roles[b.role]?.order ?? 0) - (layout.roles[a.role]?.order ?? 0))
    .map((s) => {
      const m = layout.roles[s.role] ?? { name: s.role, dates: "", place: "", order: 0, title: null };
      const title = s.role === "stony-brook" ? sbTitle(p.title, layout.sbTitleOverrides) : m.title ?? "";
      return `<div class="entry"><div class="row"><span class="head"><b>${esc(m.name)}</b>${s.tools?.length ? ` | <em class="tools">${esc(s.tools.join(", "))}</em>` : ""}</span><span>${dates(m.dates)}</span></div>
        <div class="row sub"><span>${esc(title)}</span><span>${esc(m.place)}</span></div>
        <ul>${s.bullets.map((b) => `<li>${esc(b.text)}</li>`).join("")}</ul></div>`;
    }).join("");
  const proj = p.sections.filter((s) => s.kind === "project" && s.bullets.length)
    .sort((a, b) => (layout.projects[a.role]?.rank ?? 99) - (layout.projects[b.role]?.rank ?? 99))
    .map((s) => {
      const m = layout.projects[s.role] ?? { name: s.role, dates: "", rank: 99 };
      return `<div class="entry"><div class="row"><span class="proj"><b>${esc(m.name)}</b>${s.tools?.length ? ` | <em>${esc(s.tools.join(", "))}</em>` : ""}</span><span>${dates(m.dates)}</span></div>
        <ul>${s.bullets.map((b) => `<li>${esc(b.text)}</li>`).join("")}</ul></div>`;
    }).join("");
  const skills = p.skills.filter((l) => l.includes(":")).map((l) => `<div><b>${esc(l.split(":")[0]!)}</b>: ${esc(l.split(":").slice(1).join(":").trim())}</div>`).join("");
  const edu = layout.education.map((e) => `<div class="entry"><div class="row"><b>${esc(e.school)}</b><span>${dates(e.dates)}</span></div><div class="row sub"><span>${esc(e.degree)}</span><span>${esc(e.place)}</span></div></div>`).join("");
  return `<div class="name">${esc(layout.name)}</div><div class="contact">${contact}</div>
    <h2>Education</h2>${edu}<h2>Experience</h2>${exp}<h2>Projects</h2>${proj}<h2>Technical Skills</h2><div class="skills">${skills}</div>`;
}

/** The page count and the room left: lines free on the last page (negative: lines past one page). */
export interface LiveFit { pages: number; lines: number }

/** Renders the resume live, the whole page in view; calls onFit after each render. */
export default function ResumeLivePreview({ layout, title, email, city, sections, skills, onFit }: {
  layout: Layout; title: string; email: string; city: string; sections: PreviewSection[]; skills: string[]; onFit: (f: LiveFit) => void;
}) {
  const body = useMemo(() => resumeHtml(layout, { title, email, city, sections, skills }), [layout, title, email, city, sections, skills]);
  const [doc, setDoc] = useState("");
  const id = useRef(0);
  // A short pause after typing, then one Paged.js run in a fresh frame (it paginates once per document).
  useEffect(() => {
    const t = setTimeout(() => {
      const n = ++id.current;
      setDoc(`<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style><script>
        // A bullet line is 10pt at 1.2 line height = 16px. Measured before zooming, in CSS pixels.
        const used = (page) => {
          const box = page.querySelector(".pagedjs_page_content");
          if (!box) return 0;
          // The lowest line of text (Paged.js's wrapper boxes can stretch to the page's height).
          const rows = [...box.querySelectorAll("li, .row, .skills > div, .name, .contact, h2")];
          const bottom = Math.max(0, ...rows.map((el) => el.getBoundingClientRect().bottom - box.getBoundingClientRect().top));
          return bottom;
        };
        const fit = () => {
          const pg = document.querySelector(".pagedjs_page");
          if (!pg) return;
          const { width, height } = pg.getBoundingClientRect();
          const z = parseFloat(document.body.style.zoom || "1");
          // The whole first page in view: as wide and as tall as the frame allows.
          document.body.style.zoom = Math.min(1.6, (window.innerWidth - 20) / (width / z), (window.innerHeight - 20) / (height / z));
        };
        window.addEventListener("resize", fit);
        window.PagedConfig = { auto: true, after: (flow) => {
          const pages = [...document.querySelectorAll(".pagedjs_page")];
          const box = pages[0]?.querySelector(".pagedjs_page_content")?.getBoundingClientRect().height || 960;
          const lines = pages.length <= 1
            ? Math.floor((box - used(pages[0])) / 16)
            : -Math.ceil(pages.slice(1).reduce((n, p) => n + used(p), 0) / 16);
          fit();
          parent.postMessage({ type: "rb-pages", id: ${n}, pages: flow.total, lines }, "*");
        } };
      </script><script src="${pagedPolyfill}"></script></head><body>${body}</body></html>`);
    }, 150);
    return () => clearTimeout(t);
  }, [body]);
  useEffect(() => {
    const on = (e: MessageEvent) => { if (e.data?.type === "rb-pages" && e.data.id === id.current) onFit({ pages: e.data.pages, lines: e.data.lines }); };
    window.addEventListener("message", on);
    return () => window.removeEventListener("message", on);
  }, [onFit]);
  return <iframe className="rb-live" title="Live resume preview" sandbox="allow-scripts allow-same-origin" srcDoc={doc} />;
}
