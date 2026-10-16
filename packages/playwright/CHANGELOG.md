# @visonaut/playwright

## 0.6.3

### Captures compare the bytes of two screenshots before they decode them

The stability loop of [`visual`](https://github.com/ariakit/visonaut/blob/main/packages/playwright/README.md) and [`visualBatch`](https://github.com/ariakit/visonaut/blob/main/packages/playwright/README.md) now accepts two consecutive screenshots with equal bytes with no PNG decode and no pixel compare. Equal bytes always mean equal pixels. Each screenshot decodes at most one time, and the crops of a batch reuse the decoded pixels of the compare.

On a stable 1280 by 1600 page in Chromium, one `visual` call is about 14% faster, a median of about 369 ms before and about 318 ms after (the mean of two runs of 15 captures each). The PNG bytes and the digests of every capture do not change.

## 0.6.2

### Captures can accept the first screenshot when an earlier capture has the same image

Set `VISONAUT_PREVIOUS_CAPTURE` to the directory of an earlier capture bundle, for example the capture artifact of the base commit. When the first screenshot of [`visual`](https://github.com/ariakit/visonaut/blob/main/packages/playwright/README.md) has the image digest that the bundle's `manifest.json` records for the same item and variant, the capture accepts it with no second screenshot and no wait. [`visualBatch`](https://github.com/ariakit/visonaut/blob/main/packages/playwright/README.md) accepts its first full-page screenshot only when each crop has its digest.

```sh
VISONAUT_PREVIOUS_CAPTURE="$RUNNER_TEMP/visonaut-previous" npx playwright test
```

Each other case waits for two consecutive equal screenshots as before: an item or variant with no capture in the bundle, a different digest, and a bundle that is missing, has a manifest above 8 MiB, or is not readable by this release. An unusable bundle writes one warning and never fails a capture. A capture that accepts its first screenshot records the same digest that two equal screenshots of that image give. A render that changes after a matching first screenshot is not seen; the stability loop sees it when it shows before the second screenshot.

## 0.6.1

### Patch Changes

- 8bdcfe9: Allowed compatible updates through caret ranges for the `pngjs` dependency and the `@playwright/test` peer dependency.
- a066381: Relaxed the Node.js engine requirement to accept Node.js 24.18.0 and later.

## 0.6.0

### Minor Changes

- 2af702e: The reporter needs no package digest

  **BREAKING** if your reporter configuration sets `run.planDigest` or `discovery.executorDigest`. The two options are removed.

  The reporter writes one fixed digest, the SHA-256 of the empty text, in both manifest fields. The service compares neither field with a setting. The exported option types no longer have the two names. At run time, a value that is set changes nothing.

  The adapter error `Capture needs a verified package digest` is gone, because nothing supplies a digest to check.

  Upgrade `@visonaut/playwright` and `visonaut` together. The new CLI refuses a capture bundle of `@visonaut/playwright@0.5.0` with exit code `4`, and `visonaut@0.5.4` refuses a bundle of the new adapter while `VISONAUT_PACKAGE_SHA256` holds another digest.

  Before:

  ```ts
  reporter: [
    [
      "@visonaut/playwright/reporter",
      {
        run: {
          repository,
          repositoryId,
          workflowRunId,
          workflowAttempt,
          testedSha,
          planDigest: requiredEnv("VISONAUT_PACKAGE_SHA256"),
        },
        discovery: {
          executorDigest: requiredEnv("VISONAUT_PACKAGE_SHA256"),
          repositoryRoot,
          expectedInvocation,
          expectedProjects,
        },
      },
    ],
  ],
  ```

  After:

  ```ts
  reporter: [
    [
      "@visonaut/playwright/reporter",
      {
        run: {
          repository,
          repositoryId,
          workflowRunId,
          workflowAttempt,
          testedSha,
        },
        discovery: {
          repositoryRoot,
          expectedInvocation,
          expectedProjects,
        },
      },
    ],
  ],
  ```

### Patch Changes

- 2af702e: `visual` and `visualBatch` check the image bounds of Submit

  `visual` and `visualBatch` now fail a capture that Submit would refuse: an image above 2 MiB encoded, above 2.1 million pixels, or with a side above 8,192 pixels. The test fails in the capture job, with the item key and the variant key, and not later in the Submit job.

  ```
  dialog/open (react-light): 1248x1700 is 2,121,600 pixels. The limit is 2,100,000.
  ```

  The adapter message `Capture exceeds the encoded image limit` (20 MiB) is replaced by the 2 MiB check, which names the item. A screenshot above the memory limits of the adapter (32 million pixels or 20 MiB) still fails earlier, with no item name.

## 0.5.0

### Minor Changes

- c0fa276: Required public comparison defaults

  **BREAKING** if your project does not explicitly set [`metadata.visonaut.comparisonDefaults`](https://github.com/ariakit/visonaut/blob/main/packages/playwright/README.md) to an object. Both `visual` and `visualBatch` now fail with a setup error when it is missing, even when capture options supply all comparison settings.

  Share each project's existing effective screenshot settings with the adapter. An explicit `{}` selects threshold `0.2` and zero allowed pixels. The adapter no longer reads private Playwright screenshot configuration. Project, batch, and image precedence, explicit `undefined` clearing, and both pixel limits stay the same. The exact Playwright peer remains `1.63.0`.

  Before:

  ```ts
  const comparisonDefaults = { threshold: 0.15, maxDiffPixels: 5 };
  export default defineConfig({
    expect: { toHaveScreenshot: comparisonDefaults },
    metadata: { visonaut: { profile } },
  });
  ```

  After:

  ```ts
  const comparisonDefaults = { threshold: 0.15, maxDiffPixels: 5 };
  export default defineConfig({
    expect: { toHaveScreenshot: comparisonDefaults },
    metadata: { visonaut: { profile, comparisonDefaults } },
  });
  ```

## 0.4.1

### Patch Changes

- fbfa52b: Explicit shared comparison defaults

  Set [`project.metadata.visonaut.comparisonDefaults`](https://github.com/ariakit/visonaut/blob/main/packages/playwright/README.md) beside `profile`. Use the same object for Playwright's screenshot assertions and Visonaut capture metadata:

  ```ts
  const comparisonDefaults = { threshold: 0.2, maxDiffPixels: 0 };

  export default defineConfig({
    expect: { toHaveScreenshot: comparisonDefaults },
    metadata: { visonaut: { profile, comparisonDefaults } },
  });
  ```

  Explicit defaults, including `{}`, take precedence over automatic inheritance. Project, batch, and image overrides keep their existing order and explicit `undefined` clearing. Invalid explicit defaults fail capture.

  This compatible release retains the tested Playwright `1.63.0` fallback only when explicit defaults are absent. Required explicit configuration and private-field removal remain held for verified consumer adoption and a declared breaking release. The Playwright peer pin stays unchanged.

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

## 0.3.2

### Patch Changes

- 897d071: Added `visualBatch` to capture several document clips from one stable full-page screenshot pair while keeping a separate identity and profile for each item.
- 6b12c11: Rejected signed uploads to the retired diagnostics origin.

## 0.3.1

### Patch Changes

- Allowed `visonaut submit` to use a signed workflow job whose name does not match its internal bundle key. The service still verifies the job's signed identity and configured role.

## 0.3.0

### Minor Changes

- Use existing visual jobs for Visonaut capture.

  **BREAKING** Workflows that use `visonaut-capture upload` must pack captures in the visual job and use the Visonaut CLI in a signed job. The reporter supports Chrome and Firefox in one visual job. Diagnostic workflows can still use `visonaut-capture render`.

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

### Patch Changes

- Fixed `visonaut-capture` to run from a normal package install with the app's Playwright dependency.

## 0.2.0

### Minor Changes

- eeecb07: Workflow-owned visual capture

  **BREAKING** if you use the package's trusted-plan CI helpers. The immutable GitHub workflow now owns the capture matrix and complete test selection. The package adds `visonaut-capture` to render the actual environment; a separate signed upload job stages each shard.

  Before, the pinned executor verified its trusted plan through the package's CI helpers:

  ```js
  import { verifyTrustedPlan } from "@visonaut/playwright/ci";

  await verifyTrustedPlan({ directory: trustedExecutor, planFile: trustedPlan });
  ```

  After:

  ```sh
  visonaut-capture render --repository-root "$GITHUB_WORKSPACE" --test-dir app/src \
    --test-patterns '["/test[^/]*-browser"]' --project chrome --browser chromium \
    --device "Desktop Chrome" --base-url http://localhost:4321 --shard chrome-1 \
    --font-package @fontsource-variable/inter \
    --comparison-policy-digest "$POLICY_SHA" --bundle-sha256 "$PACKAGE_SHA" \
    --output "$RUNNER_TEMP/chrome-1.enc"
  ```

  Pass the same font package and policy digest to the signed `upload` command.

### Patch Changes

- 4a82767: Encrypted visual bundles with the transfer key of the selected Visonaut server so preview, production, and diagnostics can keep separate private keys.
- e43de8e: Accepted GitHub's runner OIDC request endpoint during signed visual uploads.
