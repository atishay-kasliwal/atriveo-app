# Atriveo landing

Brief: a public introduction to Atriveo's existing job-matching workspace and Chrome companion. Audience: people applying to jobs. Outcome: understand the connected workflow, inspect the product and open the workspace. Existing accounts require approval; no open sign-up, pricing, customer metrics or outcome claims are invented. Public location is https://apply.atriveo.com/landing/. Existing signed-in routes remain in place.

Stack: static HTML/CSS generated within the existing Vite project, with a small GSAP/Lenis motion bundle. The public page does not load the private React application or call its APIs. Content is in content.mjs; templates are in pages.mjs.

Three territories, scored originality / fit / feasibility / portability (lower portability is better):
- Process: The application thread. One blue thread carries a selected job through evidence, resume and companion. Signature: choose a stage and the same thread travels to it. Emotion: everything coming together. Screenshot: oversized ink typography and a blue routed figure on pale paper. Anchor: the exact resume stays attached to a selected job across the workflow. 4/5/5/2.
- Material: The proof sheet. An annotated application exposes the evidence behind each claim. Signature: a qualification highlights its supporting experience. Emotion: credible preparation. Anchor: the product's bank-to-resume evidence links. 4/5/4/3.
- Formal: Next brackets. Open brackets hold each part of a person's next move. Signature: bracket geometry changes around content. Emotion: possibility. Anchor: Atriveo's forward application actions, but weak identity fit. 3/4/5/4.

Chosen: The application thread, because the selected-job continuity is the product's most specific advantage.

Idea: Every part of your next application, connected.
Metaphor: A blue thread through a paper application folio.
Signature: An interactive SVG route joins role, evidence, resume and application; its marker and selected-stage text share one progress driver.
Emotion: Ready, clear, optimistic.
Motion verb: Carry. Arrows travel, a marker follows the route, images settle into the folio. No blocking loader, no cursor replacement, no GL.
Screenshot: A large three-line headline beside the blue application route, with the real product below.

Palette: paper #f4f6f8, ink #151b25, muted #566171, line #cbd3de, accent #2455e8, field #e5ecff. Blue is Atriveo's existing action color, used as the connecting line and one large closing field, not as a gradient.
Type: self-hosted DM Sans variable 400–700 from Google Fonts, one 36KB Latin WOFF2. Display 58–112px, -0.065em tracking, 0.98 leading; body 17px/1.6, labels 12px. Existing brand stays recognizable through the lowercase wordmark.
Grid: 12 columns, 6% outer gutters capped at 88px, aligned left edges. Hero asymmetric poster; product proof wide real screenshot; workflow ruled sequential list; companion asymmetric image/text; FAQ quiet two-column; footer large blue statement.
Shape: 12px panels, 999px action chips. Motion: one GSAP ticker drives Lenis and the route marker; power3.out, 160ms feedback, 700ms route settle. Reduced motion uses native scroll, a still diagram and immediately visible content. Content is visible without JS. Idle movement is only the meaningful route marker and pauses offscreen.

Wireframes:
Hero: [Your next role. / All coming / together.  7 cols] [interactive route, 5 cols]
Proof: [See the role. See your evidence.] / [actual product capture, full width]
Workflow: [One application. Every piece.] [01 Role / 02 Evidence / 03 Resume / 04 Application]
Companion: [actual companion capture, offset] [The same resume. Right there.]
FAQ: [A few useful answers.] [native accessible disclosures]
Close: [Make your next move.] [Open workspace] / large atriveo wordmark

Genericness pass: no logo wall, invented numbers, testimonials, pricing tiers, gradient blobs, fake UI, or equal feature-card grid. Screenshot examples are explicitly illustrative and contain no private applicant information. The process diagram is an actual explanatory figure, not a fabricated product screenshot. Final accessory removal: no decorative status badges or scroll prompts.
