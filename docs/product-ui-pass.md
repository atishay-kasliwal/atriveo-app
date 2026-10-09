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
