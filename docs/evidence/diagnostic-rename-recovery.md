# Diagnostic rename recovery

On September 22, 2026, the isolated `visonaut-diagnostics` Worker recovered a capture run copied from the earlier Ariviso diagnostic database. The old run used workflow `35743834553`, attempt 2. Its stored trusted reusable workflow did not match the Visonaut workflow pin. It remained active and uploading, and scheduled ingest reconciliation recorded `ingest:scheduler:reconciliation-failed`.

Before recovery, the diagnostic R2 copy was checked against the three predecessor buckets. The image, quarantine, and backup buckets matched at 94, 15, and 47 objects respectively after 83 missing objects were copied. An additional 22 existing objects received their original custom digest metadata. A final independent inventory comparison found no missing, extra, or mismatched object bodies, ETags, content types, or custom metadata. The predecessor buckets were retained.

The [stale-run fix](https://github.com/ariakit/visonaut/commit/cbae4ae7925160bd2fc315eddf1f90eb0e98eb81) checks D1 executor provenance before reading the stored R2 plan. A changed workflow ref or SHA fails an old unsealed run once, with an audit reason. A later attempt can reserve a full new capture, while inherited shards must have source provenance matching the current pin. The two mismatch tests failed against the earlier implementation and passed after the fix. Full local checks passed 562 Vitest tests and 52 Chrome review tests, together with lint, types, and builds.

The reviewed diagnostic build was deployed as Worker version `484bc367-4e66-4b05-bf21-3625256e883f`. It retained the diagnostic D1, R2, queue, comparator, custom domain, and five-minute schedule bindings. One bounded operations queue message then ran reconciliation. D1 showed the old run as `failed`, with no seal or comparison, and a `capture-failed` audit containing `The trusted capture executor changed. Start a new capture attempt.` at 21:38:20 UTC. The ingest reconciliation alert resolved at 21:38:21 UTC after 16 recorded occurrences. The old run's evidence remained in place.

Cloudflare also began running the five-minute schedules for the new production and diagnostic Workers. The production backup `2026-09-22T12Z` completed at 21:11:46 UTC with a 4,512,723-byte SQL export. This confirms one scheduled production backup, not sustained cadence or a 24-hour recovery-point bound.

This result covers one cloned diagnostic run and one scheduled backup. It does not replace hosted failed-job inheritance, merge-group capture and check, the full Ariakit service cycle, sustained backup cadence, or large restore evidence.

## Genuine synthetic merge-group metadata

The public, synthetic [diagnostic migration PR #10](https://github.com/ariakit/visonaut-diagnostics/pull/10) entered GitHub's merge queue. Its [merge-group fixture run](https://github.com/ariakit/visonaut-diagnostics/actions/runs/35791551032) passed on head SHA `756a5225af9bbcd466ef56d56abdee2843b897c9`. The Visonaut App webhook router received GitHub's signed `merge_group` `checks_requested` delivery. Diagnostic D1 recorded that same head SHA, the queue head ref `refs/heads/gh-readonly-queue/main/pr-10-24f508cc65c91867d747a8046d4aef6348418ced`, base SHA `24f508cc65c91867d747a8046d4aef6348418ced`, and active state. GitHub merged the PR at 22:20:59 UTC with that head commit.

This proves automatic signed merge-group metadata delivery and merge-queue operation in the synthetic repository. The fixture check did not call the Visonaut capture adapter, so it does not prove merge-group capture, comparison, or the Visonaut App check. The pinned caller and complete hosted capture still need separate evidence.
