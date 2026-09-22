# Visuaria design verification

Research and verification date: 2026-09-21.

Canonical living design record: `index.html`. This standalone file embeds its decision record and prototype image assets. It does not need this verification note.

Verified in Chromium: 42 core interaction and persistence checks, 14 export/layout checks, and 6 final example/touch checks. Tested 1440 × 1000, 390 × 844, and 320 px width. The portable export loaded in a fresh browser context with notes, choices, and feedback baseline intact. Browser-local QA feedback was cleared from the test browser.

Checked 49 unique external source URLs. 45 loaded successfully; four GitHub pages returned HTTP 429. Those sources were inspected during research. No 404 response was returned.

Limits: no live Better Auth, Cloudflare deployment, true concurrent reviewer writes, production comparator parity, real mobile device, or screen-reader verification. Forced-colors emulation was activated, but this is not a full accessibility audit. Prototype image changes are a deliberate four-pixel shift of existing Ariakit lossless WebP images.

The Ariakit checkout remains unchanged. No GitHub artifact was published.

## Revision 2

Merged the maintainer’s 19 settled decisions, the explicit fresh-start confirmation, and all supplied notes. D20 remains open. D21 covers whole-item shortcuts; D22 covers undo after baseline promotion. No public source or service was created.

Passed 46 Chromium checks plus 10 final checks. These cover F/S/D, automatic next-pending selection, per-item memory, current-variant and Shift whole-item actions, atomic local undo, native modifier behavior, all five baseline cases, service retry/recompare state, optional versus required checks, revision-1 feedback integration, preservation of unsent notes, stale-option invalidation, copying, portable export, touch help, and narrow layout. No test feedback remains in the isolated browser.

The optional Node syntax-only command could not start because pnpm could not verify its package-manager identity against the registry. The standalone script was parsed and executed without console errors in Chromium during the browser checks. No repository tests or library changes were needed. The codec research probe also could not download dependencies due to DNS; its recommendation is based on sources and memory arithmetic only.

## Revision 3

Incorporated D21 Shift+A/X and D22 current-promotion undo. Resolved D20 through the explicit follow-up: require immediately after setup, automatically approve new items. D23 (new variants of existing items) and D24 (rejection after automatic main promotion) remain open. Preserved all unchanged D01–D19 answer IDs, notes, and versions, and all embedded image bytes.

Passed 40 focused Chromium checks and 13 final checks. Covered automatic acceptance, initial baseline creation, existing-image and new-item drift, rejection persistence across retries, current and stale promotion undo, both open recovery alternatives, original keyboard controls, revision-2 integration, unsent feedback, changed-only prompts, repeat copying, manual-copy fallback, and portable export into a fresh context. Touch help and decision navigation passed; 390 px and 320 px layouts have no horizontal overflow. Browser console had no errors or warnings. Cleared isolated QA feedback.

Reviewed the wide screenshots `revision-3-acceptance.png` and `revision-3-gate.png`. Primary sources for new-item policies: Chromatic Playwright setup and browsers documentation, Percy approval workflow Scenario 2, and Argos baseline-build documentation. These show different policies; no universal industry rule was claimed.

Production-service, authentication, comparison-codec, concurrency, real-device, and screen-reader limitations remain. No repository implementation or GitHub publication occurred.

## Revision 4

Incorporated D23 automatic approval of new variants and D24 correction through a new main capture. All 24 decision panels now have explicit maintainer answers. D01–D22 complete decision objects, image bytes, and external links are unchanged. Proposed restoration, scheduling, and runtime details remain proposals.

Passed 42 focused Chromium checks covering automatic new variants, rejection/retry before promotion, correction from current and later baselines, retained historical acceptance/results, reviewed correction promotion, D22 undo, gate behavior, alternatives and reset defaults, feedback persistence, revision-3 integration, unsent notes, changed-only prompts, clipboard/manual copy, portable export into a fresh context, touch tooltips and menu targeting, and 390/320 px layout. Browser console reported no errors or warnings. Cleared isolated QA feedback.

Visually inspected `revision-4-correction.png`. Set tooltip-help buttons to their own width in decision grids. Existing production, real-device, concurrency, comparator, authentication, and screen-reader limits remain. No repository implementation or GitHub publication occurred.

## Revision 5

Completed four independent design reviews: UI/accessibility, baseline state, service/security, and capture/release readiness. Preserved all 24 prior decision objects and embedded reference-image bytes. Incorporated the maintainer's D25 answer: generic public GitHub status plus a sign-in review link. D26 (actions on human-promoted history) and D27 (variant preparation ownership) remain open. Engineering proposals remain labeled as proposals.

The audit adds private upload transport, full trusted capture coverage, distinct test/workflow retry rules, source-acceptance dependencies, active-attempt checks for first acceptance, restoration boundaries, explicit removal views, and capture stabilization requirements. Exact eligible retries can reuse an already valid acceptance. Public artifact access and check visibility were checked against official GitHub documentation; screenshot stabilization was checked against Playwright documentation and the current Ariakit helper.

Passed 54 focused Chromium checks and four final checks. Covered normal/slow/failed image delivery, real image decode failure, action gating, navigation races, undo while loading, retry, all new illustrative models, unchanged decision selection, notes without answers, reload persistence, changed-only prompts, copy/manual fallback, revision-4 feedback upgrade, unsent notes, portable export into a fresh context, touch tooltips and decision navigation, and 390/320 px layout. The initial test assumed ten fixture variants; correcting it to the actual sixteen resolved that assertion. The final text check required a full reload rather than same-document fragment navigation. Neither required a product behavior change. No uncaught page errors occurred. Cleared isolated QA feedback.

Visually inspected revision-5-audit.png and revision-5-loading.png. The audit heading clears the sticky toolbar; the loading viewer has empty image panes, an explicit loading message, and disabled verdict controls.

These checks validate the local design artifact, not a deployed service. Production authentication, upload capabilities, Cloudflare codecs/memory, comparator parity, concurrent writes, package releases, real devices, and assistive technology remain unverified. The Ariakit checkout is unchanged. No product implementation or GitHub publication occurred.

## Revision 6

Incorporated D26 (X can reject and roll back the current human-approved promotion) and D27 (Ariakit prepares each variant; one capture per call). All 27 panels now have explicit answers. Preserved D01–D25 complete decision objects, all embedded reference-image bytes, and all external reference links. The feedback baseline now incorporates both submitted answers. Engineering proposals and measurements remain open.

A focused contract review checked D22 Undo, D24 automatic-history protection, mixed snapshots, source-acceptance dependencies, and retention. The document specifies atomic rollback, refusal after an intervening revision, saved-rejection Undo, no synthetic approval on accepted history, protection of unrelated reused approvals, and retention of rollback evidence. The adapter example shows two prepared calls grouped as one item. Exact function and property names remain proposed.

Passed 44 focused Chromium checks. Covered current/stale human rejection, Undo before/after another promotion, automatic-history protection, unselected alternatives and reset defaults, two-call API grouping, D22/D24 continuity, term tooltips, source-preserving code highlighting, persisted choices/notes, clearing an answer, changed-only copying, revision-5 integration, unsent feedback, clipboard fallback, portable export in a fresh context, touch navigation, and 390/320 px overflow. No uncaught page errors occurred. Cleared isolated test feedback.

Visually inspected revision-6-history.png and revision-6-api.png. These checks cover the local design artifact only. Cloudflare/auth deployment, concurrent service state, image codecs, real devices, and assistive technology still need implementation-phase validation. No product implementation or GitHub publication occurred.

## Revision 7

Responded to the explicit request to turn remaining engineering proposals and production validation into decision questions. Added D28–D58: 31 OPEN panels with concrete alternatives, recommendations, scenario previews, reset controls, and notes. The questions remain in their subject sections. An overview links the groups. Preserved all 27 earlier decision objects and embedded image bytes.

The new questions cover review details and Undo duration, public capture/protocol shape, first-introduction scope, restored identities, main scheduling, subsets, workflow and test retries, trusted plans, upload credentials and byte paths, image/color formats, comparator/stability policy, runtime fallback, permission caching, private delivery, auth failure response, public names and support, CLI scope, launch evidence, browser/accessibility scope, measured budgets, backup/restore, outage handling, and validation venue.

Added evidence rows E01–E08. Every result is NOT_RUN, with no date or observed result. Selecting a policy cannot mark evidence passed. D52 explicitly cannot defer support selected in D50/D53 or limits required by D54. Design answers do not authorize implementation, deployment, publication, or external messages.

Three bounded inventories and two narrow content reviews informed the panels. Removed an unsafe caller-stability alternative that verified one image pair but would upload a later unchecked capture. The two remaining D44 alternatives validate within the capture adapter. No original settled decision was reopened.

Passed 127 focused Chromium checks covering every new scenario alternative/reset, all 58 panels/menu entries, no preselected new answers, separation of previews from feedback, all-new-answer entry, production evidence remaining NOT_RUN, notes with no answer, reload persistence, changed-only prompts, copy/manual fallback, revision-6 unsent-feedback preservation, portable export in a fresh context, touch menu/help, source-preserving code highlighting, and 390/320 px layouts. The first harness assertion expected clearing a newly answered but previously OPEN question to create a diff by itself; the corrected check adds a note, so clearing appropriately produces an OPEN feedback update. No product change was needed for that harness correction. No uncaught page errors occurred. Cleared isolated test feedback.

Visually inspected revision-7-overview.png and revision-7-narrow.png. These checks validate the design document, not the service. Production evidence remains unverified. The Ariakit checkout is unchanged; no product implementation or GitHub publication occurred.


## Revision 8

Merged the full revision-7 continuation and exact notes. D42 explicitly accepts both lossless WebP and PNG. The privacy follow-up changes D13/D47 to a private app with public validated image URLs; the private R2 bucket and quarantine remain private. D46's five-minute image-read cache selection is recorded but inactive for public delivery. D53 remains OPEN because the submitted answer was OPEN; its Chrome Desktop and keyboard-only note is a proposed option pending confirmation.

There are 57 incorporated answers and four OPEN panels: D53, D59 automatic confirmed removals, D60 project name, and D61 the bare npm package's function. Preserved D01–D27 exactly except the authorized D13/D25 privacy adjustments. All submitted selections and exact notes remain in incorporatedFeedback for revision-7 upgrade matching. Embedded reference-image bytes are unchanged. D43 comparator thresholds and D54 numeric budgets await measurements and later approval; E01–E08 remains NOT_RUN.

Research checked existing lossless WebP capture in Playwright 1.63, the shared sRGB ICC profile in 358 current files, deletion prior art, Cloudflare pricing, and 18 possible names. The visible naming table contains 13 candidates, ten with no .com RDAP record. Public npm records do not establish namespace claimability. No domain, account, or package was registered. A functional bare-name CLI is an unselected alternative to empty name reservation.

The cost model separates image count, mean bytes, derived writes, retained derived bytes, reads, and existing account usage. It subtracts the existing account bill from the combined bill with rounding on each. Already-active Workers Paid adds no second base fee. The illustrative 10,580-image, 10 KB, 20-runs/day, 30-day original-only scenario is $27.81/month R2 with otherwise unused allowances; it is not a full hosting estimate or approved budget.

Passed 193 focused Chromium checks covering every new/changed scenario alternative and reset, main acceptance/access/completeness models, cost arithmetic including shared-account rounding, 61 panels/menu links, explicit answers, open notes, reloads, changed-only prompts, copy/manual fallback, revision-7 feedback upgrade, note-only feedback on explicit follow-up answers, portable export in a fresh context, tooltips and source-preserving highlighting, touch navigation, and 390/320 px overflow. No uncaught page errors. Fixed a migration defect where an unsent note could reopen a confirmed answer; merge fields separately. The first QA harness run used structuredClone outside the browser context; changed the disposable harness to JSON cloning, then completed the checks. No user feedback was cleared; only isolated test-session storage was reset.

Visually inspected revision-8-overview.png and revision-8-narrow.png. Refreshed the overview screenshot after a transient compositor frame; DOM has one toolbar. Bounded independent reviews covered policy consistency, privacy/format/cost, and record preservation. No product implementation, deployment, or GitHub publication occurred.


## Revision 9 — Ariviso

Merged D59 automatic confirmed removals, D60 Ariviso, D61 functional CLI, and D53 Chrome Desktop/keyboard-only review. A direct follow-up resolved D61: ariviso is the only CLI package; @ariviso/playwright is the adapter; no @ariviso/cli alias. D01 and D49 reflect the chosen private ariakit/ariviso repository and package targets. All 61 panels have explicit answers. Comparator thresholds and numeric budgets still await the selected studies and later approval. E01–E08 remains NOT_RUN.

Preserved original notes except the new submitted D61 note, historical namingResearch and lookup URLs, embedded image bytes, stable canonical file path, browser feedback key, and existing JS feedback export. The current document title, branding, examples, continuation title, and portable filename now use Ariviso. The complete submitted revision-8 state is the incorporated-feedback baseline; the explicit CLI follow-up is separate from the original sent option so note-only browser updates retain the confirmed package choice.

D59 applies only to confirmed omissions from a complete trusted plan. Missing or failed required captures remain errors. The document keeps removal rows and automatic source records, exact eligible reuse, rejection before promotion, retry guards, D24 protection after promotion, and D35 restoration reuse. Added a focused promoted-removal correction model. Object retention is unchanged. Chrome Desktop keyboard scope applies to the review UI; capture browser coverage is unchanged and broader certification is deferred.

Passed 96 focused Chromium checks plus three checks after fixing two stale alternative-example labels. Covered all selected scenario defaults, modified alternatives/reset behavior, all 61 panels and menu links, automatic removal acceptance, rejection/retry/Undo, changed removal tuple, missing required capture, required merge behavior, protected historical removal, eligible/ineligible restoration, actual F/A/Undo keyboard review, evidence separation, source-preserving code highlighting, tooltips, note/answer persistence, changed-only clipboard/manual fallback, revision-8 migration with unsent notes, portable export under ariviso-design-r9.html, touch menu/help, and 390/320 px overflow. No uncaught page errors occurred. Only isolated QA session storage was reset; no user-browser feedback was cleared.

Visually inspected revision-9-overview.png and revision-9-narrow.png. Independent bounded reviews checked removal-policy consistency and preservation/rebranding/support scope. No repository creation, product implementation, deployment, domain registration, package publication, or GitHub publication occurred.
