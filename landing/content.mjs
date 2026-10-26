// Every visible sentence on the public landing pages. Facts come from README.md,
// docs/job-matching-workspace.md, docs/unified-application-kit.md, docs/bank-page.md and
// docs/resume-builder.md. No metrics, customers or outcomes are claimed.

export const site = {
  name: 'Atriveo',
  url: 'https://apply.atriveo.com/landing/',
  workspace: '/job-matching',
  login: '/login',
  title: 'Atriveo | One job, one resume, carried through',
  description:
    'Atriveo shows how your experience fits each job, builds a one-page resume from that evidence and carries the exact PDF to the employer’s form. You submit.',
};

// The hero route. `at` is the share of the drawn path where each stop sits, so the
// marker and the chips always agree (see the route path in pages.mjs).
export const route = [
  { label: 'Find', caption: 'See the role and how you fit it.', at: 0, x: 80, y: 60 },
  { label: 'Evidence', caption: 'Back every claim with your own bank.', at: 0.3089, x: 350, y: 125 },
  { label: 'Resume', caption: 'Check the tailored PDF line by line.', at: 0.6515, x: 90, y: 255 },
  { label: 'Submit', caption: 'Review the employer’s form and submit it yourself.', at: 1, x: 350, y: 390 },
];

export const stages = [
  {
    id: 'find',
    label: 'Find',
    title: 'Find a job and see where you stand.',
    body:
      'Matching puts one role in front of you at a time, with two separate scores. Bank fit compares the whole posting with everything in your evidence bank. This resume scores the tailored PDF on its own. A score that cannot be worked out stays blank instead of guessed.',
    detail: 'On a keyboard, N passes, S saves and A goes to Apply.',
  },
  {
    id: 'evidence',
    label: 'Evidence',
    title: 'Every claim starts in your evidence bank.',
    body:
      'Your bank holds the accomplishments you have confirmed, each one tied to the fact behind it. Each requirement in a posting is matched against those entries and labeled by how directly your work proves it.',
    detail: 'The labels are categories, never invented percentages.',
  },
  {
    id: 'resume',
    label: 'Resume',
    title: 'A tailored resume you can check line by line.',
    body:
      'Each job gets a one-page PDF compiled from your bank on the same template every time. Evidence highlights point at the exact words on the page that back a requirement. Edit a bullet, swap in another one from your bank or write your own, and the layout stays put.',
    detail: 'The bullets come from your bank, never from the posting.',
  },
  {
    id: 'submit',
    label: 'Submit',
    title: 'The same PDF reaches the form. You press submit.',
    body:
      'Apply opens the employer’s page and a small Chrome companion window at the bottom right of your screen, which you can drag anywhere. It carries the resume you viewed, checked against the exact file you saw, plus your name, email and links ready to copy or paste. Attach fills supported upload fields; any other form keeps a download.',
    detail: 'Opening a form is counted as opened, not applied.',
  },
];

// Stage 2: the evidence labels exactly as the workspace defines them.
export const ledger = [
  ['Strong', 'A work or project bullet in your bank shows it.'],
  ['Moderate', 'The tool is linked to real work you did.'],
  ['Weak', 'It only appears in a skills list.'],
  ['Partial', 'You have used related technology.'],
  ['Missing', 'Nothing in your bank backs it yet.'],
];

// Stage 3: what stays fixed about every resume.
export const resumeRules = [
  ['One page', 'Filled to the bottom, never spilling onto a second.'],
  ['Same template', 'Built by the pipeline’s own renderer, so every PDF looks alike.'],
  ['Your bullets', 'Chosen from your bank for this posting.'],
  ['Exact PDF', 'The file you review is the file the companion carries.'],
];

export const faqs = [
  ['Does Atriveo submit applications for me?', 'No. Apply opens the employer’s form and brings your details and selected resume with it. You review the form and you decide when to submit.'],
  ['Is the resume in the companion the one I reviewed?', 'Yes. The handoff checks the file against the exact PDF you viewed. If it changed or is unavailable, the handoff stops instead of swapping in a different file.'],
  ['What does the fit score mean?', 'It compares the posting with the experience stored in your bank and shows strengths, gaps and requirements that need a look. It helps you decide; it does not predict a hiring outcome.'],
  ['Does the companion work on every application form?', 'Copy and PDF download work everywhere. Paste and Attach depend on the employer’s form and on the site access you give Chrome. Custom or embedded upload widgets may need a manual upload.'],
  ['What do employer sites receive?', 'Only what you paste or attach. Your sign-in and private storage links are never passed to employer pages.'],
  ['How do I get access?', 'The workspace currently needs an approved account, and there is no open sign-up. The Chrome companion is distributed as an unpacked extension for approved users.'],
];

// Captures use the real product interface with illustrative job and profile data only.
export const examples = { placeholder: false, label: 'Real product interface. Illustrative job and profile data.' };
