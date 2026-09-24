# @visonaut/playwright

Capture one prepared page variant and write a Visonaut manifest with a Playwright reporter. The service compares uploaded images. An upload does not approve a visual change.

Launch support is limited to Node.js 24.18.0, pnpm 12.5.1, and Playwright 1.63.0. The adapter emits original PNG bytes. The ingest protocol also supports validated lossless WebP from other clients.

```sh
pnpm add -D @visonaut/playwright visonaut @playwright/test@1.63.0
```

## Capture

The caller owns navigation, page preparation, media settings, variant loops, clipping, and cleanup. Each call captures one variant. Item and variant keys are explicit. A display-name change does not change identity.

```ts
import { visual } from "@visonaut/playwright";

await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
await visual(page, {
  item: "dialog/success/open",
  name: "Success dialog",
  variant: {
    key: "react-chromium-dark",
    framework: "react",
    browser: "chromium",
    colorScheme: "dark",
  },
  timeout: 5000,
  screenshot: { fullPage: false, scale: "css" },
});
```

The adapter waits for document and font readiness. It captures PNG images with animations disabled and requires two consecutive images with equal dimensions and equal decoded RGBA pixels. Captures are at least 100 ms apart. A deadline applies to the complete operation. The default is 5000 ms; a timeout is a capture failure, including for a new item. Pass the existing effective timeout and screenshot options when you replace another capture helper. The adapter does not read private Playwright assertion configuration. Capture limits are 20 MiB encoded and 32 million decoded pixels. These are defensive client limits, separate from the measured service policy.

For the supported Playwright 1.63.0 Firefox path, set `PW_TEST_SCREENSHOT_NO_FONTS_READY=1` in the Playwright config before browsers launch. Playwright's own screenshot wait can remain pending after navigation even when all font faces have settled. The trusted CI config helper sets this value; the adapter then checks the font faces directly.

Set the operating-system image digest, font digest, comparison-policy digest, and comparison-engine version in `project.metadata.visonaut.profile`, or pass them in `visual(..., { profile })`. Use real SHA-256 digests from the trusted capture configuration. Browser version, viewport, device scale, locale, time zone, media state, animation policy, and screenshot options are recorded from the prepared page. A variant's declared browser or media state must match that page.

```ts
import { defineConfig } from "@playwright/test";

export default defineConfig({
  use: { reducedMotion: "reduce", locale: "en-US", timezoneId: "UTC" },
  metadata: {
    visonaut: {
      profile: {
        osImageDigest: process.env.VISONAUT_OS_IMAGE_DIGEST,
        fontsDigest: process.env.VISONAUT_FONTS_DIGEST,
        comparisonPolicyDigest: process.env.VISONAUT_POLICY_DIGEST,
        comparisonEngineVersion: "rgba-v1",
      },
    },
  },
});
```

The adapter does not set CI gates. Ariakit's integration must retain its `CI` and `VISUAL_TEST` checks before calling it.

## Workflow capture

The published 0.1 adapter must stay paired with CLI 0.1 because CLI 0.2 removes `finalize` and `--manifest`. The workflow-owned runner described below ships with the adapter 0.2 release.

The workflow-owned `visonaut-capture` runner executes one complete visual collection from a pinned GitHub reusable workflow. That workflow declares the browser, operating system, project, test-file patterns, app preview commands, and comparator policy. The runner does not load the candidate Playwright config or a trusted-plan file. It forces one project, `@visual`, no ignored tests, one execution per test, and `forbidOnly`. The reporter records the discovered test inventory and requires every selected test to finish successfully. A zero-test shard fails.

The workflow verifies the adapter tarball SHA-256 before extraction. It then copies `ci/runtime-lock.json` to `ci/package-lock.json` and runs `npm ci --ignore-scripts --no-audit --no-fund` from the extracted `package/ci` directory. This installs the exact published CLI and Playwright versions from the package-owned integrity lock.

```sh
node package/ci/bin.mjs render --repository-root "$GITHUB_WORKSPACE" \
  --test-dir app/src --test-patterns '["/test[^/]*-browser"]' \
  --project chrome --browser chromium --device "Desktop Chrome" \
  --base-url http://localhost:4321 --shard chrome-1 \
  --font-package @fontsource-variable/inter \
  --comparison-policy-digest "$APPROVED_POLICY_SHA" \
  --bundle-sha256 "$VERIFIED_TARBALL_SHA" \
  --output "$RUNNER_TEMP/chrome-1.enc"
```

The pinned workflow supplies `VISONAUT_WEB_SERVERS` as a JSON array of its preview commands, working directories, ports, and environment settings. `--test-patterns` is a JSON array of regular-expression sources. Ariakit's preview imports `@fontsource-variable/inter`, so its pinned workflow passes that package to both render and upload. The runner records operating-system, system-font, and application-font hashes once; each `visual()` call records the actual browser version, viewport, media state, and screenshot options. There is no catalogue of hypothetical profile digests.

The render job has no OIDC permission. It writes only an encrypted manifest and images. A separate upload job has `id-token: write`, does not check out candidate code, and uses the same verified package:

```sh
node package/ci/bin.mjs upload --shard chrome-1 \
  --font-package @fontsource-variable/inter \
  --comparison-policy-digest "$APPROVED_POLICY_SHA" \
  --bundle-sha256 "$VERIFIED_TARBALL_SHA" \
  --input "$RUNNER_TEMP/chrome-1.enc" \
  --output-directory "$RUNNER_TEMP/visonaut-upload"
```

The upload job checks the transferred profile against its own OS and system-font measurement, the pinned comparison policy, and the application-font package named by the workflow. It rejects a capture call that supplies an older profile. It then binds the manifest to its signed GitHub job ID and reusable workflow source SHA, stages the shard with `visonaut upload`, and emits the exact receipt artifact name through `GITHUB_OUTPUT`. The workflow uploads only `receipt.json`; it does not publish plaintext screenshots. `VISONAUT_SERVER` selects `https://visonaut.com` by default; trusted preview and diagnostic workflows can set the exact `https://preview.visonaut.com` or `https://diagnostics.visonaut.com` origin. Before candidate tests run, the runner fetches the public transfer key from that exact server; the server derives it from its own private key, so preview, production, and diagnostics keep separate secrets. The runner rejects other origins before requesting a GitHub identity token. After every upload job succeeds, a final job calls `visonaut submit --run "$GITHUB_RUN_ID"`. The service resolves that external run ID from the signed final job, verifies one staged shard per successful pinned upload job and the whole workflow result, then determines the Visonaut check. Staging or submitting is not visual approval.

The reporter selects only the final successful attempt of each test. If a test captures blue, fails later, then captures green and passes on retry, only green enters the manifest. A failed run, exhausted retry, missing image, duplicate identity, caught capture failure, or empty capture set produces no successful manifest. The reporter deletes any prior manifest before the new run starts, so a failed rerun cannot upload old success.
