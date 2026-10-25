# Product UI pass

This pass covers Today, Staffing, resume lists and AI review, shared questions, submission review, and complete application review.

- Today/Staffing retain the next-step action and Review with AI. Secondary actions use a shared More disclosure, with Escape and outside-click closing. Inline notes explain resume preparation.
- Saved resume lists use the same secondary-action disclosure.
- AI uses Run a new review to distinguish a fresh inference request, and Close to describe closing the panel; redundant Review Individually is removed.
- Staffing retains its tab, source, search and page within the browser tab when navigating away and back.
- Empty question lists stop saying Loading when the queue is empty. Answer, Today, Staffing and submission-review empty states provide next-step navigation.
- Initial submission-review errors offer Retry rather than an internal shell command.
- Complete-form review has a direct page title.

No application submission or resume approval behavior changes. Existing PDF/template and content rules remain authoritative. Fifteen desktop/mobile browser checks pass, including menus, queue completion, navigation return state, AI review persistence, preview layout and latest-PDF saving/downloading.

## Answering in the console retired (Oct 2026)

The console no longer asks you to answer application questions:

- Pages: To answer (`/unanswered`) and the full form view (`/answers`) are gone; both paths (deep links included) redirect to Today. The Cloudflare SPA catch-all still serves the app first. The header's To answer link and count are gone.
- Today: the Need answers cards, their pill, the Answer button and its pop-up are gone. Applications with a required question nobody answered no longer appear on Today. Open & Fill cards (answers approved or drafted), Approve submit, You submit and On LinkedIn cards are unchanged. The header's Today count is fillable + ready.
- Server: `review-queue?view=unanswered` became `view=fillable` (only applications Open & Fill can take, always light); `view=full` and the `cards=N` parameter are gone; counts are `{ fillable, ready }` (plus `inBrowser` on the ready view). `/applications/action` refuses `question_review` and `application_review` (410).
- Still served, for the Stats review drawer: `view=cards`, `/applications/question-options` and the `answer` action.
