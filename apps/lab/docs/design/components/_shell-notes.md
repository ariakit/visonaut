SCOPE
Seven component surfaces for the group Shell and navigation, 36 variants. I kept the six surfaces of the starting list and added `key-help` (the entry to the shortcut list, the list, and the on/off switch). The shell lane owns that defect (SHELL-17: help in a footer below the fold, `?` opens nothing), and key discovery is a hard rule. If another group also returns a keyboard-help surface, merge the two by variant id.

HOW THE PICKS DEPEND ON EACH OTHER

- `app-nav` decides where the alert count and the account sit. `alert-indicator` and `account-menu` decide their form.
- `alert-indicator/nav-dot` needs a visible Status link (`app-nav/one-button` and `page-tabs` have none). `account-menu/sidebar-row` fits `app-nav/rail` only. `scheme-toggle/menu-rows` needs an account menu that is a menu.
- Five variants solve the jump between runs in different places: `app-nav/breadcrumb`, `run-header/crumb-popover`, `run-header/attempt-switcher`, `command-menu/omnibar`, `command-menu/queue-menu`. Pick one of them, not all.
- `command-menu/palette` with `?` can replace `key-help`.

RULES FOR EVERY VARIANT IN THIS GROUP (BUILDERS)

1. Lab cells. A stack surface draws each state in a boxed shell: `Frame $border $rounded='xl' className='h-56 w-full overflow-clip [container-type:size]'` > `Shell $forceRounded className='h-full [--shell-top:0px]!'`, with quiet stand-in frames (no text) as the page. A row surface draws a `w-90` cell with a header stand-in strip. A `narrow` or `touch` state wraps its cell in `max-w-[24.375rem]`.
2. Open states. A state that shows a menu, popover, or dialog open draws the panel in flow under its trigger: a `div` with the `popover` recipe and `data-open` (the recipe comment in `styles/popover.ts` says that static markup adds `data-open`). The state at rest uses the real overlay with `portal`. Thus many open panels can share one explorer page.
3. Links and keys. A link calls `preventDefault` and sets local state, so the current mark moves and the explorer stays. A key (`/`, `?`) works only while focus or the pointer is inside the cell, because several variants share one document (`useReviewShortcuts` has `scope` for this).
4. Sizes. A bar is 11 spacing steps (44 px at a 16 px font): set `[--shell-header-step:calc(--spacing(11)/14)]` on the shell and use `$height='sm'`. Use spacing steps and named radius steps only, so the Look controls apply. No text below `text-xs`. Muted text is `ak-ink-60` or `ak-ink-70`, never `opacity-*`. No `$layer='primary'`.
5. Waits. No variant shows the words Checking access or Loading. Parts that need no data (mark, link words, back link) render at once. Parts that need data are `animate-pulse` frames of the final size, inside `aria-busy='true'` with an `aria-label`.
6. Defects that every variant fixes: client links (no document reload); one link to the Queue on a run page (three today); the current page is marked on every page; the same header content while loading and when ready; a skip link as the first focusable element; no control below 24 px; the signed-in login is shown; one name for each concept.

WORDS
Queue, History, Status, alert, run, screenshot, variant, change, baseline, current, diff. Run states: Needs review, Rejected, Passed, Capturing, Comparing, Rerun needed, Replaced, Failed. Sentence case, no period at the end of a label, relative times from `formatRelativeTime`. The lab catalog calls the first page Inbox; these variants say Queue, as the copy lane proposes. `No alerts` replaces `All clear`, because the alert list does not test every dependency (review guide).

KEYS
The base is key map A of the contract lane: the contract keys, `G`, and `?`. `/` opens the command control in four `command-menu` variants; key map B gives `/` to the list filter, so the two must merge if both are picked. Only `command-menu/palette` takes a modifier chord. No variant uses `[`, `]`, Space, Escape as a mode, or `g` sequences. With single-key shortcuts off, `?` and `/` are off too, so each has a visible button.

EARLIER DECISIONS THAT A VARIANT REOPENS (also in the tradeoffs of that variant)

- feedback-ui.md:96 (do not add a hotkey registry) and :73 (keep browser modifier shortcuts): the `command-menu` variants, and to a lesser degree each `key-help` variant, because it renders from the `reviewShortcuts` list.
- Rule A06 and review guide line 17 (run identity above the images): `run-header/crumb-popover`, `run-header/floating-chip`, and the 390 px form of `run-header/one-line`. The U02 selection already moves run IDs to Details.
- Rule A08 (a count such as `2 of 6 need review`): `22 left` in `run-header/one-line`.
- U05 (the merged list `recent-clear` was rejected): `app-nav/page-tabs` puts History beside the work tabs but keeps it a separate view.
- The alert list is read-only by decision (no dismiss, no acknowledge): `alert-indicator/review-banner` hides the band in the page only.
- D17 (flat, compact controls): no variant uses a bevel.

NOT IN THE API TODAY (used by at least one variant)
The signed-in login in the run list answer; `User.name` and `avatarUrl` (the CSP also allows no GitHub avatar); the alert count in the run list answer; `ServiceAlert.severity`, `impact`, and `runId`; `ReviewRun.pullRequest`, `counts`, `progress`, and `supersededBy`; `Run.branch`, `author`, `commitMessage`, and `previews`; `PullRequest.runs`; `ReviewVariant.diffPreview`; the workflow run URL of an attempt.

OUTSIDE THE LAB
Each page needs its own document title (`Queue (4) · Visonaut`, `#4863 Migrate component examples… · Visonaut`); a component cell cannot show it. The lab list `reviewShortcuts` says `1–9` where the contract says `1–6`, and it uses the word item; the `key-help` specs give the words to show.
