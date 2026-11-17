// The resume template's page geometry, shared by the template (ac-tex.mjs) and everything that measures how full a
// compiled page is (page fill, the resume builder's room chip, job matching) or how much fits on one line.
//
// Margins were 0.5in all round. Since 2026-11-17 (Atishay: room for a third open source bullet, the page centred, fuller
// lines) the top is 0.36in, the bottom 0.24in and each side 0.4in. The name's capitals rise about 3pt above the top
// margin and a filled page ends its last line about 5pt above the bottom one, so these leave about 23pt of white above
// the name and below the last line.
export const PAGE_HEIGHT_PT = 792;
export const PAGE_WIDTH_IN = 8.5;
export const RESUME_TOP_MARGIN_IN = 0.36;
export const RESUME_BOTTOM_MARGIN_IN = 0.24;
export const RESUME_BOTTOM_MARGIN_PT = RESUME_BOTTOM_MARGIN_IN * 72;
export const RESUME_SIDE_MARGIN_IN = 0.4;
export const RESUME_TEXT_WIDTH_IN = PAGE_WIDTH_IN - 2 * RESUME_SIDE_MARGIN_IN;

/** A character budget measured on the old 7.5in line, for the current line width. */
export const scaledChars = (charsAt7p5in) => Math.floor((charsAt7p5in * RESUME_TEXT_WIDTH_IN) / 7.5);
