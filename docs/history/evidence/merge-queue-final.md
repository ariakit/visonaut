# Synthetic merge-queue acceptance

On September 23, 2026, the public, synthetic
[`ariakit/visonaut-diagnostics` fixture](https://github.com/ariakit/visonaut-diagnostics)
exercised GitHub's real merge queue. Its active
[ruleset 23803409](https://github.com/ariakit/visonaut-diagnostics/rules/23803409)
requires both the `fixture` GitHub Actions check (integration `15368`) and the
`Visonaut` App check (integration `5028451`). The fixture has two small colored
cards and contains no Ariakit screenshots or private review data.

The first queue entry used merge-group SHA
[`989a05cf`](https://github.com/ariakit/visonaut-diagnostics/commit/989a05cf36b266b2127cc22f7410b238538d6b36).
The [merge-group workflow](https://github.com/ariakit/visonaut-diagnostics/actions/runs/35799188397)
and both capture shards completed successfully, but the exact `Visonaut` App
check failed because both changed profiles still needed review. GitHub removed
that entry from the queue without merging. This is a hosted fail-closed result,
not an injected status.

After the approved source decisions were in place, the next queue entry used
[`70ad4e3a`](https://github.com/ariakit/visonaut-diagnostics/commit/70ad4e3a5987b1811eb8acf120f0fb83e1756614).
Its [merge-group workflow](https://github.com/ariakit/visonaut-diagnostics/actions/runs/35802140813)
completed both capture shards. The Visonaut run
`2ecec488-6888-4408-a352-53e83405753d` reused the source approval for the
new profile in shard 1 and for the unchanged profile in shard 2. The App check
passed, and GitHub merged [PR #18](https://github.com/ariakit/visonaut-diagnostics/pull/18)
at that exact SHA at 00:31:08 UTC. The queue result, active ruleset, and
merge-group run jointly establish that both required checks passed at merge
time. The merge-group SHA, not the PR head SHA, was the tested commit.

The merge caused a separate `push` capture on the new main commit. Its
[main review](https://diagnostics.visonaut.com/runs/71dab042-3c20-4f24-b4db-d8556f343a0d)
correctly found the second card's blue-to-green change and set the App check
to failure at 00:43:54 UTC. The operator compared the real reference and new
image in the deployed review UI and approved the green synthetic card. The UI
then showed zero items needing review and “Check passed.” GitHub reported the
same App check as `success` at 00:46:05 UTC. This later main capture does not
change the earlier queue decision; it proves the expected separate baseline
review after merge.

The reviewed source commit
[`57f5687`](https://github.com/ariakit/visonaut/commit/57f5687b94b0fba4b22a1bc1d8c2b5c3133251a9)
was then deployed to the diagnostic web
Worker as version `75c8f8c7-ed01-4f50-83bf-528be27433b5` at 100% traffic.
Its deployment check preserved D1, R2, service and queue bindings, and cron
schedules. On this version, the authenticated browser showed the configured
`ariakit/visonaut-diagnostics` repository, both real card images, and the
persisted approval. A controlled Reject on the second card changed its verdict
to “Rejected changes”; Undo restored “Check passed” and the original selected
variant. A full page reload still showed the second card approved, comparison
revision 11, and zero items needing review. The final-source browser also
switched between Fit, 100%, and 200% zoom, and between side-by-side, pixel
diff, and new-image views, with the expected selected controls and image
roles. These are UI and persisted-service observations. They do not claim a
separate GitHub failure/success delivery for that brief Reject/Undo sequence.

This fixture proves real webhook, merge-group identity, two-shard capture,
review-dependent App status, queue refusal, and successful queue admission for
one synthetic repository. It does not replace the full Ariakit capture cycle,
production baseline, or required-check cutover.
