# Issue #204 CI measurement record

This record covers [D04 and D11/W10](https://github.com/ariakit/visonaut/issues/204#w10). GitHub runs, job logs, step timestamps, and artifact metadata were read on 2026-10-02. The local patch follows the reviewed W01 commit [`4a4cefc`](https://github.com/ariakit/visonaut/commit/4a4cefcb23ad502c5534bc047b94630744e56b26). The [current guide](../../../current-contract.md#issue-204-supersession-map) retains the authority, deployment, required App-check, caller-adoption, and transfer-key retirement receipts through PR #205/#206/#207. This work does not reopen those completed or waived gates.

## Scope and method

[records.json](records.json) preserves the relevant API timestamps, IDs, source identities, artifact bytes/digests/expiry, and selected log evidence. [summarize.mjs](summarize.mjs) derives intervals from these timestamps without a network request or mutation:

```sh
pnpm exec node docs/evidence/issue-204-ci/summarize.mjs > artifacts/issue-204-ci-summary.json
```

Create the ignored `artifacts` directory first if needed. `knownRunnerMinutes` is the sum of available non-skipped job intervals divided by 60. It is unweighted execution time, not rounded billed minutes or money. Negative or absent intervals remain `null` and appear in `missingJobIntervals`; they are not zero-cost proof. Skipped jobs have no execution interval. Step timestamps have one-second resolution. Per-job queue delay was not isolated; run-to-job start also includes dependency waits. `secondsUntilGate` uses run start through Gate completion, including queue delay; it is `null` when the run start is unavailable or Gate is skipped.

Artifact byte sizes are compressed archive sizes from GitHub. Artifact age is measured against Submit **job start**, not an observed download/selection timestamp. `ageReferenceAt` fixes a separate age reference at 19:32:09 UTC on 2026-10-02; collection occurred during read-only preparation that day. Test counts do not prove capture inventory counts. No manifest was downloaded, so capture-inventory digests and equality remain unavailable.

The record retains all job intervals. It retains all steps for Visonaut jobs and consumer Plan, Gate, app builds, capture and Submit jobs. Other consumer job steps are omitted because their setup is outside W10's consumer capture trace. Artifact page totals include omitted performance artifacts. The retained build and capture artifacts are the relevant subset. Every fetched job/artifact page fit its explicit API total; this is a bounded sample, not an exhaustive failure-rate study.

## D11 measured baseline

| CI run, attempt 1                                                                      | Result  | Runner execution minutes | Run start to Gate |
| -------------------------------------------------------------------------------------- | ------- | ------------------------ | ----------------- |
| [37051834714](https://github.com/ariakit/visonaut/actions/runs/37051834714/attempts/1) | success | 12.9167                  | 212 s             |
| [37048081144](https://github.com/ariakit/visonaut/actions/runs/37048081144/attempts/1) | success | 12.8667                  | 217 s             |
| [37043287444](https://github.com/ariakit/visonaut/actions/runs/37043287444/attempts/1) | success | 13.2833                  | 216 s             |

These runs use the same checks source, Git blob `92e20fabb64f818c492845b6b741db8f3a2ea633`. The record distinguishes each API PR head from its actual merge checkout, read from the checkout log. The workflow source matches at both identities. See the [actual source for run 37051834714](https://github.com/ariakit/visonaut/blob/443669d625bf7e0904c5043e2ffab131f9791003/.github/workflows/checks.yml). The artifact endpoint returned zero artifacts for each current baseline run.

| Step                   | Run 37051834714 | Run 37048081144 | Run 37043287444 |
| ---------------------- | --------------- | --------------- | --------------- |
| Browser full build     | 6 s             | 8 s             | 8 s             |
| Browser installation   | 48 s            | 36 s            | 40 s            |
| Browser tests          | 75 s            | 101 s           | 100 s           |
| Build job build        | 8 s             | 8 s             | 9 s             |
| Public package smoke   | 3 s             | 3 s             | 3 s             |
| Release guards install | 5 s             | 5 s             | 5 s             |
| Release guards tests   | 2 s             | 1 s             | 2 s             |

Unit-shard builds took 7–9 seconds. Checkout, Node, pnpm, container setup and post-steps remain in the data. Browser's inspected log in run 37051834714 shows an exact pnpm cache hit. Release guards have no pnpm cache configured. Other cache states remain unavailable unless the record contains direct log evidence; a short install does not establish a hit.

The older failed [run 36429897960](https://github.com/ariakit/visonaut/actions/runs/36429897960/attempts/1) used [different checks source](https://github.com/ariakit/visonaut/blob/9cf2f34507cad8f1f4ebc4016b9402f23bbdfcb1/.github/workflows/checks.yml), blob `c2a9fac40747ed9c5c99c9392416ec24608095c9`. Test 3/3 failed because the WebKit executable was absent. Gate failed. The run included Container checks, different browser setup, and a 50,615-byte public-package artifact. It is failure-path evidence, not a comparable before run.

## D11 setup decision

The patch removes only Browser's full build:

```diff
 - run: pnpm exec playwright install --with-deps chrome chromium
-- run: pnpm build
 - run: pnpm test:browser
```

Browser serves the [source Vite fixture](../../../../apps/web/src/review/__tests__/vite.config.ts). The route fixture reads tracked [routeTree.gen.ts](../../../../apps/web/src/routeTree.gen.ts). It does not need a generated production route tree or app/package `dist` output.

Keep every other job, name, dependency, and setup step:

- Build and `check:packages` consume built public packages.
- [Adapter comparison tests](../../../../packages/playwright/test/comparison.test.ts) use `../dist/reporter.js`. [Client tests](../../../../packages/playwright/test/clients.test.ts) use package dist exports. [CLI binary tests](../../../../packages/cli/test/binary.test.ts) build the CLI themselves, but also pack/install the adapter. Keep test-shard builds.
- [Release guards](../../../../.github/workflows/scripts/packages.test.mjs) resolve `@changesets/cli/bin.js` and test real version plans. Keep workspace installation.
- Lint and Typecheck need their declared tools. Keep parallel jobs and the existing fail-closed Gate.

**Modeled only:** removing the recorded Browser build would subtract 6–8 execution seconds from these particular totals if all other intervals stayed fixed. Test 1/3 finished after Browser in all three samples. Removing Browser's build alone does not model a faster Gate in those samples. There is no comparable actual CI after run, and no measured improvement is claimed.

## D04 observed scenarios

The successful main [run 37051707335](https://github.com/ariakit/ariakit/actions/runs/37051707335/attempts/1) used [`c3846e9`](https://github.com/ariakit/ariakit/commit/c3846e9bf542f4cd08fb4b2f746a94c0587c7238), native CI blob `3dbaca30542ae9e84bbbba3f87cc29891bdf7856`, and App blob `ec8ba1563228164856c33c94f4fa96645448c730`. See [native CI source](https://github.com/ariakit/ariakit/blob/c3846e9bf542f4cd08fb4b2f746a94c0587c7238/.github/workflows/ci.yml) and [App source](https://github.com/ariakit/ariakit/blob/c3846e9bf542f4cd08fb4b2f746a94c0587c7238/.github/workflows/app.yml). It used trusted toolchain [`c87988e`](https://github.com/ariakit/ariakit/commit/c87988effdff42edf4934ded906aa32ee3c04b66), CLI 0.5.3 and adapter 0.4.0. Both visual shards and regular App tests download the `app-build` and `nextjs-dist` artifacts. Those builds remain required.

| Scope          | Job duration | Main test/submit step | Capture artifact           | Age at Submit job start     |
| -------------- | ------------ | --------------------- | -------------------------- | --------------------------- |
| Linux capture  | 628 s        | 543 s                 | 41,807,608 bytes           | 312 s                       |
| Safari capture | 483 s        | 401 s                 | 21,736,420 bytes           | 9 s                         |
| Submit         | 118 s        | 97 s                  | 524-byte discovery receipt | Created after Submit starts |

Capture archives total 63,544,028 bytes. Their digests, one-day expiry and observed `expired=false` values are in the record. At the fixed age reference, Linux was 896 seconds old and Safari was 593 seconds old. Linux had a Playwright restore-key cache hit; Safari had an exact Playwright cache hit. Dependency-store cache state was not established.

The three visual jobs used 20.4833 unweighted execution minutes. Keep the Linux and macOS components separate for a later billing comparison. The complete main CI run used 71.8667 execution minutes across its non-skipped jobs. Main Gate was skipped by design, so Gate time is unavailable. These are first-attempt observations, not full-versus-partial rerun measurements. Required Visonaut App-check completion was not independently read.

- Cancelled PR [37049899857](https://github.com/ariakit/ariakit/actions/runs/37049899857/attempts/1): Linux finished in 620 seconds; Safari was cancelled after a 260-second interval; Submit was cancelled before execution with an inverted API interval. Gate failed. One Linux artifact exists; no Safari capture artifact exists. The known total is incomplete because Submit has no valid interval.
- Failed PR [37036286321](https://github.com/ariakit/ariakit/actions/runs/37036286321/attempts/1): both captures succeeded; Submit exited with code 4; Gate failed. This is not a failed-capture sample.
- Plan [37011422172](https://github.com/ariakit/ariakit/actions/runs/37011422172/attempts/2): both attempts failed Plan and Gate, with no artifacts. The inspected second Plan log reports an authentication or permission failure. Run starts were read from each explicit attempt endpoint. Exact checkout SHAs and workflow blobs remain unavailable for this sample.

The cancelled and failed PR samples retain their API head SHAs separately from merge checkouts [`f66e6e9`](https://github.com/ariakit/ariakit/commit/f66e6e946eec77cdbe1a28d061a7a330a7fdce6e) and [`0dcf1be`](https://github.com/ariakit/ariakit/commit/0dcf1bed0cc96301189c4e0601e5ccdcf45afe85). Their record includes the capture-job `git log -1 --format=%H` readbacks.

The commits and workloads differ. Do not infer rerun savings, common capture inventory, or a failure rate from these samples.

## Controlled trial plan and exact hold

[ariakit-full-rerun-trial.patch](../../operations/ariakit-full-rerun-trial.patch) prepares a contributor-guide addition against [the inspected consumer source](https://github.com/ariakit/ariakit/blob/c3846e9bf542f4cd08fb4b2f746a94c0587c7238/contributing.md). It adds a clear **Re-run all jobs** action for the full-attempt arm. It is review material inside Visonaut; it has not changed Ariakit or the pinned workflows. Normal verified mixed-attempt support and Submit-only reuse remain unchanged.

Use the same tested commit, CI/App pins, rendering profiles, exact Plan inventory, capture inventory and inventory digests for both arms. Record each artifact digest and source attempt. Count earlier jobs once, then measure the additional rerun jobs separately.

| Scenario            | Current partial arm                                                        | Full-attempt arm                                         | Required evidence                                               |
| ------------------- | -------------------------------------------------------------------------- | -------------------------------------------------------- | --------------------------------------------------------------- |
| Success             | Normal selected CI                                                         | Complete matching attempt                                | Successful Plan, complete capture inventory and verified Submit |
| Failed shard        | Retry failed capture and dependent Submit                                  | Re-run all CI jobs                                       | Failed or missing capture cannot pass                           |
| Cancellation        | Retry cancelled/failed selected work                                       | Re-run all CI jobs                                       | Cancelled required work cannot pass                             |
| Expired artifact    | Re-run all CI jobs                                                         | Re-run all CI jobs                                       | Submit-only cannot restore bytes                                |
| Submit-only failure | Retry Submit with unchanged commit and available verified source artifacts | Use a full CI rerun for the complete-attempt measurement | Record reuse separately; support remains                        |
| Failed/missing Plan | Correct the cause, then run valid Plan and required jobs                   | Same                                                     | Failed or missing Plan cannot pass                              |

For each scenario, retain duration, runner labels and minutes by OS, queue delay, run start to Gate, separate required App-check completion, artifact bytes and age at actual selection, cache state, inventory/digest/attempt proof, outcome, and exact operator actions. Use `null` plus a reason for unavailable fields. No acceptable cost threshold was supplied.

**Hold:** paired controlled trials and their repeated-attempt App-check readback were not authorized or run. **Re-run all jobs** also repeats regular tests, app builds, and the existing preview deployment. Consumer edits and those workflow actions need a separate instruction. No workflow was triggered, failed/cancelled deliberately, or altered to simulate expiry. Existing provenance tests cover those negative paths; do not delete artifacts or add a natural one-day wait. D04 does not reach a support decision or authorize partial-rerun retirement from this preparation.

## Repeat the reads

Use explicit attempt endpoints and preserve page totals. For example, these commands only read GitHub:

```sh
repository=ariakit/visonaut
run_id=37051834714
attempt=1
gh api --method GET "repos/$repository/actions/runs/$run_id"
gh api --method GET "repos/$repository/actions/runs/$run_id/attempts/$attempt/jobs?per_page=100&page=1"
gh api --method GET "repos/$repository/actions/runs/$run_id/artifacts?per_page=100&page=1"
gh run view "$run_id" --repo "$repository" --attempt "$attempt" --job 110986857566 --log
```

If a page does not cover the API total, read each remaining page. Read each actual checkout SHA from its log; fetch the workflow source at that SHA and retain its Git blob, rather than assuming the API PR head is the checkout. Fetch attempt-specific run metadata for a new rerun. Current artifact metadata is not proof of availability at an earlier selection. Inspect cache logs for each compared job. Preserve new records separately; do not replace this dated baseline.

## Local validation

Browser passed all 112 existing tests with W02's reviewed owned-server commit [`dd611f6`](https://github.com/ariakit/visonaut/commit/dd611f64a91b253062378e3bc6334b3b166b3a85). The command was `VISONAUT_TEST_PORT=42047 pnpm test:browser`. All app/package `dist` directories and web `.tanstack`/`.output` directories were absent before and after the run. The tracked route tree remained in use. This task's generated output was moved aside and restored after validation. The suite logged ResizeObserver loop warnings, also present in W02's evidence, but all tests passed. No CI speed improvement can be claimed from this local proof.

`pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm check:packages` and the full `pnpm test` suite passed (1,194 tests in 74 files). The focused CLI artifact/retry/bundle, security OIDC and native workflow tests passed (169 tests in six files); all 70 release guards passed. The actual inline Gate source passed all-success and rejected failure, skipped and cancelled results for each of its six required needs; malformed JSON failed. The required-needs list and `if: always()` remain unchanged. The prepared consumer patch passes `git apply --check` against an isolated copy of the inspected source. These checks used Node 24.18.0 and pnpm 12.5.1.

No deployment, publication, consumer edit, branch-rule change, provider proxy, resource mutation, data deletion or schema cleanup occurred. The separate #7710 duplicate-check investigation owns check-publisher work.
