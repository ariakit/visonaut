# visonaut

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
