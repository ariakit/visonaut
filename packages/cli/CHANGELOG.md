# visonaut

## 0.6.7

### Comparison with pixelmatch 8

Submit now compares captures with pixelmatch 8, which measures color differences in the OKLab color space. Before, Submit used the YIQ metric of the pixelmatch that Playwright `1.63.0` bundles. pixelmatch 8 also blends semi-transparent pixels with a checkerboard pattern and not with white, so a change of transparency alone can count as a changed pixel. The comparison settings keep their meaning and their scale, but for the same images Submit can count other changed pixels than Playwright's `toHaveScreenshot`. If a capture depends on a tuned `threshold` or has transparent areas, examine its outcome after the upgrade.

Submit no longer sends the names of its comparison engine and image codec, and it sends the CLI version in their place. The review shows this version. An approval does not depend on the engine, so an approval of a change copies to a run of this release when the images are the same.

### Other updates

- Retried the GitHub Actions OIDC token request after a temporary failure. Submit now repeats the request after an HTTP 500, 502, 503, or 504 answer, a network error, or a timeout, with the same backoff as the reference reads and the `Retry-After` header of GitHub. After the last attempt, a 5xx answer says that GitHub Actions could not issue the token and that a rerun of the job can work, and no longer names the `id-token: write` permission. An HTTP 401 or 403 answer is not repeated, and its message stays.

## 0.6.6

- Changed the text of a job that waits at the capacity limit of the service. It now tells the reader to check the Status page, which is the new name of the page "Service attention".
- Fixed Submit to retry a reference read that hangs. Before, one connection that stopped answering used the whole 30 s limit of the read and ended Submit with a timeout. Now each attempt of a reference read has a limit of 10 s, and an attempt that reaches it is retried like a network error. The read has up to 5 attempts in a deadline of 60 s, and the `Reference reads` line of the log counts the retry wait. Other requests keep their rules.

## 0.6.5

### Faster image checks and comparisons in Submit

In a local benchmark of 4,000 captures of 1000x700 pixels that differ from their reference by bytes, Submit with 3 image workers (the count on a GitHub runner with 4 cores) did the bundle checks 3.1× faster (25.7 s in place of 79.6 s) and the comparison 2.8× faster (60.8 s in place of 169.9 s). Submit now decodes and compares the images on worker threads. The count of workers is one less than the available parallelism of the computer, at least 1 and at most 4. Each worker holds at most one decoded image pair and one mask, and the results keep the order of the captures.

The comparison line of the log now shows the count of image workers:

```text
Visonaut compared <count> captures in <time> with <count> image workers: <time> waiting for reference images, <time> decoding and comparing, <time> reading reference pages, <time> staging pages.
```

## 0.6.4

- Fixed Submit to retry a reference read after a transient HTTP 502, 504, or 503 without an error code, or after a network error. Before, one such error ended the whole Submit. The new `Reference reads` line of the log shows the retry wait.

## 0.6.3

### Patch Changes

- 623c226: Gave a refusal of the GitHub OIDC token request its own message

  When GitHub Actions refuses the OIDC token request, the CLI now says so and tells you to check the `id-token: write` permission of the job. Before, the CLI printed the words of a service refusal and could print an error code and a reference that came from GitHub.

- 3008444: Faster comparison of changed captures in Submit

  Submit compared 4,000 small captures 7.5× faster in a local benchmark, where half of the captures differ from their reference by bytes and each reference download has a simulated delay of 100 ms. Submit now keeps up to 32 reference downloads in flight while it compares the captures in order, in place of groups of 8 that waited for each other. The encoded references in memory stay at most 16 MiB.

  Submit also prints the time of each phase, so that the job log shows where the time goes:

  ```text
  Visonaut prepared <count> captures in <time>: <time> for the capture artifacts, <time> for the bundle checks, <time> for the capture records, <time> for the session.
  Visonaut compared <count> captures in <time>: <time> waiting for reference images, <time> decoding and comparing, <time> reading reference pages, <time> staging pages.
  ```

## 0.6.2

### Patch Changes

- 75616ac: Sped up Submit by 7.2× in a local benchmark with 128 small captures and a simulated 100 ms delay per reference download. Reference downloads now run in bounded parallel groups, and Submit reports comparison progress.

## 0.6.1

### Patch Changes

- a066381: Relaxed the Node.js engine requirement to accept Node.js 24.18.0 and later.

## 0.6.0

### Minor Changes

- 2af702e: The CLI and the adapter upgrade together

  **BREAKING** if you install `visonaut` and `@visonaut/playwright` at different releases, or if your workflow sets `VISONAUT_PACKAGE_SHA256` or `VISONAUT_WORKFLOW_SOURCE_SHA`.

  The CLI reads neither `VISONAUT_PACKAGE_SHA256` nor `VISONAUT_WORKFLOW_SOURCE_SHA`. A value that is set changes nothing and is no error. Submit sends one fixed digest, the SHA-256 of the empty text, in `run.planDigest` and in `discovery.executorDigest`. The service compares neither field with a setting, so a workflow edit needs no cutover in this repository.

  The new CLI refuses a capture bundle of `@visonaut/playwright@0.5.0` with exit code `4`:

  ```
  visonaut: A capture bundle does not have the digest that this CLI expects. Use the same release of visonaut and @visonaut/playwright.
  ```

  `visonaut@0.5.4` refuses a bundle of the new adapter while `VISONAUT_PACKAGE_SHA256` holds another digest. Upgrade both packages in one pull request, and then remove the two variables from your workflow.

  These CLI messages are gone:

  - `VISONAUT_PACKAGE_SHA256 is required for signed submission.` (exit code `2`)
  - `VISONAUT_WORKFLOW_SOURCE_SHA is required for signed submission.` (exit code `2`)
  - `The pinned package or workflow digest is invalid.` (exit code `4`)

  This message changed (exit code `4`):

  - Before: `Submit did not use this commit's pinned visual workflow.`
  - After: `Submit did not use this commit's visual workflow.`

  `A capture bundle has the wrong shard or package identity.` (exit code `4`) is now three messages:

  - `A capture bundle has the wrong shard.`
  - `A capture bundle has no discovery record. Set the discovery option of the reporter.`
  - The digest message above.

  Before:

  ```yaml
  env:
    VISONAUT_PACKAGE_SHA256: ${{ vars.VISONAUT_PACKAGE_SHA256 }}
    VISONAUT_WORKFLOW_SOURCE_SHA: ${{ vars.VISONAUT_WORKFLOW_SOURCE_SHA }}
    VISONAUT_CAPTURE_JOB_NAME: "App / Visual Capture ({shard})"
    VISONAUT_SUBMIT_JOB_NAME: "App / Visual Submit"
  ```

  After:

  ```yaml
  env:
    VISONAUT_CAPTURE_JOB_NAME: "App / Visual Capture ({shard})"
    VISONAUT_SUBMIT_JOB_NAME: "App / Visual Submit"
  ```

- 2af702e: Submit sends capture pages

  **BREAKING** if you run `visonaut submit --shard` against a service that does not accept capture pages. This release sends only the page form.

  Submit sends the captures of a run as pages of 2,000 rows, in the order of the item key and then the variant key. Then it sends one page index that names each page by its digest. It reads the accepted reference one page at a time, in the same order, and holds one page of the run and one page of the reference in memory. So a run has no limit for its capture count in the CLI, and a run is no longer limited to 16 capture jobs. One capture job keeps its limits: its manifest file, its archive, and 1 GiB of images.

  Before:

  ```
  POST /v1/runs                       comparisonMode: "local-v1"
  POST /v1/runs/:id/shards/combined   the complete manifest
  POST /v1/runs/:id/finalize          the end of the staging
  ```

  After:

  ```
  POST /v1/runs                       comparisonMode: "local-pages-v1"
  POST /v1/runs/:id/pages             one page of 2,000 rows
  POST /v1/runs/:id/index             the page index
  ```

  The service of visonaut.com accepts only the page form after its switch. Then it answers an earlier CLI with the status 409 and the code `capture_pages_required`, and the earlier CLI stops. A service that does not know the page form answers the new CLI with `visonaut: The service refused the request (HTTP 400, comparison_mode). No visual approval was granted.`

  Messages that change:

  - The success text is now `The captures are staged and run <id> is submitted. Visonaut will verify the complete workflow.`
  - Submit prints how many originals it staged and how many capture pages it sent.
  - A page above 4 MiB stops Submit with a message that asks for shorter test titles.
  - `Submit requires --no-visual or 1–16 --shard pairs.` is now `Submit requires --no-visual or at least one --shard pair.`
  - `The shard exceeds the 1 GiB encoded-image limit.` is now `A capture job exceeds the 1 GiB encoded-image limit.`

### Patch Changes

- 2af702e: Submit waits at the capacity limit

  `visonaut submit --shard` waits when the service answers `capacity_exceeded`, which means that the service is at its limit of active runs. It asks for a run again, up to 20 tries with 30 seconds between tries, and it stages no image before a try succeeds. Each try uses a new GitHub OIDC token. Before each wait, the CLI prints a line on standard error:

  ```
  Visonaut is at its capacity limit (try 1 of 20). Waiting 30 seconds before the next try.
  ```

  After 20 tries, the CLI fails with exit code `1`, and you can run the job again. The 19 waits take 9 minutes 30 seconds, and the time of the requests comes on top. The answers `database_size_exceeded` and `capture_limit_exceeded` need a person, so the CLI does not wait for them.

  Give the Submit job a `timeout-minutes` of 40 or more, so that the job does not end before the CLI prints its last line.

- 2af702e: Failed requests print their cause

  When the service refuses a request, the CLI prints the HTTP status, and the code and the reference when they are safe to print. It never prints the message of the server.

  ```
  visonaut: The service refused the request (HTTP 503, check_pending). Reference: 0b8f2d6e-5c1a-4e0b-9a77-3f6d2c1e8a90. No visual approval was granted.
  ```

  A status 401 or 403 keeps exit code `4` and prints the same detail, for example `Authentication or permission failed (HTTP 403, untrusted_run). Reference: <id>. Check the credential and repository access.`

  `visonaut begin` no longer replaces each failure with `The signed Submit check could not be started.` A refusal of the service now ends it with its own message, and a status 503 ends it with exit code `1` (before, `4`).

- 2af702e: Submit names the screenshot that it refuses

  A message about one screenshot file now starts with the item key and the variant key. The CLI prints the two keys only, and never the title of the test.

  ```
  visonaut: dialog/open (react-light): 1248x1700 is 2,121,600 pixels. The limit is 2,100,000.
  ```

  The message covers an image above 2.1 million pixels, a side above 8,192 pixels, a file above 2 MiB, a file that does not match its manifest, and a reference image that fails. Submit also stops before it reserves a run when two captures have the same item key and variant key:

  ```
  visonaut: dialog/open (react-light): Two captures have this item key and variant key. Give each screenshot its own keys.
  ```

  `A capture file changed while it was read.` now says `A capture file was modified while it was read.`

- 2af702e: `status` takes the session cookie value

  `VISONAUT_TOKEN` has the form `<session token>.<signature>`, which is the value of the session cookie. The service refuses a token without its signature. The help sentence of `status` says so:

  - Before: `Status requires VISONAUT_TOKEN, a maintainer session token.`
  - After: `Status requires VISONAUT_TOKEN, a maintainer session token with its signature.`

  The CLI decodes percent sequences in the value, so you can copy the cookie value from the browser as it is. Before, the CLI refused a value with a `%` character, and you had to decode it by hand.

  ```sh
  # Both values are used as "abc.d+e/f=".
  VISONAUT_TOKEN="abc.d%2Be%2Ff%3D" visonaut status --run <service-run-id>
  VISONAUT_TOKEN="abc.d+e/f=" visonaut status --run <service-run-id>
  ```

  A sequence that is not valid, such as `abc%zz`, stops the command with exit code `4` before any request. A decoded value with a character that a credential cannot have stops it the same way.

- 2af702e: Added the license notices of `pngjs` and `pixelmatch` to the `LICENSE` file of the package. The bundle contains their code, and both licenses require the notice in all copies.
- 2af702e: Reduced the PNG decodes of Submit for an unchanged or a new capture from two to one, which halves the decode work of such a capture. A capture that needs a pixel comparison keeps its decodes.

## 0.5.4

### Patch Changes

- f32fd10: Updated the [CLI guide](https://github.com/ariakit/visonaut/blob/main/packages/cli/README.md) with current workflow, comparison, and reference rules.

## 0.5.3

### Patch Changes

- 7893072: Fixed local comparisons that required review for a capture profile change when no pixels changed. Image size changes and profile changes with different pixels still require review.

## 0.5.2

### Patch Changes

- 9fce991: Reduced reference image downloads by 100% for byte-identical captures when only their rendering profile changes. These captures still require review.

## 0.5.1

### Patch Changes

- c73ddff: Fixed visual submission failing on accepted references with colon-separated capture IDs, including inherited captures.

## 0.5.0

### Minor Changes

- 65477c6: Native Plan skips and exact capture job names

  Use [`visonaut submit --no-visual`](https://github.com/ariakit/visonaut/blob/main/packages/cli/README.md) in the native CI Plan job when its successful calculator says that visual capture is unnecessary. The command sends the signed false result without capture artifacts or upload credentials.

  **BREAKING** if your capture workflow sets `VISONAUT_CAPTURE_JOB_PREFIX`. Pinned capture workflows now supply one complete job name template through `VISONAUT_CAPTURE_JOB_NAME`. Replace the old prefix setting with a template that contains one `{shard}` slot. `VISONAUT_SUBMIT_JOB_NAME` continues to hold the exact Submit name.

  Before:

  ```yaml
  VISONAUT_CAPTURE_JOB_PREFIX: "App / Visual capture / "
  ```

  After:

  ```yaml
  VISONAUT_CAPTURE_JOB_NAME: "App / Visual Capture ({shard})"
  VISONAUT_SUBMIT_JOB_NAME: "App / Visual Submit"
  ```

## 0.4.0

### Minor Changes

- 4f387ce: One verified capture submission path

  **BREAKING** if your workflow uses the encrypted capture transport, the renderer binary, or direct upload commands. Use normal Playwright jobs and one signed Submit job with ordinary one-day capture artifacts. The CLI now verifies the complete required job set, source attempts, rendering profiles, and image hashes before it submits. A missing inherited artifact requires a full visual rerun.

  Before:

  ```sh
  visonaut pack --dir "$RUNNER_TEMP/visonaut" --output capture.enc
  visonaut submit --bundle linux=linux.enc --bundle safari=safari.enc
  ```

  After:

  ```sh
  # Candidate jobs upload their complete capture directory for one day.
  visonaut submit --shard linux --shard safari
  ```

  Import rendering environment measurement from `@visonaut/playwright/environment`. Rendering profiles no longer include comparison policy or engine settings. The old `@visonaut/playwright/ci` export and `visonaut-capture` binary are removed. Capture image attachments use private files outside diagnostic artifacts and the reporter removes them after each run.

### Patch Changes

- 4f387ce: Compare captures in the trusted Submit job

  Submit compares PNG captures with the accepted reference in the caller's trusted job. It uses the screenshot threshold and pixel limits recorded by the Playwright adapter. It uploads new or changed originals and changed masks. Captures within the limits keep their observed metadata and image digest.

  Set the same capture limits through [`visual`](https://github.com/ariakit/visonaut/blob/main/packages/playwright/README.md) or [`visualBatch`](https://github.com/ariakit/visonaut/blob/main/packages/playwright/README.md):

  ```ts
  await visual(page, {
    item: "button",
    variant: { key: "react-light", browser: "chromium" },
    threshold: 0.2,
    maxDiffPixels: 5,
  });
  ```

  Use PNG captures and an accepted PNG reference. Local Submit rejects WebP references and requires a new Submit attempt if the accepted reference changes during comparison.

## 0.3.6

### Patch Changes

- [`598842b`](https://github.com/ariakit/visonaut/commit/598842b86a796e1d144c0cf55155096c89e99dac): Reduced waiting during large unchanged-image submissions by allowing four reuse-proof pages to run together, twice the previous limit, without changing page sizes or request counts.

## 0.3.5

### Patch Changes

- 7be9f58: Reported aggregate image PUT duration, attempted bytes, retry wait, and `validation_busy` retries during upload and Submit.
- 410867f: Staged capture images in batches of up to five and reported progress during large uploads. Busy image validation now has bounded retries within the existing request timeout.
- Updated dependencies
  - @visonaut/playwright@0.3.2

## 0.3.4

### Patch Changes

- 9e4af83: Staged unchanged screenshots with up to two concurrent CLI reuse pages while retaining upload fallback for misses. In seven alternating local runs of a 67-image, three-page upload fixture with a 100 ms mock service delay per page, median command time decreased from 338 ms with serial pages to 232 ms (1.46 times faster).

## 0.3.3

### Patch Changes

- 5cc5dac: Reduced image-transfer HTTP requests by 89% in a 67-image local fixture exercised through `visonaut upload --dir`, with 66 unchanged originals (71 requests to 8). `visonaut submit` uses the same transfer path to prove it has each image before reusing retained bytes, then uploads images that cannot be reused.
- 96e3b72: Explained when the service pauses new capture runs at its capacity limit and directed CI users to Service attention before rerunning the job.

## 0.3.2

### Patch Changes

- Allowed `visonaut submit` to use a signed workflow job whose name does not match its internal bundle key. The service still verifies the job's signed identity and configured role.
- Updated dependencies
  - @visonaut/playwright@0.3.1

## 0.3.1

### Patch Changes

- Submit encrypted visual packs in one signed job

  `visonaut submit --bundle` now combines named capture packs, uploads their images, and submits the run from one trusted GitHub Actions job. Visual jobs still use `visonaut pack` without an OIDC token.

  ```sh
  visonaut submit --bundle linux=visonaut-linux.enc --bundle safari=visonaut-safari.enc
  ```

- Allowed visual review to start after the signed capture and submit jobs succeed, while the CI Gate waits for review.

## 0.3.0

### Minor Changes

- Use existing visual jobs for Visonaut capture.

  **BREAKING** Workflows that use `visonaut-capture upload` must pack captures in the visual job and use the Visonaut CLI in a signed job.

  Before:

  ```sh
  visonaut-capture upload --shard linux \
    --comparison-policy-digest "$POLICY" --bundle-sha256 "$ADAPTER_SHA" \
    --input "$RUNNER_TEMP/visonaut-linux.enc" --output-directory "$RUNNER_TEMP/visonaut-upload"
  ```

  After:

  ```sh
  visonaut pack --dir "$RUNNER_TEMP/visonaut-linux" --output "$RUNNER_TEMP/visonaut-linux.enc"
  visonaut upload --bundle "$RUNNER_TEMP/visonaut-linux.enc"
  ```

## 0.2.0

### Minor Changes

- 9530073: Trusted workflow submission

  **BREAKING** if your workflow uses `visonaut finalize` or `--manifest`, switch to the [`visonaut` CLI](https://github.com/ariakit/visonaut/blob/main/packages/cli/README.md) upload/submit flow. `upload` stages each signed capture job, and a final signed job calls `submit` after all uploads succeed. The CLI reads `manifest.json` inside the capture directory.

  Before:

  ```sh
  visonaut upload --manifest visonaut/manifest.json
  visonaut finalize --manifest visonaut/manifest.json
  ```

  After:

  ```sh
  visonaut upload --dir visonaut
  visonaut submit --run "$GITHUB_RUN_ID"
  ```
