# @visonaut/playwright

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
