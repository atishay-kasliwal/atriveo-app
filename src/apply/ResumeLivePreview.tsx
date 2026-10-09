import {resumeContactLink} from '../shared/resumeContact.mjs';
import { useEffect, useMemo, useRef, useState } from "react";
// By file path: the package's exports map leaves out the polyfill build.
import pagedPolyfill from "../../node_modules/pagedjs/dist/paged.polyfill.min.js?url";

// The resume builder's live preview: the resume as HTML in the PDF template's layout (Letter, 0.5in margins, 11pt,
// Computer Modern), paginated by Paged.js in its own frame, so every edit shows at once with its page count.
// It mirrors the LaTeX template (scripts/ac-tex.mjs assembleAcResume) closely but not to the pixel: the compiled PDF
// stays the one that's sent, and Save waits for it (docs/resume-builder.md).

export interface Layout {
  name: string; phone: string | null; linkedin: string | null; github: string | null; linkedinUrl?:string|null; githubUrl?:string|null;
  education: Array<{ school: string; place: string; degree: string; dates: string }>;
  roles: Record<string, { name: string; dates: string; place: string; order: number; title: string | null }>;
  projects: Record<string, { name: string; dates: string; rank: number }>;
  sbTitleOverrides: Record<string, string>;
  /** A header title containing `match` prints `title` at Stony Brook (TRACKS.yaml stony_brook_title_patterns). */
  sbTitlePatterns?: Array<{ match: string; title: string }>;
}
/** si: the section's place in the editor, so a line on the page maps back to it. */
export interface PreviewSection { si: number; role: string; kind: "experience" | "project"; bullets: Array<{ text: string }>; tools?: string[] }
/** What a click on the page points at. */
export type PageTarget = { kind: "bullet"; si: number; bi: number } | { kind: "section"; si: number } | { kind: "header" } | { kind: "skills"; line: number };

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const dates = (s: string) => esc(s).replace(/--/g, "–");
// As ac-tracks.employerTitle: Stony Brook shows the header title without seniority words.
const LEVEL_WORDS = /\b(?:senior|sr|staff|lead|principal|junior|jr|associate|entry level|new grad(?:uate)?|graduate|intern(?:ship)?|[ivx]+|\d+)\b\.?/gi;
export const sbTitle = (title: string, overrides: Record<string, string>, patterns: Array<{ match: string; title: string }> = []) => {
  const role = title.replace(LEVEL_WORDS, " ").replace(/[\s,–—-]+$/, "").replace(/\s+/g, " ").trim();
  return overrides[role] ?? patterns.find((p) => role.toLowerCase().includes(p.match.toLowerCase()))?.title ?? role;
};

const CSS = `
@import url("https://cdn.jsdelivr.net/gh/bitmaks/cm-web-fonts@latest/fonts.css");
@page { size: letter; margin: 0.5in; }
html, body { margin: 0; }
body { font-family: "Computer Modern Serif", "Latin Modern Roman", "CMU Serif", "Times New Roman", serif; font-size: 11pt; line-height: 1.2; color: #000; }
.name { text-align: center; font-size: 24.9pt; font-weight: bold; font-variant: small-caps; line-height: 1.1; }
.contact a { color: inherit; text-decoration: none; }
.contact { text-align: center; font-size: 8.5pt; margin-top: 1pt; white-space: nowrap; }
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
@media screen { body { padding: 10px 0; } }
/* "squeeze": the PDF is full, so TeX shrank the small gaps to keep one page; the preview does the same. */
.squeeze ul { margin: 0 0 1.5pt; } .squeeze .entry + .entry { margin-top: 0.5pt; } .squeeze h2 { margin: 2.5pt 0 2pt; }
/* Linked to the editor: what you can click, and what's highlighted (no layout change). */
[data-k], [data-s], [data-h], [data-sk] { cursor: pointer; }
.hl { background: rgba(59,130,246,.16); box-shadow: 0 0 0 2px rgba(59,130,246,.16); border-radius: 2px; }
`;

function resumeHtml(layout: Layout, p: { title: string; email: string; city: string; sections: PreviewSection[]; skills: string[] }) {
  const social=(value:string|null|undefined)=>{if(!value)return null;const link=resumeContactLink(value);return link.href?`<a href="${esc(link.href)}" target="_blank" rel="noopener noreferrer">${esc(link.label)}</a>`:esc(link.label);};
  const contact = [esc(p.title),layout.phone&&esc(layout.phone),p.email&&esc(p.email),social(layout.linkedinUrl||layout.linkedin),social(layout.githubUrl||layout.github),p.city&&esc(p.city)].filter(Boolean).join(" | ");
  const items = (s: PreviewSection) => `<ul>${s.bullets.map((b, bi) => `<li data-k="${s.si}:${bi}">${esc(b.text)}</li>`).join("")}</ul>`;
  const exp = p.sections.filter((s) => s.kind === "experience" && s.bullets.length)
    .sort((a, b) => (layout.roles[b.role]?.order ?? 0) - (layout.roles[a.role]?.order ?? 0))
    .map((s) => {
      const m = layout.roles[s.role] ?? { name: s.role, dates: "", place: "", order: 0, title: null };
      const title = s.role === "stony-brook" ? sbTitle(p.title, layout.sbTitleOverrides, layout.sbTitlePatterns) : m.title ?? "";
      return `<div class="entry"><div class="row" data-s="${s.si}"><span class="head"><b>${esc(m.name)}</b>${s.tools?.length ? ` | <em class="tools">${esc(s.tools.join(", "))}</em>` : ""}</span><span>${dates(m.dates)}</span></div>
        <div class="row sub" data-s="${s.si}"><span>${esc(title)}</span><span>${esc(m.place)}</span></div>
        ${items(s)}</div>`;
    }).join("");
  const proj = p.sections.filter((s) => s.kind === "project" && s.bullets.length)
    .sort((a, b) => (layout.projects[a.role]?.rank ?? 99) - (layout.projects[b.role]?.rank ?? 99))
    .map((s) => {
      const m = layout.projects[s.role] ?? { name: s.role, dates: "", rank: 99 };
      return `<div class="entry"><div class="row" data-s="${s.si}"><span class="proj"><b>${esc(m.name)}</b>${s.tools?.length ? ` | <em>${esc(s.tools.join(", "))}</em>` : ""}</span><span>${dates(m.dates)}</span></div>
        ${items(s)}</div>`;
    }).join("");
  const skills = p.skills.map((l, i) => ({ l, i })).filter(({ l }) => l.includes(":")).map(({ l, i }) => `<div data-sk="${i}"><b>${esc(l.split(":")[0]!)}</b>: ${esc(l.split(":").slice(1).join(":").trim())}</div>`).join("");
  const edu = layout.education.map((e) => `<div class="entry"><div class="row"><b>${esc(e.school)}</b><span>${dates(e.dates)}</span></div><div class="row sub"><span>${esc(e.degree)}</span><span>${esc(e.place)}</span></div></div>`).join("");
  return `<div class="name">${esc(layout.name)}</div><div class="contact" data-h="1">${contact}</div>
    <h2>Education</h2>${edu}<h2>Experience</h2>${exp}<h2>Projects</h2>${proj}<h2>Technical Skills</h2><div class="skills">${skills}</div>`;
}

/** The page count and the room left: lines free on the last page (negative: lines past one page). bullets: each
 *  bullet's printed lines ("si:bi" → n); measured: the lines each of `measure`'s texts would take as a bullet. */
export interface LiveFit { pages: number; lines: number; bullets: Record<string, number>; measured: number[] }

// Runs inside the frame (as a string): measures the page, then talks to the editor by postMessage.
const FRAME_SCRIPT = (n: number, mode: "fit" | "width") => `
  // A bullet line is 10pt at 1.2 line height = 16px. Measured before zooming, in CSS pixels.
  const used = (page) => {
    const box = page.querySelector(".pagedjs_page_content");
    if (!box) return 0;
    // The lowest line of text (Paged.js's wrapper boxes can stretch to the page's height).
    const rows = [...box.querySelectorAll("li, .row, .skills > div, .name, .contact, h2")];
    return Math.max(0, ...rows.map((el) => el.getBoundingClientRect().bottom - box.getBoundingClientRect().top));
  };
  const fit = () => {
    const pg = document.querySelector(".pagedjs_page");
    if (!pg) return;
    const { width, height } = pg.getBoundingClientRect();
    const z = parseFloat(document.body.style.zoom || "1");
    // "fit": the whole first page in view; "width": as wide as the frame (phones scroll down the page).
    const zw = (window.innerWidth - (${mode === "width" ? 8 : 20})) / (width / z);
    document.body.style.zoom = ${mode === "width" ? "zw" : "Math.min(1.6, zw, (window.innerHeight - 20) / (height / z))"};
    const paper = pg.getBoundingClientRect();
    // Trim 20% of the grey surround, without changing the page scale or iframe viewport.
    post({type:"rb-frame",left:Math.max(0,paper.left)*.2,right:Math.max(0,window.innerWidth-paper.right)*.2});
  };
  window.addEventListener("resize", fit);
  // Each bullet's lines, and the lines a text would take as a bullet (a hidden list as wide as the page's).
  const linesOf = (el) => Math.max(1, Math.round(el.getBoundingClientRect().height / (parseFloat(getComputedStyle(el).lineHeight) || 16)));
  const measureTexts = () => {
    const ul = document.querySelector(".pagedjs_page_content ul");
    const texts = window.RB_MEASURE || [];
    if (!ul || !texts.length) return [];
    const box = document.createElement("div");
    box.style.cssText = "position:absolute;visibility:hidden;left:0;top:0;width:" + ul.getBoundingClientRect().width + "px";
    const list = document.createElement("ul"); list.style.margin = "0";
    for (const t of texts) { const li = document.createElement("li"); li.textContent = t; list.appendChild(li); }
    box.appendChild(list); ul.parentNode.appendChild(box);
    const out = [...list.children].map(linesOf);
    box.remove();
    return out;
  };
  const post = (m) => parent.postMessage(Object.assign({ id: ${n} }, m), "*");
  window.PagedConfig = { auto: true, after: (flow) => {
    const pages = [...document.querySelectorAll(".pagedjs_page")];
    const box = pages[0]?.querySelector(".pagedjs_page_content")?.getBoundingClientRect().height || 960;
    const lines = pages.length <= 1
      ? Math.floor((box - used(pages[0])) / 16)
      : -Math.ceil(pages.slice(1).reduce((n, p) => n + used(p), 0) / 16);
    // A bullet split across pages has two pieces with the same key: add them up.
    const bullets = {};
    for (const li of document.querySelectorAll("li[data-k]")) bullets[li.dataset.k] = (bullets[li.dataset.k] || 0) + linesOf(li);
    const measured = measureTexts();
    fit();
    post({ type: "rb-pages", pages: flow.total, lines, bullets, measured });
  } };
  // Clicks and hovers go to the editor; the editor's highlight comes back.
  const targetOf = (el) => {
    const k = el.closest("[data-k]"); if (k) { const [si, bi] = k.dataset.k.split(":").map(Number); return { kind: "bullet", si, bi }; }
    const s = el.closest("[data-s]"); if (s) return { kind: "section", si: Number(s.dataset.s) };
    if (el.closest("[data-h]")) return { kind: "header" };
    const sk = el.closest("[data-sk]"); if (sk) return { kind: "skills", line: Number(sk.dataset.sk) };
    return null;
  };
  document.addEventListener("click", (e) => { const t = targetOf(e.target); if (t) post({ type: "rb-pick", target: t }); });
  let hovered = null;
  document.addEventListener("mouseover", (e) => { const k = e.target.closest?.("[data-k]")?.dataset.k || null; if (k !== hovered) { hovered = k; post({ type: "rb-hover", key: k }); } });
  document.addEventListener("mouseleave", () => { hovered = null; post({ type: "rb-hover", key: null }); });
  window.addEventListener("message", (e) => {
    if (e.data?.type !== "rb-hl") return;
    for (const el of document.querySelectorAll(".hl")) el.classList.remove("hl");
    const key = e.data.key;
    if (!key) return;
    const els = document.querySelectorAll(key.startsWith("s") ? '[data-s="' + key.slice(1) + '"]' : '[data-k="' + key + '"]');
    for (const el of els) el.classList.add("hl");
    if (e.data.scroll && els[0]) els[0].scrollIntoView({ block: "center", behavior: "smooth" });
  });
`;

/** Renders the resume live; calls onFit after each render. Clicking a line calls onPick, hovering a bullet onHover;
 *  `highlight` ("si:bi" for a bullet, "s<si>" for a section's lines) marks lines from the editor. */
export default function ResumeLivePreview({ layout, title, email, city, sections, skills, measure, mode = "fit", squeeze = false, highlight, onFit, onPick, onHover }: {
  layout: Layout; title: string; email: string; city: string; sections: PreviewSection[]; skills: string[]; measure: string[];
  mode?: "fit" | "width"; squeeze?: boolean; highlight: { key: string; scroll: boolean } | null;
  onFit: (f: LiveFit) => void; onPick: (t: PageTarget) => void; onHover: (key: string | null) => void;
}) {
  const body = useMemo(() => resumeHtml(layout, { title, email, city, sections, skills }), [layout, title, email, city, sections, skills]);
  const measureJson = useMemo(() => JSON.stringify(measure).replace(/</g, "\\u003c"), [measure]);
  const [doc, setDoc] = useState("");
  const id = useRef(0);
  const frame = useRef<HTMLIFrameElement>(null);
  const hl = useRef(highlight);
  hl.current = highlight;
  // A short pause after typing, then one Paged.js run in a fresh frame (it paginates once per document).
  useEffect(() => {
    const t = setTimeout(() => {
      const n = ++id.current;
      // The surround is set inline: Paged.js drops screen-only CSS, and a transparent frame shows white in a dark app.
      setDoc(`<!doctype html><html style="background:#2b2d31"><head><meta charset="utf-8"><style>${CSS}</style><script>window.RB_MEASURE = ${measureJson};${FRAME_SCRIPT(n, mode)}</script><script src="${pagedPolyfill}"></script></head><body class="${squeeze ? "squeeze" : ""}">${body}</body></html>`);
    }, 150);
    return () => clearTimeout(t);
  }, [body, measureJson, mode, squeeze]);
  const send = (h: { key: string; scroll: boolean } | null) => frame.current?.contentWindow?.postMessage({ type: "rb-hl", key: h?.key ?? null, scroll: h?.scroll ?? false }, "*");
  useEffect(() => { send(highlight); }, [highlight]);
  const handlers = useRef({ onFit, onPick, onHover });
  handlers.current = { onFit, onPick, onHover };
  useEffect(() => {
    const on = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow || e.data?.id !== id.current) return;
      if(e.data.type === "rb-frame") { const {left,right}=e.data;if(Number.isFinite(left)&&Number.isFinite(right)&&frame.current)frame.current.style.clipPath=`inset(0 ${right}px 0 ${left}px round 10px)`; }
      else if (e.data.type === "rb-pages") { handlers.current.onFit({ pages: e.data.pages, lines: e.data.lines, bullets: e.data.bullets, measured: e.data.measured }); send(hl.current && { ...hl.current, scroll: false }); }
      else if (e.data.type === "rb-pick") handlers.current.onPick(e.data.target);
      else if (e.data.type === "rb-hover") handlers.current.onHover(e.data.key);
    };
    window.addEventListener("message", on);
    return () => window.removeEventListener("message", on);
  }, []);
  return <iframe ref={frame} className="rb-live" title="Live resume preview" sandbox="allow-scripts allow-same-origin" srcDoc={doc} />;
}
