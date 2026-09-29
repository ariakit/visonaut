# visonaut

## 0.4.0

### Minor Changes

- One verified capture submission path

  **BREAKING** if your workflow uses the encrypted capture transport, the renderer binary, or direct upload commands. Use normal Playwright jobs and one signed Submit job with ordinary one-day capture artifacts. The CLI now verifies the complete required job set, source attempts, rendering profiles, and image hashes before it submits. A missing inherited artifact requires a full visual rerun.

  Before:

  ```sh
  visonaut pack --dir "$RUNNER_TEMP/visonaut" --output capture.enc
  visonaut submit --bundle linux=linux.enc --bundle safari=safari.enc
  ```

  After:

  ```sh
  # Candidate jobs upload their complete capture directory for one day.
  visonaut begin --run "$GITHUB_RUN_ID"
  visonaut submit --shard linux --shard safari
  ```

  Import rendering environment measurement from `@visonaut/playwright/environment`. Rendering profiles no longer include comparison policy or engine settings. The old `@visonaut/playwright/ci` export and `visonaut-capture` binary are removed. Capture image attachments use private files outside diagnostic artifacts and the reporter removes them after each run.

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
