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

Keep the application's Playwright configuration and visual test command. Call `measureEnvironment` from `@visonaut/playwright/ci` before the visual run, with `outputDirectory` set to the capture directory. It writes the `environment.json` required by `visonaut pack`. Set the returned profile on the visual projects and add the Visonaut reporter with its manifest in that same directory. The existing `visual()` helper calls this adapter from the prepared page. The reporter writes the successful manifest and images there.

In the visual job, run the existing tests and then encrypt the result:

```sh
VISUAL_TEST=true pnpm -F app exec playwright test --project chrome firefox --grep @visual --output test-results/test-visual
pnpm -F app exec visonaut pack --dir "$RUNNER_TEMP/visonaut-linux" --output "$RUNNER_TEMP/visonaut-linux.enc"
```

The visual job has no GitHub OIDC permission. A separate signed job downloads the encrypted artifact and runs `visonaut upload --bundle`. The final job runs `visonaut submit --run "$GITHUB_RUN_ID"`. This separation keeps the upload credential away from pull-request test code and keeps plaintext screenshots out of GitHub artifacts. The upload job independently measures its operating system and system fonts and binds the result to the approved workflow source.

The application checkout controls its test files, Playwright configuration, and installed reporter. Visonaut verifies the signed upload job and validates the bundle, but it cannot attest that collaborator-controlled test code ran an immutable suite. Review changes to visual test selection and dependencies as code.

The older `visonaut-capture render` command remains available for pinned diagnostic workflows. New application integrations should use their existing Playwright jobs.

The reporter selects only the final successful attempt of each test. If a test captures blue, fails later, then captures green and passes on retry, only green enters the manifest. A failed run, exhausted retry, missing image, duplicate identity, caught capture failure, or empty capture set produces no successful manifest. The reporter deletes any prior manifest before the new run starts, so a failed rerun cannot upload old success.
