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

## Trusted CI helpers

This section describes the published **0.1 adapter paired with CLI 0.1**. Its trusted-plan workflow cannot use CLI 0.2, which removes `finalize` and `--manifest`. The workflow-owned adapter 0.2 release will replace these helpers. Pin the adapter and CLI together until that release.

`@visonaut/playwright/ci` is an opt-in Node.js subpath for a pinned GitHub Actions capture executor. It does not add a CLI command. The caller still owns its fixed test collection, browser projects, web servers, runner allowlist, and trusted plan. Install this package and `visonaut` from an exact npm lockfile in a directory outside the candidate checkout. Bind the lockfile and caller configuration to the trusted plan's executor digest.

```js
import { verifyTrustedPlan, encryptTransfer } from "@visonaut/playwright/ci";

await verifyTrustedPlan({ directory: trustedExecutor, planFile: trustedPlan });
await encryptTransfer(results, browser, encryptedArtifact, publicKeyFile);
```

The 0.1 render job uses GitHub OIDC to download its pinned packages, but the test process runs without OIDC credentials. It has no private key and uploads only the encrypted shard. A separate trusted submission job never checks out candidate code. It redeems the private key once with its signed GitHub identity, decrypts and verifies the shard, binds it to the current job, and runs the paired 0.1 CLI's upload and finalize commands. The service independently checks the pinned reusable workflow SHA, exact tested commit, source plan, and completed job. The public repository artifact contains no plaintext screenshot or manifest.

## Reporter

Add the reporter with the verified workflow context and local shard identity. The service independently verifies this context with GitHub and its trusted plan. Client fields do not prove that a run is complete.

```ts
reporter: [
  ["list"],
  [
    "@visonaut/playwright/reporter",
    {
      outputFile: "visonaut/manifest.json",
      run: {
        repository: "ariakit/ariakit",
        repositoryId: process.env.GITHUB_REPOSITORY_ID,
        workflowRunId: process.env.GITHUB_RUN_ID,
        workflowAttempt: Number(process.env.GITHUB_RUN_ATTEMPT),
        testedSha: process.env.VISONAUT_TESTED_SHA,
        planDigest: process.env.VISONAUT_PLAN_DIGEST,
      },
      shard: {
        key: process.env.VISONAUT_SHARD_KEY,
        jobId: process.env.VISONAUT_JOB_ID,
        sourceAttempt: Number(process.env.GITHUB_RUN_ATTEMPT),
      },
    },
  ],
];
```

The reporter uses suite declaration order and call order, not worker completion order. It selects only the final successful attempt of each test. If a test captures blue, fails later, then captures green and passes on retry, the manifest contains only green. Failed-attempt attachments remain local Playwright diagnostics. They are not selected for upload.

A failed run, exhausted retry, missing image, duplicate identity, or empty capture set produces no successful manifest and fails the command. A prior manifest is removed when the reporter starts, so a failed rerun cannot upload old success. Pass an optional `plan` object to the reporter for an early exact test/capture check. The server always performs its own trusted-plan check.

```sh
# Only for the paired adapter/CLI 0.1 workflow described above:
pnpm exec visonaut upload --manifest visonaut/manifest.json
pnpm exec visonaut finalize --manifest visonaut/manifest.json
```

Run capture and upload as separate steps. The capture job does not wait for human review.

## Trusted candidate discovery

Use discovery mode in the immutable trusted-main capture executor. The trusted plan fixes all expected jobs, environment profiles, and collection settings. Pass `plan` and the absolute candidate `repositoryRoot` to the injected reporter. Each job uses one fixed project and shard. Set `forbidOnly: true`. Put all selection settings in the trusted configuration; the only supported command-line arguments are `test --config <trusted-config>`.

```ts
const collection = {
  projectName: "chrome",
  testDir: "app/src",
  testMatch: ["**/*-test.tsx"],
  testIgnore: [],
  grep: [{ source: "@visual", flags: "" }],
  grepInvert: [],
  shard: { current: 1, total: 3 },
  repeatEach: 1,
};
```

The reporter freezes the test inventory before execution. It requires every collected test to finish successfully, using its final successful retry. Capture calls record both start and completion markers. A caught capture error still fails the report. The candidate may add, remove, or rename tests and explicit capture keys without changing the trusted collection policy.

After success, the reporter writes `receipt.json` beside the manifest. The fixed workflow uploads that file with the receipt's `artifactName` using the pinned GitHub artifact action. Use `overwrite: false` and `if-no-files-found: error`. Do not accept an artifact name or reporter configuration from candidate code. The service stages uploads first, then waits for the exact GitHub job to succeed and independently verifies the receipt artifact before accepting candidate discovery.

A trusted workflow and receipt bind the selected manifest to a complete successful execution. They do not prove that candidate code captured truthful screenshots.
