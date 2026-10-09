# Feedback consistency review

Read-only review of the 39 selections in the pasted feedback, revision 1 of `docs/simplification-audit/audit-data.json`, and the preserved `contract-issue-1.md`. This report does not authorize implementation or external writes. The follow-up answer resolves A06 to `github-artifact`; do not ask it again. Root has already asked the O07 clarification.

## Selected answer and note conflicts

| Decision | Conflict | Required record change |
| --- | --- | --- |
| A03 | The selected `one-path` option explicitly has a short deprecation window. The note explicitly rejects deprecation and applies immediate old-code removal to the whole project. | Record the explicit conflict and resolve the option wording. Replace deprecation instructions and deprecation-warning tests with a coordinated cutover and removal, once the conflict is resolved. Do not leave the old option label under an accepted marker. The note is not authority to destroy retained data or mutate published package history. |
| O07, from O01 note | `workflow-only` says Changesets manages version updates while the verified workflow publishes exact tarballs. The O01 note requests Changesets **for publishing**. | Resolve O07, not O01's unrelated pipeline-ownership choice. A native Changesets publishing flow can still have one workflow owner. Describe the loss or preservation of exact pre-audited tarball publication explicitly. The existing contract already requires Changesets at lines 51 and 138. |
| U04 | Selected `global` promises current behavior and “No event changes.” The note requests wider shortcut scope because the current implementation needs focus within the page/workspace. | Update the option, examples, event scope, and tests. This is a behavior change, not only a help-text change. “Global” must mean the eligible review document, not the operating system or browser address bar. Preserve text/editable, menu, dialog, modifier, and shortcuts-off exclusions unless separately changed. If the widened scope includes letter shortcuts, explicitly revise contract line 280. |

A06 was a fourth conflict, now resolved by the user's later answer. Replace its private-pack example, “No raw trace, PNG” test, stop-upload migration, and one-day encrypted-pack lifetime with the selected ordinary artifact policy. Keep the seven-day lifetime attached to the selected option unless the user changes it.

## Related selections which need coherent wording, not another preference question

- **U03:** Use links for both item navigation and tab rendering. Replace the plain `<Tab>` example with a supported `render={<Link ... />}` example after checking the installed component API. Preserve tab semantics, URL selection, and native modifier-click behavior.
- **P03:** Replace the preferred effect-helper snippet with router-loader cancellation and explicit loader dependencies. The user's “idiomatic TanStack” note requires research and a concrete example; it is not a missing preference. Item/variant-only selection must not refetch P01's complete model. O05 permission caching must not acquire an additional unbounded client-cache lifetime.
- **P04:** Replace the page-size-50 snippet, “No migration for recommended option,” and page-boundary-only tests with the selected continuous virtual list. Verify CompositeRenderer's actual API before using it. Its availability is a factual question. Preserve U03 links, deep links, variant memory, keyboard wrap, focus after auto-advance/removal, and selected-row visibility. The evidence still does not establish virtualization as a measured performance requirement.
- **P05 + Q04:** These choices can coexist. Record the two route measurements as manual/on-demand built-app checks, retain and repair the existing fixture, and add no new permanent browser project. P05 currently says “Use the single built-route fixture proposed in Q04”; Q04 selected the option with **no new test infrastructure**. Q04's current generic migration also assumes an added config. Remove both stale assumptions. An enforced CI route gate would require a fresh decision if root wants it.
- **O02:** The user selected a narrow deployment role and flat paths in that Infisical project. Update path examples and the proposed layout. This does not select shared production/preview/local credentials or a broader token role. Inspect actual project/environment/path collisions before any later implementation.
- **O05:** The selected read-permission cache contradicts the current examples/tests which require ten permission checks for ten reads and immediate denial on the next request. Revise those after choosing a precise permitted stale-read window. Keep write rechecks and session validation.
- **A04:** The note refines the already selected deliberate no-visual-needed success. It does not reject the direct App check. Replace “verified success or equivalent conditional rule” with a concrete Plan-bound design. A Plan result must be bound to the applicable trusted workflow, tested SHA, run, and attempt; missing visual evidence must not be interpreted as Plan saying no visual work. Remove migration wording “Do not change D20,” because this choice explicitly changes the current D20 Gate contract.
- **S05 + C01:** Remove “Preserve ... one-level rollback” and promoted-rollback tests from S05's selected path. C01 explicitly makes promoted history read-only. Keep concurrency and missing-source tests and pre-promotion session Undo where applicable.
- **S06:** Keep the current 30-day unpinned byte window unless a new duration is explicitly chosen. The selected text says “after a stated retention period”; it does not itself choose a new duration. Do not claim a reopen of D15 merely because the display becomes a compact summary. Historical recomparison availability changes D11/current contract line 284.
- **Q03:** Preserve the issue snapshot and all 61 historical choices. Make the new repository current record the selected design authority without implying that issue #1, running code, or production settings have already changed. External publication remains separately authorized.

## Prior decisions and current contract affected

All line numbers below refer to `docs/simplification-audit/contract-issue-1.md`. The ledger remains historical; add explicit supersession links rather than silently rewriting the old answer.

| New choice | Historical ID(s) and exact current text | Effect to record |
| --- | --- | --- |
| A03 no-deprecation policy | **D33**, ledger 441; line 129: “compatible optional additions within a major version,” “Test old-client/new-server compatibility.” **D50**, ledger 458: Ariakit's pinned toolchain first. | Immediate removal of old manifest/client support must explicitly revise D33 or use an explicit protocol version boundary. A sole current pinned client is compatible with D50; broad support was never promised. Retain validation and clear unknown-schema refusal. |
| A03 one current capture path | **D51**, ledger 459: `pack, upload, submit, and status`; current integration path at lines 31–33 uses pack and bundle-submit. Older CLI prose at 131 still describes upload/submit forms. **D18/D61**, ledger 426/469, remain two packages and one CLI name. | If the selected supported path removes public `upload` and legacy submit forms, explicitly supersede that portion of D51. Do not infer a package merge or new public transport package. The existing audit A03 `reopens: []` misses D51 and possibly D33 under the project-wide note. |
| S02 native recovery | **D55**, ledger 463; line 346 requires daily combined database/image backups, 30 backup days, proposed 24-hour loss/working-day restoration targets. Lines 43 and 45 describe historical launch backup evidence. | Explicitly replace that future recovery promise. Keep the past receipt as history. Native database recovery does not imply deleted R2 originals can be restored. New runbook must state the limited image coverage. |
| S05 source pins | **D16**, ledger 424; lines 334 and 338 require per-run storage plus protected baseline prefixes and copying before pointer switch. | Remove future protected-copy ownership. Keep immutable per-run originals and required owner pins. This does not select global cross-run deduplication. |
| S06 compact history | **D11**, ledger 419 and line 284: a stored run can be recomputed without capture CI. **D15**, ledger 423 and line 336: 30 days for closed unpinned images. Lines 210 and 336 preserve identity and acceptance history after expiry. | Limit interactive/recompare history after the selected retention window; preserve permanent identity, exact acceptance, and audit summary. Do not remove the still-selected 30-day bytes by accident. Old detailed archive-reader removal needs conversion or explicit expiry, not unsupported links. |
| C01 forward-only promotion | **D22/D26**, ledger 430/434; lines 235–236 define rollback of current human promotion; line 241 defines Undo of its rejection; line 243 pins predecessor evidence. **D24/D59** already use forward correction at line 237. | Supersede current human-promoted rollback and its future predecessor pins. Keep **D31** session Undo before promotion, ledger 439. Update the rejected-alternatives paragraph at 473, which currently rejects read-only human-promoted history. |
| C02 copied acceptance | **D08/D35**, ledger 416/443; lines 193, 199, and 211 require still-valid source decision/revision and live invalidation. | Supersede cross-run revocation after verified copying. Preserve lineage, complete tuple, historical attribution, and pre-copy validity. A later source rejection no longer retracts copied downstream approval. |
| C03 split identities | **D33** compatibility text at 129; exact tuple at 178–190 and immutable policy history at 290–292. | Separate rendering from comparison policy without losing exact approval identity. Under A03, replace permanent old-client support with a coordinated schema/client cutover; retain old provenance as data. A new tolerance must not silently reuse old approval. |
| C04 Worker-only service | **D45**, ledger 453; line 294 requires a tested Container fallback behind the production comparison/queue contract. | Change fallback placement to a separate probe. The selected probe remains useful; A03 does not authorize deleting every non-production tool as “old.” |
| A02 small visual workflow | **D39**, ledger 447; lines 29 and 142 pin `app.yml` as suite/matrix/Submit owner. | Replace that specific pinned workflow source with the small visual workflow. Retain complete matrix and one signed Submit dependency, D37/D38/D40. |
| A04 direct required App check | **D20**, ledger 428; lines 33, 326, and 330 make Gate the required check and exempt docs-only runs from a separately required App check. | Require the App's check directly and emit trusted Plan-derived success when no visual work is needed. Gate can continue to gate other jobs. Preserve tested SHA/run/attempt and pending/failed/stale refusal. |
| A06 ordinary CI diagnostics, now resolved | **D13**, ledger 421 and privacy text at 308/311/314. Audit labels **D40/D58** as related; their core ingest authority/final-successful-attempt behavior need not change. | Narrowly supersede private/encrypted failed screenshots and trace storage. Do not infer public review metadata, public quarantine, or removal of signed successful capture/Submit transport from this diagnostics answer. |
| U04 document-global shortcuts | **D02/D03/D21**, ledger 410/411/429, keep action meanings; line 280 scopes letter shortcuts to the focused workspace and lists exclusions. | If “global” includes letters, explicitly replace focus scope while retaining exclusions and the off switch. Do not claim the contract is unchanged. Arrow-only expansion can preserve the scoped-letter promise. |
| O05 cached read permission | **D14** role threshold remains at ledger 422 and line 302. Line 306 requires current permission on every protected read/write and expressly says **D46**'s five-minute image cache is inactive. | Add a new permitted delay after revocation for private reads. D46 is not authority for selecting five minutes. Writes stay live. |
| O07 Changesets release choice | Lines 51 and 138 already require Changesets, package inspection, clean installs, trusted publishers, and provenance. | Clarify whether Changesets publishes or only versions. Preserve those output checks where possible; exact pre-audited archive publication is a current implementation contract whose tradeoff must be explicit. |
| Q03 repository current record | Line 9 says issue #1 is the canonical handoff and all 61 answers are preserved except explicit later changes. | Record selected authority change and current supersessions, while keeping the issue snapshot immutable as evidence. Do not imply GitHub publication occurred. |

## A03 “remove old stuff” across the selected migration plans

These are real stale-text conflicts in the current record, not hypothetical compatibility work:

- **S02:** selected migration retains a frozen legacy restore tool while historical sets are supported. A no-legacy plan must set a conversion/export or support-end cutover before removing that tool. It must not assert that native D1 recovery restores those sets.
- **S05:** selected migration keeps copied snapshots readable until unreferenced. Convert still-required baseline owners/pointers to the selected source-pin model before removing the reader. C01 removes the future rollback obligation, not current baseline evidence.
- **S06:** selected migration preserves archive readers to an agreed support end. With immediate old-path removal, convert needed permanent history to the compact representation before removing archive readers. Existing accepted identity must survive.
- **C02:** current migration says old comparisons retain old live-link rules indefinitely. This conflicts with one current path. Use a defined conversion/cutover that evaluates source validity and records copied acceptance, or close old active work explicitly; do not delete graph edges and call the old acceptance valid.
- **C03:** current migration/test requires old CLI/adapter manifests and stored history to remain readable. Separate retained historical provenance from supported wire formats. Convert required records and deploy the matched Ariakit client/service version together; then remove old protocol support.
- **S04:** current migration accepts old `{kind:'continue'}` queue messages during retention. An immediate decoder removal must first drain, reconcile, or replace existing queued work. In-flight work is state, not an unused API. A short bounded operational cutover is different from a public deprecation period.
- **A02/A04:** remove superseded workflow pins and Gate wait code only after the new trusted source/check lifecycle is verified. This can be one coordinated change. Do not leave an optional visual gate window.
- **A03:** remove deprecation warnings and the requirement to retain legacy entrypoints. Historical package versions and docs can remain immutable records without becoming supported current paths.
- **P01:** if its compact model changes the response shape, coordinate its callers instead of adding a permanent dual-format parser.
- **D38:** successful capture packs which GitHub did not rerun remain valid rerun inputs under the still-selected retry contract. “Old” does not mean safe to delete before their required lifetime.
- **Q01:** preserve applied migration history. A current schema migration which converts data is consistent with no obsolete runtime path; deleting old numbered migrations is not necessary for simplicity and would break clean-schema tests.

A concrete cutover model can be small:

```text
verify current clients and live work
convert required state to the selected representation
switch the one trusted workflow/client/service path
verify the selected behavior
remove superseded handlers, scripts, fields, and tests
```

This is a migration sequence, not an additional long-term compatibility framework. It does not authorize deployment in this design round.

## Fresh decision candidates

1. **O05 follow-up:** permitted private-read permission staleness. It needs a numeric bound plus logout/revocation/config invalidation behavior. Keep it OPEN; do not borrow D46's inactive five minutes.
2. **A03 conflict resolution:** immediate coordinated removal versus the selected short deprecation window. Once resolved, propagate the answer across the items above instead of asking the same policy question for each old path.
3. **U04 scope clarification only if needed:** document-global arrows only versus all eligible review shortcuts. The user's selected question is about arrows, but the note says “those shortcuts”; retain exact action exclusions either way.
4. **A04 implementation mechanism:** only if investigation finds more than one materially different way to consume trusted Plan output. The user has already chosen immediate success for no-visual-needed work; do not reopen that preference.
5. **O07:** already pending with root. A06 is settled.

Do not add decisions merely for factual library questions (P03/P04), the explicit flat secret paths (O02), tab links (U03), or PR titles (U05). Research those and update the chosen design and examples.
