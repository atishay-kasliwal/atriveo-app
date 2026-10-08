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
.skills { margin-left: 0.15in; font-size: 10pt; }
.pagedjs_page { background: #fff; box-shadow: 0 2px 14px rgba(0,0,0,.45); margin: 0 auto 18px; }
@media screen { body { background: #3a3d42; padding: 14px 0; } }
`;

function resumeHtml(layout: Layout, p: { title: string; email: string; city: string; sections: PreviewSection[]; skills: string[] }) {
  const contact = [p.title, layout.phone, p.email, layout.linkedin, layout.github, p.city].filter(Boolean).map((x) => esc(String(x))).join(" | ");
  const exp = p.sections.filter((s) => s.kind === "experience" && s.bullets.length)
    .sort((a, b) => (layout.roles[b.role]?.order ?? 0) - (layout.roles[a.role]?.order ?? 0))
    .map((s) => {
      const m = layout.roles[s.role] ?? { name: s.role, dates: "", place: "", order: 0, title: null };
      const title = s.role === "stony-brook" ? sbTitle(p.title, layout.sbTitleOverrides) : m.title ?? "";
      return `<div class="entry"><div class="row"><b>${esc(m.name)}</b><span>${dates(m.dates)}</span></div>
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

/** Renders the resume live; calls onPages with the page count after each render. */
export default function ResumeLivePreview({ layout, title, email, city, sections, skills, onPages }: {
  layout: Layout; title: string; email: string; city: string; sections: PreviewSection[]; skills: string[]; onPages: (n: number) => void;
}) {
  const body = useMemo(() => resumeHtml(layout, { title, email, city, sections, skills }), [layout, title, email, city, sections, skills]);
  const [doc, setDoc] = useState("");
  const id = useRef(0);
  // A short pause after typing, then one Paged.js run in a fresh frame (it paginates once per document).
  useEffect(() => {
    const t = setTimeout(() => {
      const n = ++id.current;
      setDoc(`<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style><script>
        window.PagedConfig = { auto: true, after: (flow) => {
          const w = document.querySelector(".pagedjs_page")?.getBoundingClientRect().width || 816;
          document.body.style.zoom = Math.min(1, (window.innerWidth - 24) / w);
          parent.postMessage({ type: "rb-pages", id: ${n}, pages: flow.total }, "*");
        } };
      </script><script src="${pagedPolyfill}"></script></head><body>${body}</body></html>`);
    }, 150);
    return () => clearTimeout(t);
  }, [body]);
  useEffect(() => {
    const on = (e: MessageEvent) => { if (e.data?.type === "rb-pages" && e.data.id === id.current) onPages(e.data.pages); };
    window.addEventListener("message", on);
    return () => window.removeEventListener("message", on);
  }, [onPages]);
  return <iframe className="rb-live" title="Live resume preview" sandbox="allow-scripts allow-same-origin" srcDoc={doc} />;
}
