# Public and internal packages

Scope: `packages/cli` (`visonaut@0.5.4`), `packages/playwright` (`@visonaut/playwright@0.5.0`), `packages/protocol` (private), and `packages/service` (private). I read all source files, the tests, the READMEs, the tsup configurations, and the package manifests. I also read the parts of `apps/web` that call these packages.

Method: the audit is read-only. All probes ran from a scratch directory with the repository's own Vitest (`/Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/packages/probe/`). The published tarballs came from the npm registry into scratch. This lane wrote no file in the repository. `git status` shows `M pnpm-lock.yaml` and `?? apps/lab/`; these changes come from another lane.

Short list of the most important results:

- The CLI stops on answers that the server marks as temporary (PKG-01), and it hides the cause of most failures (PKG-02).
- The image limits differ in six places. Ariakit's largest known capture is at 98% of the effective pixel limit (PKG-03).
- `Service.status()` makes 5 to 6 sequential database round trips, and the review page calls it on each load and each poll (PKG-05).
- The published `visonaut` bundle contains pngjs and pixelmatch without their license notices (PKG-13).
- Manifest validation is not a bottleneck: 13 ms for 3,582 captures (Measurements, M13).

## How it works (map)

### Package roles

| Package               | Published                    | Entry points                                                                                                                                   | Bundling                                                                                                                                                  |
| --------------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/protocol`   | no                           | `src/index.ts` re-exports `types.ts`, `hash.ts`, `validate.ts`, `workflow-jobs.ts` (`packages/protocol/src/index.ts:1-4`)                      | Source-only. The CLI and the adapter inline it.                                                                                                           |
| `packages/playwright` | `@visonaut/playwright@0.5.0` | `.` (`visual`, `visualBatch`), `./reporter` (default class), `./environment` (`measureEnvironment`) (`packages/playwright/package.json:17-33`) | tsup ESM, three entries, `noExternal: ["@visonaut/protocol"]`. `pngjs` is a runtime dependency. `@playwright/test` is an exact peer `1.63.0`.             |
| `packages/cli`        | `visonaut@0.5.4`             | bin `visonaut` and `runCli` (`packages/cli/package.json:11-25`)                                                                                | tsup ESM, `noExternal: ["@visonaut/protocol", "@visonaut/compare", "pixelmatch", "pngjs"]` (`packages/cli/tsup.config.ts:14`). Zero runtime dependencies. |
| `packages/service`    | no                           | `src/index.ts` (`packages/service/src/index.ts:1-11`)                                                                                          | Source-only. Used by `apps/web`, `apps/compare` (types only), and tooling.                                                                                |

CI already checks the two public tarballs: file list, bundled internal imports, and a basic import (`.github/workflows/scripts/packages.mjs:13-122`).

### Capture sequence (adapter)

1. `visual(page, options)` writes a start marker attachment and calls `capturePrepared` (`packages/playwright/src/visual.ts:179-184`, `278-283`).
2. `reserveIdentity` rejects a second capture of the same item and variant in one test attempt (`visual.ts:285-296`).
3. `comparisonOptions` resolves settings in this order: project defaults, batch, image. Missing `project.metadata.visonaut.comparisonDefaults` is an error (`packages/playwright/src/comparison.ts:16-59`).
4. The adapter waits for `domcontentloaded` and for no font face in the `loading` state (`visual.ts:298-319`). It reads viewport, scale, locale, time zone, and media settings from the page (`visual.ts:118-163`).
5. `getStableScreenshot` takes screenshots until two consecutive decoded images are equal. It waits 100 ms between screenshots (`visual.ts:362-385`).
6. `attachCapture` writes the PNG to a private temporary file and attaches the JSON metadata (`visual.ts:443-487`).
7. The reporter `onEnd` accepts only a passed run. Each collected test must pass on its final attempt (`packages/playwright/src/reporter.ts:53-65`, `134-141`). It matches start markers with completions (`reporter.ts:158-189`), verifies bytes against the digest (`reporter.ts:200-211`), and writes `images/<sha256>.png`, `manifest.json`, and `receipt.json`. On an error it deletes the outputs and fails the run (`reporter.ts:263-269`).

### Submit sequence (CLI)

Request counts are for `visonaut submit --shard linux --shard safari`, attempt 1, 3,582 reference captures, no visual change. The counts come from the code.

| #   | Step                                                            | Code                                                                               | Requests                                                                           |
| --- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| 1   | Parse arguments                                                 | `packages/cli/src/workflow.ts:5-56`                                                | 0                                                                                  |
| 2   | Start the App check                                             | `packages/cli/src/bundle-submit.ts:57-72`                                          | 1 OIDC + 1 `POST /v1/runs/{run}/begin`                                             |
| 3   | Read GitHub evidence and download artifacts                     | `packages/cli/src/github-artifacts.ts:135-275`                                     | run 1 + jobs 1 + artifacts 1 + 2 for each shard + run 1 = 8                        |
| 4   | Combine shards into one manifest (`shard.key: "combined"`)      | `packages/cli/src/bundles.ts:21-132`                                               | 0                                                                                  |
| 5   | Bind to the signed Submit job                                   | `packages/cli/src/signed-context.ts:12-104`                                        | 1 OIDC + 1 jobs list                                                               |
| 6   | Load and validate local images                                  | `packages/cli/src/engine.ts:778-784`, `packages/cli/src/local-comparison.ts:32-46` | 0                                                                                  |
| 7   | Reserve                                                         | `engine.ts:390-414`                                                                | 1 OIDC + 1 `POST /v1/runs`                                                         |
| 8   | Read the pinned reference inventory, 200 captures for each page | `local-comparison.ts:133-200`                                                      | 18 `POST /v1/runs/{id}/reference`                                                  |
| 9   | Compare locally                                                 | `local-comparison.ts:209-335`                                                      | 1 `GET` for each capture whose digest differs = 0                                  |
| 10  | Rewrite manifest and receipt                                    | `signed-context.ts:107-129`                                                        | 0                                                                                  |
| 11  | Declare, prove reuse, upload                                    | `engine.ts:438-684`                                                                | 1 declare. Changed images: reuse pages of 32 (4 parallel), then `PUT` (5 parallel) |
| 12  | Finalize                                                        | `engine.ts:848-864`                                                                | 1                                                                                  |
| 13  | Submit                                                          | `engine.ts:352-380`                                                                | 1 OIDC + 1 `POST /v1/runs/{run}/submit`                                            |

Total: 36 sequential requests (4 OIDC, 23 service, 9 GitHub API).

Retry rules (`packages/cli/src/http.ts:135-223`): one 30-second deadline covers all attempts of a request. A retry needs all of these: `retryUnavailable: true`; method `GET`, `PUT`, or the reuse `POST`; HTTP 503; a valid `Retry-After`; error code `validation_busy` or `service_unavailable`. Only step 9 downloads, step 11 reuse and `PUT`, and `status` set `retryUnavailable`. Network errors are never retried (`http.ts:225-233`).

Exit codes (`packages/cli/src/errors.ts:1`): 0 success, 1 operation failure, 2 invalid arguments, 3 status not passed, 4 authentication or trust failure.

### Protocol

- `types.ts`: wire types, `SCHEMA_VERSION = "1.0"`, comparison identities, and the `TRANSPORT` path table (`packages/protocol/src/types.ts:1-2`, `129-131`, `347-358`).
- `hash.ts`: `canonicalJson` (sorted keys, array order kept), `sha256`, `digestJson`, profile digests, `identityKey` (`packages/protocol/src/hash.ts:4-63`).
- `validate.ts`: `parseManifest` (`236-390`), `validateLocalComparison` (`401-451`), `uploadImages` (`454-481`), and the trusted-plan validators (`483-728`).
- `workflow-jobs.ts`: the `{shard}` job-name template (`packages/protocol/src/workflow-jobs.ts:4-40`).

### Service

- `Service` is a facade with about 30 methods. Each method calls a module function (`packages/service/src/service.ts:81-310`).
- All guarded writes use `atomic()`: one D1 batch plus assertion statements. A false assertion inserts a row that breaks a CHECK constraint, so D1 rolls the batch back (`packages/service/src/database.ts:44-69`).
- Run lifecycle: `reserveRun` (`run-admission.ts:46-353`), `registerImages` (`359-407`), `commitShard` (`409-701`), `sealRun` (`737-801`), `createLocalComparison` (`local-comparison.ts:371-552`), `finalizeComparison` (`563-691`), `applyReviewCommand` and `undoReviewCommand` (`review-commands.ts:126-467`), `preparePromotion` and `promote` (`baseline-promotion.ts:65-206`, `348-513`), `retireRun` and `expireIncompleteWorkflowRun` (`run-retirement.ts:11-163`).
- Status: `readRunStatus` (`run-status.ts:26-80`) calls the pure function `reviewStatus` (`review-status.ts:67-96`). The dashboard calls `reviewStatus` directly (`apps/web/src/api/dashboard.ts:100`).
- `work.ts`: task leases, the GitHub status outbox, retention pins, and deletion leases.

## Findings

### PKG-01 · The CLI stops on answers that the server marks as temporary

- Kind: inconsistency
- Severity: medium. Confidence: medium. Measured: yes. Effort: M
- Evidence:
  - `packages/cli/src/http.ts:201-213`:
    ```ts
    retryUnavailable &&
    (method === "GET" ||
      method === "PUT" ||
      (method === "POST" && /^\/v1\/runs\/[a-f0-9-]+\/reuse$/.test(url.pathname))) &&
    response.status === 503 &&
    ...
      (error?.code === "validation_busy" || error?.code === "service_unavailable") &&
    ```
  - `packages/cli/src/http.ts:229-232`: `"The request failed, timed out, or redirected. Check the service and retry."` is thrown for each network error, with no second attempt.
  - The server adds `Retry-After: 1` to each 503: `apps/web/src/api/index.ts:42` `...(error.status === 503 ? { headers: { "Retry-After": "1" } } : {})` and `index.ts:82`.
  - Count: 55 throw sites with HTTP 503 in the six server files behind `begin`, `plan`, `reserve`, and `submit`. They use 10 codes: `workflow_candidate` 17, `check_pending` 14, `workflow_identity` 6, `pre_run_check` 6, `workflow_configuration` 5, `merge_not_ready` 3, `workflow_conflict` 1, `validation_busy` 1, `stale_candidate` 1, `ambiguous_check` 1 (Measurements, M9).
  - Examples of waiting states: `apps/web/src/api/pre-run-checks.ts:474` `"Check creation is in progress."`, `apps/web/src/api/pre-run-candidates.ts:86` `"The pull request merge ref is not ready."`, `apps/web/src/api/pre-run.ts:139` `"The current App check is not ready."`.
  - The behavior is fixed by tests: `packages/cli/test/retry.test.ts:128` `"does not retry network failures"`, `retry.test.ts:179` `"does not retry the %s operation"` for `oidc`, `reserve`, `declare`, `finalize`, and `retry.test.ts:81` for HTTP 429 and 500.
  - Probe M1: `visonaut begin --run 1` against a stub that answers `503 service_unavailable` with `Retry-After: 1` made 2 requests (1 OIDC, 1 begin) and returned exit 4.
- What happens: the server answers "not ready yet" with 503 and `Retry-After: 1`. The CLI retries only two codes, and only for downloads, uploads, the reuse call, and `status`. In an unchanged Submit, all 4 OIDC requests and all 23 service requests have no retry. One temporary answer or one connection reset fails the job.
- Impact: a maintainer must run the Submit job or the Plan job again by hand. A Submit-only rerun is supported, so no data is lost. The frequency in production is not measured.
- Recommendation: let the request say that it is safe to repeat, and retry each 503 answer that has `Retry-After`. The server paths are written for replay (`reserveRun` returns the existing run, `packages/service/src/run-admission.ts:62-77`; `commitShard` returns for a complete shard, `run-admission.ts:443-447`).
  ```ts
  // http.ts
  interface RequestParams {
    /** The server accepts an exact replay of this request. */
    replaySafe?: boolean;
  }
  const temporary = response.status === 503 && delay !== undefined;
  const retriable =
    (method !== "POST" || replaySafe) && temporary && attempt < MAX_REQUEST_ATTEMPTS;
  ```
- Alternatives:
  - Minimal: retry only `begin` and `plan` for the codes `check_pending`, `merge_not_ready`, and `pre_run_check`.
  - Keep the CLI as it is and retry in the workflow (a retry step around `visonaut submit`). This repeats the downloads.
  - Change the server: return 409 for states that the client must not retry, and keep 503 only for states that it can retry. Then the client rule becomes "retry each 503".
- Maintainer decision needed: yes. The tests show that "no retry for POST and network errors" was a choice. Do you want to keep it now that the server uses 503 for waiting states?

### PKG-02 · The CLI hides the cause of most failures

- Kind: dx
- Severity: medium. Confidence: high. Measured: yes. Effort: M
- Evidence:
  - `packages/cli/src/http.ts:221-223`: `` `The service refused the request (HTTP ${response.status}). No visual approval was granted.` ``. The parsed `error.code` is used only for four codes (`http.ts:185-213`). `error.reference` is never read. The server sends it for each unexpected failure (`apps/web/src/api/index.ts:76-80`).
  - `packages/cli/src/bundle-submit.ts:69-71`: `catch { throw new CliError("The signed Submit check could not be started.", 4); }`.
  - `packages/cli/src/index.ts:37-38`: `error instanceof CliError ? error : new CliError("The verified capture submission failed.")`.
  - `packages/cli/src/files.ts:54-56`: each `ProtocolError` from `parseManifest` becomes `"The manifest cannot be read or validated. Check the schema, capture results, and profile digests."`.
  - `packages/cli/src/png-comparison.ts:38`: each `ImageValidationError` becomes `"An image is not a supported, bounded PNG. Capture the image again."`. The original error has a code and a message, for example `packages/compare/src/types.ts:61` `"Image dimensions exceed the configured decode limit."`.
  - No message in `files.ts`, `local-comparison.ts`, or `png-comparison.ts` names the item, the variant, or the file.
  - Probe M1, raw output:
    ```text
    $ visonaut begin --run 1   # service answers 503 service_unavailable with error.reference
      exit=4
      stderr="visonaut: The signed Submit check could not be started.\n"
    $ visonaut begin --run 1   # no OIDC environment
      exit=4
      stderr="visonaut: The signed Submit check could not be started.\n"
    $ visonaut submit --shard linux   # VISONAUT_CAPTURE_JOB_NAME has no {shard} slot
      exit=1
      stderr="visonaut: The verified capture submission failed.\n"
    ```
- What happens: five catch blocks replace a specific error with a general sentence. A service outage during `begin` returns exit 4, which the README defines as "authentication or trust failure". A wrong job-name template returns exit 1 with no hint. The request reference that connects a failure to the server log is dropped.
- Impact: a failed Submit job in CI gives the maintainer no item, no limit, no server code, and no reference. The contract promises the reference for the review client (`docs/current-contract.md:79-89`). The CLI receives the same data and does not show it.
- Recommendation: keep secrets out, but print values that have a fixed format.
  ```ts
  // http.ts: print only values that match a strict format.
  const code =
    typeof error?.code === "string" && /^[a-z_]{1,64}$/.test(error.code) ? error.code : undefined;
  const reference =
    typeof error?.reference === "string" && /^[0-9a-f-]{36}$/.test(error.reference)
      ? error.reference
      : undefined;
  throw new CliError(
    `The service refused the request (HTTP ${response.status}${code ? `, ${code}` : ""}).` +
      `${reference ? ` Reference: ${reference}.` : ""} No visual approval was granted.`,
  );
  ```
  ```text
  visonaut: docs/long-page (react-light): 1280x1700 is 2,176,000 pixels. The limit is 2,100,000.
  ```
  Let `beginSubmission` pass a `CliError` through unchanged. Convert `ProtocolError` to a `CliError` that keeps `error.message` (the validator messages contain no secret values).
- Alternatives:
  - Minimal: print only `error.code` and `error.reference` for HTTP failures.
  - Print details only with a `--verbose` flag or when `RUNNER_DEBUG=1`.
  - Write details to `GITHUB_STEP_SUMMARY` and keep the log line general.
- Maintainer decision needed: yes. Item and variant keys would appear in a public CI log. Is that acceptable? The repository and its test names are already public.

### PKG-03 · Image and capture limits differ in six places, and the smallest limit applies last

- Kind: inconsistency
- Severity: medium. Confidence: high. Measured: yes. Effort: M
- Evidence:

  | Limit                        | Adapter                         | CLI archive                                                    | CLI files              | CLI local comparison                                 | Protocol validator                            | Server default                               |
  | ---------------------------- | ------------------------------- | -------------------------------------------------------------- | ---------------------- | ---------------------------------------------------- | --------------------------------------------- | -------------------------------------------- |
  | Encoded bytes for each image | 20 MiB (`visual.ts:352`, `399`) | 20 MiB (`artifact-archive.ts:11`)                              | 20 MiB (`files.ts:10`) | 2 MiB (`packages/compare/src/types.ts:10`)           | 100,000,000 (`validate.ts:348`)               | 2 MiB (`apps/web/src/runtime-defaults.ts:8`) |
  | Decoded pixels               | 32,000,000 (`visual.ts:356`)    | none                                                           | none                   | 2,100,000 and 8,192 for each side (`types.ts:11-12`) | 100,000 for each side (`validate.ts:349-350`) | same as local comparison                     |
  | Bytes for each shard         | none                            | 1 GiB (`artifact-archive.ts:7`)                                | 1 GiB (`files.ts:11`)  | none                                                 | none                                          | 512 MiB (`runtime-defaults.ts:9`)            |
  | Manifest bytes               | none                            | 8 MiB (`artifact-archive.ts:10`)                               | 8 MiB (`files.ts:9`)   | none                                                 | none                                          | 16 MiB (`runtime-defaults.ts:12`)            |
  | Captures                     | none                            | 5,000 archive entries for each shard (`artifact-archive.ts:8`) | none                   | none                                                 | 100,000 (`validate.ts:114`)                   | 40,000 (`runtime-defaults.ts:14`)            |
  - Probe M3, raw output:
    ```text
    white full page: 1280x1700 = 2.18 MP, 0.01 MiB
      parseManifest + validateImages (protocol 100 MB, CLI 20 MiB): yes
      validateLocalImages (compare limits 2 MiB, 2.1 MP, 8192 px): An image is not a supported, bounded PNG. Capture the image again.
    noisy image: 1000x800 = 0.80 MP, 3.05 MiB
      parseManifest + validateImages (protocol 100 MB, CLI 20 MiB): yes
      validateLocalImages (compare limits 2 MiB, 2.1 MP, 8192 px): An image is not a supported, bounded PNG. Capture the image again.
    ```
  - `packages/compare/evidence/hosted-largest-fixture.json`: `"width": 1248, "height": 1650`. That is 2,059,200 pixels, 98.1% of 2,100,000. At width 1,248 a height of 1,683 pixels is above the limit.
  - `packages/compare/src/types.ts:8`: `/** Provisional resource bounds; the deployed probe must pass before launch. */`.
  - `packages/compare/evidence/ariakit-capture-count.md` states 3,582 captures for a complete cycle and a target of ten times that number. The CLI archive accepts 5,000 entries for each shard.

- What happens: the adapter accepts a capture that is ten times larger than the trusted Submit accepts. All capture jobs pass. The failure comes later in Submit, with a message that tells the user to capture again. A new capture has the same size.
- Impact: one page section that grows by 33 pixels in height can stop all visual submissions for a pull request. The message does not name the section or the limit (see PKG-02).
- Recommendation: export one limits object from `@visonaut/protocol` and use it in the adapter, the CLI, and the validator. Fail in `visual()` with the item key.
  ```ts
  // packages/protocol/src/limits.ts
  export const captureLimits = Object.freeze({
    maxEncodedBytes: 2 * 1024 * 1024,
    maxPixels: 2_100_000,
    maxDimension: 8192,
  });
  // packages/playwright/src/visual.ts
  if (width * height > captureLimits.maxPixels) {
    throw new Error(
      `${options.item}: ${width}x${height} exceeds ${captureLimits.maxPixels} pixels`,
    );
  }
  ```
- Alternatives:
  - Minimal: change only the adapter constants at `visual.ts:352-357` and `399` to the Submit values.
  - Keep the adapter limits and add a warning in the reporter when a capture exceeds the Submit limits.
  - Raise the comparison limits. This needs new resource evidence for the validation Worker.
- Maintainer decision needed: yes. Are 2 MiB and 2.1 million pixels the final limits, or still provisional as the comment says?

### PKG-04 · Submit decodes each candidate PNG two times, also when the bytes equal the reference

- Kind: performance
- Severity: medium. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - First decode: `packages/cli/src/local-comparison.ts:44` `await decodePng(await readImage(local.directory, capture), capture.image);`
  - Second decode: `local-comparison.ts:239` `const candidate = await decodePng(await readImage(local.directory, capture), capture.image);`
  - The equality check comes after the second decode: `local-comparison.ts:260-274` (`accepted.image.digest === capture.image.digest && ...`).
  - `decodePng` inflates the image two times: `validateImage` inflates all IDAT data (`packages/compare/src/png.ts:200`), then `PNG.sync.read` decodes again (`packages/cli/src/png-comparison.ts:15-25`).
  - Each image is also read and hashed six times before upload: `github-artifacts.ts:243`, `bundles.ts:44`, `bundles.ts:130`, `local-comparison.ts:36`, `local-comparison.ts:44`, `local-comparison.ts:239`.
  - Probe M2, 200 synthetic page-like images for each size:
    ```text
    Scenario 1280x720, 200 images, mean 649 KiB
    validateImages (path checks + read + SHA-256), one pass    total    118 ms   per image   0.59 ms
    validateLocalImages (validateImages + read + decode)       total   9399 ms   per image  46.99 ms
    readImage + decodePng only                                 total   8336 ms   per image  41.68 ms
    compareLocally, every capture byte-identical to reference  total   9259 ms   per image  46.30 ms
      share of compareLocally spent before the digest equality check: 90 %
    Scenario 1248x1650, 200 images, mean 704 KiB
    validateLocalImages (validateImages + read + decode)       total  11634 ms   per image  58.17 ms
    readImage + decodePng only                                 total  10968 ms   per image  54.84 ms
    compareLocally, every capture byte-identical to reference  total  10973 ms   per image  54.87 ms
    ```
  - Probe M4, three real 640x360 browser screenshots from `packages/compare/evidence/browser/`: `decodePng` 3.88 ms, 4.87 ms, 5.10 ms. SHA-256 only: 0.013 ms.
- What happens: in a run with no visual change, `compareLocally` needs no pixels. It still decodes each image, and 90% to 100% of its time is that decode. The read-and-hash passes are cheap (about 0.5 ms for each image and pass).
- Impact: arithmetic from the measured values, for 3,582 captures on this machine: one decode pass is 14 to 18 seconds at 640x360 and 149 to 196 seconds for the synthetic large images. A Submit runs two passes. The CI runner speed and the real size distribution are not measured.
- Recommendation: compare the metadata before the decode. `validateLocalImages` already proved that the decoded size equals `capture.image` (`png-comparison.ts:26-32`).
  ```ts
  const accepted = reference.get(key);
  if (!accepted) {
    const changedPixels = capture.image.width * capture.image.height;
    captures.push({ ...result, outcome: "changed", changedPixels, ratio: 1, sizeChanged: false });
    continue;
  }
  if (sameImage(accepted.image, capture.image)) {
    captures.push({
      ...result,
      outcome: "unchanged",
      changedPixels: 0,
      ratio: 0,
      sizeChanged: false,
    });
    continue;
  }
  const candidate = await decodePng(await readImage(local.directory, capture), capture.image);
  ```
- Alternatives:
  - Minimal: move only the equality branch above the decode and keep the decode for new captures.
  - Also remove the first decode: reserve first, read the reference, then validate and compare in one pass. This sends a credential before all local bytes are validated, which the comment at `engine.ts:779` forbids today.
  - Use the inflated data from `validateImage` for the pngjs step, so each decode inflates one time.
- Maintainer decision needed: no.

### PKG-05 · `Service.status()` makes 5 to 6 sequential round trips and reads rows that the caller already has

- Kind: performance
- Severity: medium. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - `packages/service/src/run-status.ts:26-80`: `service.run` (27), `service.comparison` (45), dead-task query (48-52), counts (56-60), `service.project` (61), promotion (62-68). Each is a separate `await`.
  - Probe M5 on the repository's SQLite fixture:
    ```text
    Service.status(run) when the project has a promotion pointer: 6 round trips
       1. SELECT * FROM visonaut_runs WHERE id = ?
       2. SELECT * FROM visonaut_comparisons WHERE id = ?
       3. SELECT task.id, task.last_error FROM work_tasks task JOIN visonaut_comparison_rows row ON row.id = task.id WHE
       4. SELECT COALESCE(SUM(CASE WHEN row.outcome NOT IN ('changed', 'unchanged') OR (row.outcome = 'changed' AND NOT
       5. SELECT * FROM visonaut_projects WHERE id = ?
       6. SELECT 1 AS found FROM visonaut_promotions WHERE id = ? AND comparison_id = ? AND revoked = 0
    Service.review() for one target: 3 round trips (1 single, 1 batch of 5 reads, 1 batch of 14 writes)
    ```
  - Query 3 joins `work_tasks` on the comparison row ID. Only legacy `compare` tasks use that ID, and no source file creates them (PKG-09).
  - Callers that already hold the rows:
    - `apps/web/src/api/review.ts:90` reads the run, `review.ts:292-293` reads the project and then calls `status`, and `review.ts:305` reads the comparison. The status call repeats all three reads.
    - `apps/web/src/api/review.ts:105-130` (`reviewPollState`): run, comparison, then `status`. That is 7 to 8 sequential round trips for each poll, 2 of them repeated.
    - `packages/service/src/run-status.ts:92-106` (`prepareStatusIntent`): run, project, `status`, comparison.
- What happens: the status reader takes only a run ID. It cannot use rows from the caller, and it does not batch. The review command path already batches its reads (`packages/service/src/review-commands.ts:145-176`).
- Impact: this is part of the wait on each review page load and each poll. The latency of one D1 round trip in production is not measured here, so I give counts only.
- Recommendation: read all inputs in one `database.batch`, and remove query 3 when the legacy tasks are gone.
  ```ts
  const [runResult, comparisonResult, countsResult, projectResult, promotionResult] =
    await service.database.batch([
      statement(db, "SELECT * FROM visonaut_runs WHERE id = ?", [runId]),
      statement(
        db,
        `SELECT c.* FROM visonaut_comparisons c
        JOIN visonaut_runs r ON r.comparison_id = c.id WHERE r.id = ?`,
        [runId],
      ),
      statement(
        db,
        `SELECT ${pendingReviewCountSql} AS pending, ${rejectedReviewCountSql} AS rejected
        FROM visonaut_comparison_rows row
        LEFT JOIN visonaut_decisions decision ON decision.id = row.decision_id
        WHERE row.comparison_id = (SELECT comparison_id FROM visonaut_runs WHERE id = ?)`,
        [runId],
      ),
      statement(
        db,
        `SELECT p.* FROM visonaut_projects p
        JOIN visonaut_runs r ON r.project_id = p.id WHERE r.id = ?`,
        [runId],
      ),
      statement(
        db,
        `SELECT 1 AS found FROM visonaut_promotions pr
        JOIN visonaut_projects p ON p.promotion_id = pr.id
        JOIN visonaut_runs r ON r.project_id = p.id
        WHERE r.id = ? AND pr.comparison_id = r.comparison_id AND pr.revoked = 0`,
        [runId],
      ),
    ]);
  ```
  Then compute the result with the pure `reviewStatus` function. This changes 6 round trips to 1.
- Alternatives:
  - Minimal: accept loaded rows, `readRunStatus(service, { run, comparison, project })`, and skip the reads that the caller supplies.
  - Make the callers use the `run` and `comparison` that `status()` already returns, and add `project` to the result. The callers then stop their own reads.
  - One SQL statement with sub-selects in place of a batch.
- Maintainer decision needed: no.

### PKG-06 · The comparison identities accept one value, and stored manifests are validated again on each read

- Kind: inconsistency
- Severity: medium. Confidence: high. Measured: yes. Effort: M
- Evidence:
  - `packages/protocol/src/validate.ts:404-405`:
    ```ts
    member(field(value, "engineVersion"), [LOCAL_COMPARISON_ENGINE], "local engine");
    member(field(value, "codecVersion"), [LOCAL_COMPARISON_CODEC], "local codec");
    ```
  - `packages/protocol/src/types.ts:130-131`: `LOCAL_COMPARISON_ENGINE = "playwright-pixelmatch-1.63.0"`, `LOCAL_COMPARISON_CODEC = "pngjs-7.0.0"`.
  - Stored inventories pass through `parseManifest` on each read: `apps/web/src/capture-inventory.ts:193` and `capture-inventory.ts:369`, both reached from `readCaptureInventoryDocument` (`capture-inventory.ts:553`).
  - `packages/cli/package.json:40-41`: `"pixelmatch": "5.3.0"`, `"pngjs": "7.0.0"`. No test compares these versions with the constants (`rg "pngjs-7"` finds only the constant and one literal at `packages/service/src/service.test.ts:1220`). `renovate.json` has no rule for these packages.
  - The same codec string exists two times: `packages/protocol/src/types.ts:45` and `packages/compare/src/compare.ts:4`.
  - Probe M6:
    ```text
    receipt with codecVersion "pngjs-7.0.1": rejected [INVALID_MANIFEST]: local codec must be one of pngjs-7.0.0
    receipt with engineVersion "playwright-pixelmatch-1.64.0": rejected [INVALID_MANIFEST]: local engine must be one of playwright-pixelmatch-1.63.0
    ```
- What happens: the validator has one accepted engine and one accepted codec. Two cases follow.
  - A dependency update changes pngjs or pixelmatch and nobody changes the constant. Then receipts carry a wrong identity. Approval reuse needs an exact identity (`docs/current-contract.md:184`), so results from two different codecs look equal.
  - Somebody changes the constant. Then all stored inventories with the old value fail `parseManifest`. Review pages for those runs and baseline reads fail. An old CLI and a new server also reject each other until both are deployed.
- Impact: there is no problem today. The next pngjs, pixelmatch, or Playwright update has no safe path.
- Recommendation: separate "accepted for reading" from "written by this build", and bind the written value to the installed version.
  ```ts
  // types.ts
  export const LOCAL_COMPARISON_CODECS = ["pngjs-7.0.0"] as const; // readers accept all
  export const LOCAL_COMPARISON_CODEC = LOCAL_COMPARISON_CODECS[0]; // writers use the newest
  // packages/cli/test/identity.test.ts
  expect(LOCAL_COMPARISON_CODEC).toBe(`pngjs-${require("pngjs/package.json").version}`);
  ```
- Alternatives:
  - Minimal: add only the test, so a dependency update fails CI until a person decides.
  - Add a Renovate rule that disables automatic updates for `pngjs`, `pixelmatch`, `@jsquash/png`, and `@jsquash/webp`.
  - Do not validate the identity strings when the server reads stored data. Validate them only when a new receipt is admitted.
- Maintainer decision needed: yes. When the codec changes, must old approvals stay reusable, or is a new review of all changed items acceptable?

### PKG-07 · A run that expired before completion gets the label "superseded"

- Kind: bug
- Severity: low. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - `packages/service/src/review-status.ts:77`: `if (!run.active) return empty(run.state === "accepted" ? "passed" : "superseded");`
  - `packages/service/src/run-retirement.ts:111`: `"UPDATE visonaut_runs SET active = 0, state = 'failed', closed_at = COALESCE(closed_at, ?) WHERE id = ?"`.
  - Two callers correct the result by hand: `apps/web/src/api/ingest.ts:38-40` (`state.run.state === "failed" ? "failed" : ...`) and `apps/web/src/api/review.ts:774`.
  - The dashboard does not: `apps/web/src/api/dashboard.ts:100-116` passes `active` and `state` to `reviewStatus`, and `apps/web/src/routes/index.tsx:138` shows `"Replaced by a newer run"` for `superseded`.
  - Probe M7:
    ```text
    active failed run (failRun): reviewStatus -> failed
    inactive failed run (expireIncompleteWorkflowRun): reviewStatus -> superseded
    ```
- What happens: `expireIncompleteWorkflowRun` closes a stuck run as failed and inactive. `reviewStatus` checks `active` first, so the failed state is lost. The CLI status endpoint says `failed`. History says that the run was replaced.
- Impact: a maintainer who looks at History for a missing review gets a wrong reason. No newer run exists. I did not capture this state in a browser; the label mapping is from the code.
- Recommendation: test the failed state before the inactive branch, then remove the two corrections in `apps/web`.
  ```ts
  if (run.state === "failed") return empty("failed");
  if (!run.active) return empty(run.state === "accepted" ? "passed" : "superseded");
  ```
  `prepareStatusIntent` throws for `superseded` (`run-status.ts:95-97`). With this change an expired run goes to the `failed` branch there, so that function needs its own check for inactive runs.
- Alternatives:
  - Minimal: correct only the dashboard caller, as the other two callers do.
  - Add a separate status value `expired` with its own label.
- Maintainer decision needed: no.

### PKG-08 · The published CLI contains removed commands, and most transport tests use them

- Kind: dead-code
- Severity: low. Confidence: high. Measured: yes. Effort: M
- Evidence:
  - The public entry sends only `status`, `begin`, and `--help` to the engine unchanged. It rewrites `submit` to `["submit", "--dir", prepared.directory]` with `trustedSubmit = true` (`packages/cli/src/index.ts:12-35`).
  - Code that this entry cannot reach:
    - `engine.ts:63-64`, `100-103`: the `upload` command and the `submit --run` and `--dir` rules. Message: `"Choose upload, submit, or status. Use --help for usage."`
    - `engine.ts:760-777`: `submit --run`.
    - `engine.ts:782-784`: `validateImages` for a Submit that is not trusted.
    - `engine.ts:875-889` and `899-914`: JSON output for `submit` and `upload`. `--json` is not accepted for `submit` (probe M1: exit 2).
    - `engine.ts:915-921`: the `upload` text output.
    - `http.ts:239`: the `"transfer-key"` purpose.
    - `bundles.ts:95`: the WebP extension. The archive reader accepts only `images/<sha256>.png` (`artifact-archive.ts:104`).
  - The server rejects each reservation without local mode: `apps/web/src/api/workflow-owned.ts:182-185` (`"local_comparison_required"`, 409). The removed paths cannot work against the current server.
  - The README says they are gone: `packages/cli/README.md:33` `"The old pack, upload, upload --bundle, submit --bundle, submit --dir, and submit --run commands are removed."`
  - Published tarball `visonaut@0.5.4`, `dist/chunk-GQDTTYT4.js`: contains `Choose upload, submit, or status`, `Upload does not accept --run`, `operation: "upload"`, and `legacy uploads remain supported` (M8).
  - Tests: `packages/cli/test/cli.test.ts:7` `import { runInternalCli as runCli } from "../src/engine.js";`. There are 29 `["upload"` argument lists in six test files (20 in `cli.test.ts`). `cli.test.ts:143` is named `"public upload command"`. `declaration.test.ts` (799 lines) tests declaration, reuse, and upload only through `upload`.
- What happens: the engine keeps a second command set that only tests can reach. The tests for upload tickets, reuse proofs, and renewal run in a mode that the product does not have (no local comparison receipt).
- Impact: about 75 lines of dead engine code ship to npm. The larger cost is in the tests: they do not use the path that production uses for the same transport code, and a reader cannot tell which commands are public.
- Recommendation: make `runInternalCli` take a prepared directory in place of `argv` for the submit case, delete the `upload` and `--run` branches, and move the transport tests to the trusted mode (as `local-comparison.test.ts:13-15` already does with a mocked `workflow.js`).
- Alternatives:
  - Minimal: delete only the unreachable output branches and the `transfer-key` value, and rename the test groups.
  - Keep `upload` as a named internal test hook in a separate module that the bundle does not include.
- Maintainer decision needed: no.

### PKG-09 · `@visonaut/service` keeps queue publication code and legacy compare-task statements that production does not use

- Kind: dead-code
- Severity: low. Confidence: high. Measured: yes. Effort: M
- Evidence:
  - `reconcileWork` (`packages/service/src/work.ts:209-366`, 158 lines with its constants) has no caller in `apps/web/src` or `packages/*/src`. Callers: `packages/service/src/work.test.ts` (30 calls) and `apps/web/tooling/queue-recovery/worker.mjs:95`, a recorded probe from 2026-09-22.
  - `reportComparisonPublication` (`packages/service/src/comparison-publication.ts:9-30`) has one caller, with constant empty lists: `apps/web/src/operations/index.ts:45` `await reportComparisonRecovery(context, { published: [], failed: [] }, finalized);`.
  - No source file creates a `compare` task. `enqueueWorkStatement` has one production caller, for `review` tasks (`apps/web/src/operations/review-queue.ts:58`). Statements that still look for `compare` tasks:
    - `packages/service/src/run-admission.ts:125-139` (in each `reserveRun` batch),
    - `packages/service/src/run-retirement.ts:40-52` (in each `retireRun` batch),
    - `packages/service/src/run-status.ts:48-52` (in each `status()` call, see PKG-05).
  - `ComparisonTask` (`packages/service/src/service.ts:55-79`) is used only by `apps/compare` and by tests.
  - `Service.createPolicy` and `Service.createProject` (`service.ts:126-150`) are called only from test fixtures and tooling.
  - Exports with no importer outside tests and tooling: `enqueueWork`, `workLeaseAssertion`, `retainedRunStatement`, `retentionPinStatement`, `releaseRetentionPinStatement`, `completeRunDeletion`, and the types `ApprovalIdentity`, `PlanCapture`, `TrustedShard`, `VerifiedDiscovery`, `DecisionRow`, `PromotionRow` (scan M10).
  - `operationsMessage` accepts the old `continue` message shape (`work.ts:24-26`). Git shows that this line is from 2026-09-30. Queue retention can be 14 days (`work.ts:220`).
- What happens: the Queue publication protocol for tasks (publication token, receipt time, rejection codes) stays in the package after the comparison Queue producers were removed. Three hot statements still search for tasks that nobody creates.
- Impact: extra SQL in each reserve, retire, and status call, 158 lines with a large test group, and a reader who must work out that the code is not in use.
- Recommendation: remove `reconcileWork`, `reportComparisonPublication`, and the three `compare` statements together with the `publication_*` handling in `claimWork` and `failWork` (`work.ts:113-134`, `188-193`). Move `ComparisonTask` to `apps/compare`. Move `createPolicy` and `createProject` to a test helper.
- Alternatives:
  - Minimal: remove only the three `compare` statements, after a production query confirms zero `compare` tasks in the states `queued` and `leased`.
  - Move `reconcileWork` to `apps/web/tooling/queue-recovery`, because only that harness uses it.
  - Remove the `continue` shim after 2026-10-14, if no deployment published that shape after 2026-09-30.
- Maintainer decision needed: yes. Is the queue-recovery harness still a supported tool, or is it only a record of the 2026-09-22 probe?

### PKG-10 · The write path for runs without an inventory remains, and most test fixtures use it

- Kind: simplification
- Severity: medium. Confidence: medium. Measured: no. Effort: L
- Evidence:
  - The only production caller of `commitShard` always passes an inventory: `apps/web/src/api/workflow-materialize.ts:387-414` (`inventory = await writeCaptureInventory(context.images, facts);` and `inventory,`).
  - Branches for a run without `inventory_key`:
    - `packages/service/src/run-admission.ts:524-536` (`: input.captures`), `614-622`, `764-781` (ordinal ranking at seal),
    - `packages/service/src/local-comparison.ts:390-392` and `474-551` (the comparison path that is not sparse),
    - `packages/service/src/rendering-profile-conversion.ts:16-94` (called only at `local-comparison.ts:391`),
    - `packages/service/src/baseline-promotion.ts:174-182`, `194-198`, `295-321` (snapshot image copies),
    - `apps/web/src/api/workflow-materialize.ts:533-570` (recovery for an old sealed run).
  - Tests: `apps/web/src/operations/test-fixtures.ts:268-287` calls `commitShard` with no inventory and then `seedLegacyComparison`. `packages/service/src/service.test.ts` has 16 `commitShard(` calls, 4 lines with `inventory:`, and 15 uses of the legacy fixture helpers.
  - Contract: `docs/current-contract.md:26-28` says that new storage uses one inventory for each run, that the cutover uses a fresh database, and that old history is not migrated.
- What happens: each lifecycle function has two forms. New runs use only the inventory form. The shared fixtures build runs in the old form, so many tests of review, promotion, and operations do not run the form that production uses.
- Impact: about 270 lines of service code and one module exist for runs that the fresh database may not contain. The larger risk is test coverage: a regression in the inventory form can pass the suites that use the old fixtures.
- Recommendation: first move the shared fixtures (`test-fixtures.ts`, the service test fixture) to the inventory form. Then remove the old write branches. Keep the read support for old snapshots (`referenceCandidates`, `service.ts:183-188`) until no accepted baseline has `inventory_key IS NULL`.
- Alternatives:
  - Minimal: change only the fixtures, and keep both code forms.
  - Keep all code and add a production count of runs without an inventory, then decide with data.
- Maintainer decision needed: yes. Does production still have an active run or an accepted baseline without `inventory_key`? I cannot read live state.

### PKG-11 · The protocol README and about 230 lines of validators describe a flow that the server does not use

- Kind: dead-code
- Severity: low. Confidence: high. Measured: yes. Effort: M
- Evidence:
  - No importer outside `packages/protocol` for `validateCollection` (`validate.ts:483-524`), `parseTrustedPlan` (`526-621`), `validateShardDeclaration` (`632-706`), and `validateShardAgainstPlan` (`709-728`). That is about 230 of 750 lines. `packages/protocol/test/protocol.test.ts` refers to them 23 times.
  - No importer anywhere for `PROTOCOL_MAJOR` (`types.ts:2`) and for the types `PlannedShard`, `PlannedTest`, `UploadTicket`, `ReuseImagesRequest`, `ReuseImagesResponse`, `FinalizeRequest`, `StagedShardResponse`, `SubmitRunRequest`, `SubmitRunResponse`, `ProtocolErrorBody` (scan M10).
  - The CLI declares its own response types in place of the protocol types: `StagedShard` (`packages/cli/src/engine.ts:281-287`) and `SubmittedRun` (`engine.ts:317-322`).
  - `packages/protocol/README.md:7-12` shows `await validateShardAgainstPlan(manifest, trustedMainPlan);` as the server usage.
  - `packages/protocol/README.md:21-27` lists 5 endpoints. The CLI calls 11. The table omits `/v1/plan`, `/v1/runs/{run}/begin`, `/v1/runs/{id}/reference`, `/v1/runs/{id}/reference/images/{image}`, `/v1/runs/{id}/reuse`, and `/v1/runs/{run}/submit`.
  - The table says that finalize returns `RunStatus`. The CLI requires `state: "staged"` (`engine.ts:296-315`) and has a test named `"rejects a legacy run-status response instead of treating it as a staged shard"` (`packages/cli/test/cli.test.ts:288`).
  - `ReserveRunRequest.comparisonMode` is optional (`types.ts:259`). The server requires it (`apps/web/src/api/workflow-owned.ts:182`).
  - `RunState` contains `"uploading"` (`types.ts:323`). The server never returns it (`apps/web/src/api/ingest.ts:38-47` maps `reviewStatus` values, which have no `uploading`).
- What happens: the package documents the earlier trust model (a static plan from main with fixed tests and captures). The current server verifies workflow-owned discovery and never calls these validators.
- Impact: a new contributor reads the README and looks for code paths that do not exist. The HTTP types give no protection, because neither side imports them.
- Recommendation: delete the four validators and their tests if no stored data needs them, update the README table to the 11 endpoints, and make the CLI and the server import the response types.
- Alternatives:
  - Minimal: correct only the README (endpoint table, finalize response, usage example).
  - Keep the plan validators and move their description to the history documents with a note.
- Maintainer decision needed: yes. Do you want to keep the static trusted plan as an available design, or is workflow-owned discovery the only model?

### PKG-12 · Paths, schema versions, and error shapes of the wire contract have more than one source

- Kind: inconsistency
- Severity: low. Confidence: high. Measured: yes. Effort: M
- Evidence:
  - Schema version, two encodings: `packages/cli/src/bundle-submit.ts:47` `schemaVersion: 1,` and the server check `apps/web/src/api/pre-run.ts:55` `body.schemaVersion !== 1`. All other requests use the string `"1.0"`.
  - Literal `"1.0"` in place of `SCHEMA_VERSION`: `bundle-submit.ts:67`, `packages/playwright/src/reporter.ts:238`, `packages/protocol/src/hash.ts:110` and `138`, `apps/web/src/api/local-comparison.ts:439`.
  - Two version checks with different rules: `packages/protocol/src/validate.ts:149` `/^1\.(0|[1-9][0-9]*)$/` and `packages/cli/src/errors.ts:29` `/^1\.\d+$/u`. Probe M6: `"1.00"` and `"1.01"` are rejected by the protocol and accepted by the CLI.
  - `TRANSPORT` has 8 paths. `TRANSPORT.reference` and `TRANSPORT.submit` have no user. The CLI builds 5 paths by hand: `bundle-submit.ts:41`, `bundle-submit.ts:63`, `engine.ts:373`, `local-comparison.ts:143`, `local-comparison.ts:174`. `TRANSPORT.reference` does not encode its argument (`types.ts:348`); the other entries do (probe M6: `TRANSPORT.reference("a/b c") = /v1/runs/a/b c/reference`). The server uses its own regular expressions (`apps/web/src/api/index.ts:140-186`).
  - Upload ticket format: the CLI accepts `[A-Za-z0-9._~-]+` up to 4,096 characters (`engine.ts:186-187`). The server route accepts `[A-Za-z0-9_.-]{1,8192}` (`apps/web/src/api/index.ts:174`).
  - Shard key format, three rules: the CLI flag `/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/` (`workflow.ts:36`), `validateKey` `/^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/` up to 256 (`validate.ts:131-139`), and `encodeURIComponent(shardKey)` in the receipt name (`hash.ts:124`).
  - Error codes: `ProtocolError` codes are upper case (`validate.ts:32`, `151`). The API sends `invalid_manifest` for each of them (`apps/web/src/api/index.ts:46-53`), so the documented `UNSUPPORTED_SCHEMA` never reaches a client (`packages/protocol/README.md:5`). `ConflictError.code = "CONFLICT"` and `IncompleteError.code = "INCOMPLETE"` (`packages/service/src/database.ts:21`, `32`) have no production reader.
  - `IncompleteError` has 49 throw sites with three meanings: a missing record (`service.ts:95`), invalid input (`service.ts:131`), and incomplete evidence. The API maps all of them to HTTP 409 (`apps/web/src/api/index.ts:55-66`). A status request for an unknown run ID therefore returns 409.
  - The 404 answer for an unknown endpoint has no `schemaVersion` (`apps/web/src/api/index.ts:216-218`). All other error answers have it.
  - The headroom value of 45 seconds is a constant in `engine.ts:30` and a literal in `local-comparison.ts:220` and `229`.
- What happens: the protocol package is the stated contract, but the client and the server each keep private copies of paths, formats, and version rules.
- Impact: no failure today. Each copy is a place where the next protocol change can be applied to one side only. The 409 for a missing run and the single `invalid_manifest` code make client-side handling less exact.
- Recommendation: put all 11 paths in `TRANSPORT` with one encoding rule and use them on both sides. Export one `isSupportedSchemaVersion`. Export the ticket and shard-key patterns. Add a `NotFoundError` in the service package.
  ```ts
  export const TRANSPORT = {
    plan: "/v1/plan",
    begin: (workflowRunId: string) => `/v1/runs/${encodeURIComponent(workflowRunId)}/begin`,
    reference: (runId: string) => `/v1/runs/${encodeURIComponent(runId)}/reference`,
    referenceImage: (runId: string, imageId: string) =>
      `/v1/runs/${encodeURIComponent(runId)}/reference/images/${encodeURIComponent(imageId)}`,
    // ...
  } as const;
  ```
- Alternatives:
  - Minimal: delete the two unused `TRANSPORT` entries, or use them, and replace the literal `"1.0"` values with `SCHEMA_VERSION`.
  - Generate the server route matchers from the same table.
  - Leave `/v1/plan` with `schemaVersion: 1`. A change there also changes the signed plan digest (`apps/web/src/api/pre-run.ts:72`), so it needs a coordinated release.
- Maintainer decision needed: no.

### PKG-13 · The published `visonaut` bundle contains pngjs and pixelmatch without their license notices

- Kind: bug
- Severity: medium. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - `packages/cli/tsup.config.ts:14`: `noExternal: ["@visonaut/protocol", "@visonaut/compare", "pixelmatch", "pngjs"]`.
  - `packages/cli/package.json:14-18`: `"files": ["dist", "README.md", "LICENSE"]`. `packages/cli/LICENSE:3`: `Copyright (c) Ariakit`.
  - Licenses: `pngjs` is MIT and `pixelmatch` is ISC (their `package.json` files). Their source files contain no license comment, so the bundler cannot keep one.
  - Published tarball `visonaut@0.5.4` (M8): `dist/chunk-GQDTTYT4.js` is 202,387 bytes. `rg -c -i "copyright|permission (is hereby|to use)|ISC License|MIT License"` on that file prints no match.
  - The CI package check allows only `package.json`, `README.md`, `LICENSE`, and `dist/*.js` or `dist/*.d.ts` (`.github/workflows/scripts/packages.mjs:35-37`). A notice file would fail it.
- What happens: the package redistributes the code of two libraries. Both licenses require the copyright notice and the permission notice in all copies.
- Impact: a license compliance gap in a public package. The repository already keeps such notices for the copied UI components (`README.md:79`).
- Recommendation: add `THIRD_PARTY_NOTICES.md` with both license texts to `packages/cli`, add it to `files`, and extend the regular expression in `packages.mjs`.
- Alternatives:
  - Minimal: append the two license texts to `packages/cli/LICENSE`. This needs no change in `files` or in the CI check.
  - Make `pngjs` and `pixelmatch` runtime dependencies in place of bundled code. The comparison identity then depends on the consumer's install, which the exact pin in the bundle prevents today.
  - Add a tsup banner with the two notices to the chunk.
- Maintainer decision needed: yes. Which form do you prefer: one notices file, or the texts in `LICENSE`?

### PKG-14 · Three READMEs state old versions or old behavior

- Kind: copy
- Severity: low. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - `packages/cli/README.md:3`: ``This guide describes CLI `visonaut@0.5.3`.`` `packages/cli/package.json:3`: `"version": "0.5.4"`. The published 0.5.4 tarball contains the 0.5.3 sentence (M8).
  - `README.md:35`: ``The current package pair is `visonaut@0.5.3` and `@visonaut/playwright@0.4.0`.`` `docs/current-contract.md:22` says 0.5.4 and 0.5.0, and `packages/playwright/package.json:3` is `0.5.0`.
  - `packages/cli/README.md:25`: `"WebP is supported by the legacy upload protocol, but local Submit fails clearly for WebP"`. A WebP capture fails earlier, in the archive reader, with `"The capture archive is malformed or exceeds its extraction limits."` (`packages/cli/src/artifact-archive.ts:104` and `23-25`). The server rejects the legacy upload mode (`apps/web/src/api/workflow-owned.ts:182-185`).
  - `packages/cli/src/local-comparison.ts:257`: `"The accepted reference is WebP. Local comparison requires a PNG reference; legacy uploads remain supported."`
  - `packages/cli/src/engine.ts:44`: `Status requires VISONAUT_TOKEN, a maintainer session token.` No document says how to get this token (`rg VISONAUT_TOKEN` finds only the CLI source, its README, and its tests).
  - The protocol README items are in PKG-11.
- What happens: version sentences are written by hand, and the Changesets release does not update them. Two user-visible sentences still mention the removed upload mode.
- Impact: the npm page for 0.5.4 describes 0.5.3. A user cannot use the `status` command from the documentation alone.
- Recommendation: remove the version number from the README text (npm shows the version), or generate it in `version-packages`. Delete the two "legacy upload" sentences. Add two lines that explain how to get a session token, or state that `status` is for internal use.
- Alternatives:
  - Minimal: correct the three version sentences.
  - Add a release-guard test that compares the README sentence with `package.json` (the repository already has `test:release-guards`).
- Maintainer decision needed: yes. Is `visonaut status` a supported command for users? If not, it belongs with the items in PKG-08.

### PKG-15 · Argument errors and progress output of the CLI are hard to use

- Kind: ux
- Severity: low. Confidence: high. Measured: yes. Effort: M
- Evidence, probe M1 (raw output, shortened to one line for each case):
  ```text
  $ visonaut submit --help
    exit=2  stderr="visonaut: Each required shard must be a unique stable key.\n"
  $ visonaut submit --dir visonaut   # removed flag
    exit=2  stderr="visonaut: Each required shard must be a unique stable key.\n"
  $ visonaut submit --json --shard linux
    exit=2  stderr="{\"error\":\"Each required shard must be a unique stable key.\",\"exitCode\":2}\n"
  $ visonaut --version
    exit=2  stderr="visonaut: Choose begin, submit, or status. Use --help for usage.\n"
  $ visonaut -h
    exit=2  stderr="visonaut: Choose begin, submit, or status. Use --help for usage.\n"
  $ visonaut status --help
    exit=2  stderr="visonaut: Unknown option. Use --help for usage.\n"
  ```
  - Cause: `packages/cli/src/workflow.ts:34-40` uses one message for an unknown flag, a missing value, a wrong key format, and a repeated key.
  - `--run` has two meanings: a GitHub run ID for `begin` and a service run ID for `status` (`engine.ts:36`, `39`).
  - `begin --run` must equal `GITHUB_RUN_ID` and adds no information (`engine.ts:726-728`).
  - The CLI prints no comparison result. After `compareLocally` it knows each outcome (`local-comparison.ts:327-334`), but the only lines are upload counts and `"Shard combined staged and run <id> submitted."` (`engine.ts:653-658`, `891-895`). It does not print the review URL.
  - Steps 2 to 9 of the Submit sequence print nothing (`bundle-submit.ts:75-106` and `local-comparison.ts` have no output calls).
  - Configuration is checked late. `beginSubmission` runs at `bundle-submit.ts:89`. `GITHUB_REPOSITORY`, `VISONAUT_CAPTURE_JOB_NAME`, and `GH_TOKEN` are read after that (`github-artifacts.ts:69-72`, `88`), `VISONAUT_SUBMIT_JOB_NAME` after all downloads (`signed-context.ts:72`), and `GITHUB_OUTPUT` last (`signed-context.ts:96-98`). The helper `required` exists two times (`bundle-submit.ts:9`, `github-artifacts.ts:16`).
- What happens: a wrong flag gives a message about shard keys. A job that runs for minutes is silent until the upload starts, and it ends without a result summary.
- Impact: slower diagnosis in CI. A missing variable starts the App check and then fails the job. For two of the variables that happens after all artifacts are downloaded.
- Recommendation:
  ```text
  visonaut: Unknown option --dir for submit. Use: visonaut submit --shard <key> [--shard <key> ...]
  Downloaded 2 capture artifacts (3,582 captures).
  Compared 3,582 captures: 3,570 unchanged, 9 changed, 2 new, 1 removed.
  Review: https://visonaut.com/runs/640a5418-5c12-401e-9dfe-47a76c4387da
  ```
  Read and validate all environment variables in one function before the first request.
- Alternatives:
  - Minimal: separate the "unknown option" message from the shard-key message, and print the review URL.
  - Write the summary to `GITHUB_STEP_SUMMARY` in place of the log.
  - Add `--version` and accept `--help` after a command.
- Maintainer decision needed: no.

### PKG-16 · GitHub API calls in the CLI have no retry, three time-out rules, and two pagination loops

- Kind: inconsistency
- Severity: low. Confidence: high. Measured: no. Effort: M
- Evidence:
  - `packages/cli/src/github-artifacts.ts:85-103`: one `fetch` with `AbortSignal.timeout(30_000)`. A response that is not OK throws `"GitHub capture evidence is unavailable (HTTP ...)"`.
  - `packages/cli/src/signed-context.ts:35-45`: `fetch` with no `signal`.
  - `packages/cli/src/artifact-archive.ts:190` and `197`: 30 seconds for the API request and `AbortSignal.timeout(120_000)` for the signed URL. This signal also covers the body stream, and the size limit is 1 GiB (`artifact-archive.ts:7`). A time-out is not a `CliError`, so the user gets `"The verified capture submission failed."` (`index.ts:38`).
  - `artifact-archive.ts:200-205`: a response that is not OK (for example 403 or 410) calls `invalid()`: `"The capture archive is malformed or exceeds its extraction limits."` with exit 4.
  - Pagination: `github-artifacts.ts:104-134` checks `total_count` on each page. `signed-context.ts:34-65` stops at the first page with fewer than 100 jobs and has no count check.
  - For a carried shard, the jobs of each earlier attempt are listed again for each shard (`github-artifacts.ts:181-185` is inside the `for (const shard of shards)` loop at line 162). With S carried shards and attempt A that is S x (A - 1) list calls in place of A - 1.
- What happens: nine or more GitHub requests in a Submit run one time each. A secondary rate limit or a 5xx answer fails the job. The messages for HTTP failures on the artifact download describe a malformed archive.
- Impact: not measured. Each failed GitHub request needs a manual rerun.
- Recommendation: one `githubRead(path)` helper with a 30-second time-out, two retries for 5xx and 429 with `Retry-After`, and one paginated `list` function. Keep the job list of each earlier attempt in a `Map`. Give HTTP failures on the download their own message.
- Alternatives:
  - Minimal: add `signal: AbortSignal.timeout(30_000)` at `signed-context.ts:43` and a separate message for HTTP failures at `artifact-archive.ts:200`.
  - Scale the body time-out with `artifact.size_in_bytes`, which the CLI already has (`github-artifacts.ts:223`).
- Maintainer decision needed: no.

### PKG-17 · Reference downloads are sequential, and three server write loops use small pages

- Kind: performance
- Severity: low. Confidence: medium. Measured: no. Effort: M
- Evidence:
  - `packages/cli/src/local-comparison.ts:219` and `275-281`: one `await request(...)` for each changed capture inside the `for` loop. Uploads use 5 parallel requests (`engine.ts:33`) and reuse pages use 4 (`engine.ts:32`).
  - A renewal reads all reference pages again: `engine.ts:416-429` calls `reserve` and then `readReference`. For 3,582 references that is 1 OIDC + 1 reserve + 18 page requests. The capability lives 600 seconds (`apps/web/src/api/workflow-owned.ts:390`).
  - `packages/service/src/run-admission.ts:542-564`: one batch for each 100 captures that only asserts image rows. For 3,582 captures that is 36 round trips in each `commitShard`, also when no capture changed.
  - `run-admission.ts:359-368`: `registerImages` accepts 50 images and reads the run again for each batch.
  - `packages/service/src/local-comparison.ts:90`: 100 rows for each page of comparison rows.
- What happens: a pull request that changes many captures (a font or a global style) downloads each reference one after the other. The server side of an unchanged Submit spends 36 round trips on assertions.
- Impact: counts only. For 3,582 changed captures that is 3,582 sequential downloads. The time for each download is not measured.
- Recommendation: run the download, decode, and compare step for 4 captures in parallel. One decoded pair with its mask is at most 2.1 million pixels x 4 bytes x 3 buffers, about 25 MB. Raise the assertion page in `commitShard` to 1,000 entries. That changes 36 round trips to 4. Check the page size against the D1 limit for a bound value (2 MB by the comment at `run-admission.ts:79`).
- Alternatives:
  - Minimal: raise only the assertion page size.
  - Let `renewReservation` skip the page reads when the server confirms the same inventory digest.
- Maintainer decision needed: no.

### PKG-18 · Conventions differ between the packages, and the protocol tests are not type-checked

- Kind: inconsistency
- Severity: low. Confidence: high. Measured: yes. Effort: M
- Evidence:
  - `packages/protocol/tsconfig.json:12`: `"include": ["src"]`. The tests are in `packages/protocol/test`. Probe M11: `tsc6 --noEmit` in the package exits 0. With a scratch configuration that includes `test`:
    ```text
    test/protocol.test.ts:247:5 - error TS2532: Object is possibly 'undefined'.
    247     first(plan.shards).tests.push({
    ```
  - Five tsconfig forms: `cli` and `protocol` stand alone with `NodeNext`; `playwright` and `service` extend the root (`Bundler`); `compare` and `security` stand alone with `Bundler`. Targets are ES2022, ES2023, and ES2024.
  - Import suffix: `.js` in `protocol`, `cli`, `playwright`, `security`; `.ts` in `service` and `compare` (`packages/service/src/index.ts:1-11`).
  - Test location: `packages/service/src/service.test.ts` (3,870 lines) and `work.test.ts` are in `src/`. The other packages use `test/`.
  - `packages/service/package.json` declares no `devDependencies`, but its scripts run `vitest` and `tsc6`, and its tsconfig needs `@types/node`. `packages/cli/test/local-comparison.test.ts:575` resolves `@playwright/test`, which `packages/cli/package.json` does not declare.
  - Repeated helpers:
    - The SHA-256 hex encoder exists 8 times: `packages/protocol/src/hash.ts:48`, `packages/compare/src/binary.ts:37`, `packages/service/src/run-admission.ts:37`, `packages/service/src/history.ts:22`, `apps/web/src/api/workflow-materialize.ts:99`, `packages/security/src/github.ts:125`, `capabilities.ts:222`, `webhooks.ts:78`.
    - `readOne` and `readRows` are declared 7 times in 5 service modules, next to `Service.one` and `Service.rows` (`service.ts:92-102`).
    - The identity key `JSON.stringify([itemKey, variantKey])` is written 4 times in the service package (`run-admission.ts:43`, `local-comparison.ts:116`, `170`, `219`). The protocol has `identityKey` (`hash.ts:61-63`).
  - Six type names have two different definitions: `CaptureIdentity`, `TrustedPlan`, `TestOutcome` (protocol and service), `ValidatedImage`, `ComparisonResult` (service and compare), `ComparisonPolicy` (protocol and compare).
  - Engines: `packages/playwright/package.json:57-59` `"node": "24.18.0"`; `packages/cli/package.json:46-48` `"node": ">=24.18.0 <25"`.
  - `packages/service/src/work.ts:30`: an `import` statement after 28 lines of code.
  - Service functions take `now` as input, but two places read the clock: `rendering-profile-conversion.ts:90` and `local-comparison.ts:677`.
- What happens: each package was set up at a different time. One result is a real gap: a type error in the protocol tests that the package check does not see.
- Impact: small costs for each change, and one check that reports success for code that does not type-check.
- Recommendation: one `tsconfig.base.json` for all packages with `include: ["src", "test"]`. Import `sha256` and `identityKey` from the protocol in the service package. One `read.ts` module in the service package. Rename the service types that collide (for example `ServicePlan`, `ShardTestOutcome`, `StoredImage`).
- Alternatives:
  - Minimal: add `"test"` to `packages/protocol/tsconfig.json` and correct line 247.
  - Add only the missing `devDependencies`.
- Maintainer decision needed: no.

### PKG-19 · The adapter waits a fixed 100 ms and decodes two PNGs for each capture, and the reporter loads modules that it does not use

- Kind: performance
- Severity: low. Confidence: medium. Measured: yes. Effort: S
- Evidence:
  - `packages/playwright/src/visual.ts:382`: `await beforeDeadline(new Promise<void>((resolve) => setTimeout(resolve, 100)), deadline);`. The loop needs two screenshots at minimum, so each `visual()` call sleeps 100 ms or more. This is from the code, not from a browser run.
  - `visual.ts:359`: `PNG.sync.read(bytes, { checkCRC: true })` for each screenshot, then `previous.pixels.data.equals(current.pixels.data)` (`visual.ts:374`).
  - Probe M2: decode two images and compare the pixels: 30.4 ms (1280x720) and 46.7 ms (1248x1650). Compare the encoded bytes: 0.05 ms and 0.07 ms. Real 640x360 screenshots decode in 2.2 to 3.4 ms each (M4).
  - Published `@visonaut/playwright@0.5.0`, `dist/reporter.js:484-485`: `import { test } from "@playwright/test";` and `import { PNG } from "pngjs";`. The reporter source uses only two constants from `visual.ts` (`packages/playwright/src/reporter.ts:20`).
  - `packages/playwright/src/environment.ts:49`: `files.sort((left, right) => left.file.localeCompare(right.file, "en"))`. The sorted list is hashed into `fontsDigest` (`environment.ts:87`). `canonicalJson` uses code-unit order (`packages/protocol/src/hash.ts:36`). Probe M12 shows that the two orders differ for common file names, with ICU 78.3.
  - Not a cost: `measureEnvironment` on the macOS default roots read 371 font files in 1.9 seconds cold and 0.46 seconds warm (M12).
- What happens: the stability wait is the same for a static button and for a page with late layout. The pixel comparison needs a decode only when the encoded bytes differ. The font order depends on the ICU data in the Node build.
- Impact: 100 ms x the number of `visual()` calls is summed worker time in the capture jobs (358 seconds for 3,582 calls if none uses `visualBatch`; I do not know the split between `visual` and `visualBatch` in Ariakit). The decode cost is small next to a browser screenshot. A change of the ICU data in a later Node version can change `fontsDigest` with no font change.
- Recommendation: compare the encoded buffers first. Make the wait an option with the current value as the default. Move the two content-type constants to their own module. Sort the font list with a code-unit comparison (this changes each `fontsDigest` one time).
  ```ts
  // Equal encoded bytes mean equal pixels. Different bytes still need the pixel comparison.
  if (previous && previous.bytes.equals(current.bytes)) return current;
  ```
- Alternatives:
  - Minimal: move only the constants, which removes two imports from the reporter bundle.
  - Keep the 100 ms wait and document it as the settle time.
- Maintainer decision needed: yes. A change of the font sort changes the rendering profile digests one time. Is that acceptable, or must the order stay as it is?

## Measurements (command, raw result, limits)

All probe files are in `/Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/packages/probe/`. Each ran with this command from the repository root, with the probe name as the last argument:

```sh
pnpm exec vitest run --root /Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/packages/probe \
  --config /Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/packages/probe/vitest.config.mjs <name>
```

Machine: macOS (Darwin 25.6.0), arm64, Node 24.18.0. CI runners are slower. No number here is a CI time or a production time.

| ID  | Probe and output file                                                                                                                                                          | Result                                                                                                                                                                                                                                                                                                                                           | Limits                                                                                                                                                                                   |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1  | `cli-ux.probe.ts` -> `cli-ux.out.txt`                                                                                                                                          | 23 argument cases and 3 stubbed network cases through the public `runCli`. Quoted in PKG-02 and PKG-15. `begin` with a 503 stub: 2 fetch calls, exit 4.                                                                                                                                                                                          | `fetch` is a stub. No real service.                                                                                                                                                      |
| M2  | `submit-cost.probe.ts` -> `submit-cost.out.txt`                                                                                                                                | 200 images for each size. `validateImages` 0.59 and 0.44 ms for each image. `validateLocalImages` 46.99 and 58.17 ms. `compareLocally` with all captures identical: 46.30 and 54.87 ms, 90% and 100% of it before the equality check. Stable pair: 30.43 and 46.71 ms decoded, 0.054 and 0.071 ms on encoded bytes.                              | Synthetic images with noise (649 and 704 KiB). Real captures are smaller for the same size (the largest hosted fixture is 368 KiB), so these values are an upper range. Warm file cache. |
| M3  | `limits.probe.ts` -> `limits.out.txt`                                                                                                                                          | 1280x1700, 3.05 MiB, and 200x9000 images pass `parseManifest` and `validateImages`. They fail `validateLocalImages` with one general message.                                                                                                                                                                                                    | Uses the CLI functions directly, not a full Submit.                                                                                                                                      |
| M4  | `decode-real.probe.ts` -> `decode-real.out.txt`                                                                                                                                | `chromium.png` 3.88 ms (`validateImage` 1.33 + `PNG.sync.read` 2.18), `firefox.png` 4.87 ms, `webkit.png` 5.10 ms. SHA-256 only: 0.011 to 0.013 ms.                                                                                                                                                                                              | Three real screenshots, all 640x360. 200 rounds each.                                                                                                                                    |
| M5  | `status-queries.probe.ts` -> `status-queries.out.txt`                                                                                                                          | `Service.status()`: 5 round trips, 6 with a promotion pointer. `Service.review()`: 3 (1 single, a batch of 5, a batch of 14).                                                                                                                                                                                                                    | SQLite in memory through the repository fixture `apps/web/src/operations/test-fixtures.ts`. Counts are exact. Times are not D1 times.                                                    |
| M6  | `protocol.probe.ts` -> `protocol.out.txt`                                                                                                                                      | Version strings `1.00` and `1.01`: the protocol rejects them, the CLI accepts them. Receipt with `pngjs-7.0.1` or `playwright-pixelmatch-1.64.0`: rejected. `TRANSPORT.reference("a/b c")` is not encoded.                                                                                                                                       | None.                                                                                                                                                                                    |
| M7  | `review-status.probe.ts` -> `review-status.out.txt`                                                                                                                            | Inactive failed run -> `superseded`. Active failed run -> `failed`.                                                                                                                                                                                                                                                                              | Pure function. The History label is read from the code, not from a browser.                                                                                                              |
| M8  | `npm pack visonaut@0.5.4 @visonaut/playwright@0.5.0 --pack-destination <scratch>/npm`, then `tar -xzf` and `rg`                                                                | CLI: `dist/chunk-GQDTTYT4.js` 202,387 bytes, imports only Node built-ins, 0 license strings, 4 dead strings, README sentence says 0.5.3. Adapter: `index.js` 21,499 bytes, `reporter.js` 32,574 bytes with imports of `@playwright/test` and `pngjs`, `environment.js` 4,180 bytes. Type files import only `@playwright/test` and a local chunk. | Registry state on 2026-10-05.                                                                                                                                                            |
| M9  | `rg -U --count-matches 'SecurityError\(\s*"[a-z_]+",\s*503'` on `apps/web/src/api/{workflow-owned,pre-run,pre-run-attempts,pre-run-checks,pre-run-plan,pre-run-candidates}.ts` | 3 + 2 + 27 + 8 + 1 + 14 = 55 sites, 10 codes.                                                                                                                                                                                                                                                                                                    | Counts throw sites, not how often they run.                                                                                                                                              |
| M10 | `node <scratch>/unused-exports.mjs`                                                                                                                                            | Lists each exported name with its importers by group. Used for PKG-09 and PKG-11.                                                                                                                                                                                                                                                                | Text search by name. I checked each function that I report with `rg`. Types that are used only in their own file are listed as unused exports.                                           |
| M11 | `pnpm exec tsc6 --noEmit` in `packages/protocol`, then with `-p <scratch>/probe/tsconfig.protocol-tests.json`                                                                  | Exit 0 as configured. 1 error (`TS2532` at `test/protocol.test.ts:247`) with tests included.                                                                                                                                                                                                                                                     | The scratch configuration extends the package configuration and adds `test`.                                                                                                             |
| M12 | `environment.probe.ts` -> `environment.out.txt`                                                                                                                                | 371 font files in 2 roots: 1,892 ms cold, 458 ms warm. `localeCompare("en")` order differs from code-unit order for 7 sample names. ICU 78.3, CLDR 48.0.                                                                                                                                                                                         | This machine's fonts, not a CI image.                                                                                                                                                    |
| M13 | `manifest-cost.probe.ts` -> `manifest-cost.out.txt`                                                                                                                            | 3,582 captures, 3.34 MiB JSON: `JSON.parse` 4.6 ms, `parseManifest` 13.1 ms, `canonicalJson` 19.5 ms, `digestJson` 21.2 ms, `uploadImages` 1.5 ms. 10,000 captures, 9.21 MiB: 11.5, 31.0, 49.7, 57.1, 3.9 ms.                                                                                                                                    | Synthetic keys. Medians of 15 runs. This result shows that protocol validation is not a bottleneck at the documented scale.                                                              |

## Open questions and items not verified

- Production data: I cannot read D1. Not verified: whether a `compare` task in state `queued` or `leased` still exists (PKG-09), and whether an active run or an accepted baseline has no `inventory_key` (PKG-10).
- Frequency: I have no CI history. I do not know how often a 503, a network error, or a GitHub 5xx fails a Submit or Plan job (PKG-01, PKG-16).
- CI time: no probe ran on a GitHub runner. All times are from one arm64 Mac. I do not know the real size distribution of Ariakit captures. I used the documented count (3,582) and the documented largest fixture (1248x1650).
- Shard content: I assume that the `linux` shard holds the Chromium and Firefox captures (2,460 by the evidence file). Then the archive limit of 5,000 entries leaves a factor of 2.03. I did not read the Ariakit workflow.
- Server shard limit: I did not check which bytes count for `maximumShardBytes` (512 MiB), all captures or only the uploaded ones. The combined manifest is one shard named `combined` (`packages/cli/src/bundles.ts:113`).
- Build output: I did not run a build. Statements about bundle content use the published `visonaut@0.5.4` and `@visonaut/playwright@0.5.0` tarballs, which have the same versions as the working tree. A build from the current tree can differ.
- Browser behavior: no probe ran the adapter in a browser. The 100 ms wait and the two-screenshot minimum are from the code.
- History label (PKG-07): not captured in the running app. The preview fixtures may not contain an expired run.
- Token for `status`: I did not test how a user gets a bearer session token. The server enables the better-auth `bearer` plugin (`packages/security/src/auth.ts:53`).
- One observation outside this lane, not analyzed further: `decodeURIComponent(shardMatch[2])` at `apps/web/src/api/index.ts:170` throws `URIError` for a malformed escape. The handler then answers 503 `service_unavailable` with `Retry-After`.
- `packages/compare` and `packages/security` are not in this lane. I read only the parts that the CLI and the service package call.
- Report file: the Write tool refused the name `report.md` in this subagent session. I wrote the same text to `lane-packages-body.txt` and copied it to `report.md` with a shell command.
