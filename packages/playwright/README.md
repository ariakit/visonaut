# @visonaut/playwright

This guide describes the public adapter source. The [current system guide](../../docs/current-contract.md) owns the supported path and selected changes. Capture prepared Playwright pages with stable item and variant identities. Ariakit owns its projects, page preparation, clip geometry, and normal Playwright command. Visonaut waits for settled font faces and two consecutive equal screenshots. A failed or incomplete test run produces no manifest.

```ts
import { visual } from "@visonaut/playwright";
import { measureEnvironment } from "@visonaut/playwright/environment";

const environment = await measureEnvironment({
  outputDirectory: captureDirectory,
  appPackageFile: new URL("./package.json", import.meta.url).pathname,
  applicationFontPackage: "@fontsource-variable/inter",
});
// Set project.metadata.visonaut = { profile: environment.profile, comparisonDefaults: {} }.
await visual(page, {
  item: "dialog/open",
  variant: { key: "react-light", browser: "chromium" },
});
```

Configure `@visonaut/playwright/reporter` in the caller's normal Playwright configuration. Set `outputFile`, the exact GitHub run and tested commit, the shard key and source attempt, and trusted discovery options. Candidate discovery uses the pinned package digest and the complete selected suite. Keep expected invocation and project checks explicit in the local Ariakit setup helper.

The reporter writes `manifest.json` and `images/<sha256>.png` beside `environment.json`. Rendering profiles contain browser, OS, fonts, viewport, locale, media, and screenshot settings. Each capture stores effective consumer comparison settings in `comparison`, separate from its rendering profile. The comparison engine identity belongs to the trusted comparison.

Set `project.metadata.visonaut.comparisonDefaults` beside `profile`. Share one comparison object with Playwright's `expect.toHaveScreenshot` configuration. Preserve your existing tolerances; the values below show the built-in policy:

```ts
import { defineConfig } from "@playwright/test";
import type { ComparisonOptions } from "@visonaut/playwright";

const comparisonDefaults = {
  threshold: 0.2,
  maxDiffPixels: 0,
} satisfies ComparisonOptions;

export default defineConfig({
  expect: { toHaveScreenshot: comparisonDefaults },
  metadata: {
    visonaut: { profile: environment.profile, comparisonDefaults },
  },
});
```

Project metadata must have its own `visonaut` object with its own `comparisonDefaults` object for `visual` and `visualBatch`. Missing defaults cause a setup error, even when a capture supplies all comparison settings. For project-specific Playwright settings, put that project's shared object in both places. An explicit `{}` selects the built-in policy and does not inherit Playwright's screenshot defaults. The defaults must be an object with valid numeric comparison fields, or capture fails with a setup error. Only own comparison fields count, including non-enumerable fields. Override each setting on a capture:

```ts
await visual(page, {
  item: "button",
  variant: { key: "react-light", browser: "chromium" },
  maxDiffPixels: 5,
});
```

`visualBatch` accepts these settings for the batch and for each item. The order is project defaults, then batch settings, then image settings. An omitted field inherits its value. An explicit `undefined` clears its inherited value. Playwright uses the smaller limit when both pixel limits are set. The threshold defaults to `0.2`; with no pixel limit, the allowed count is zero. These settings do not change the requirement for two consecutive identical capture images.

This source requires public comparison defaults and no longer reads private Playwright screenshot configuration. To migrate from the compatible adapter `0.4.1`, share your existing effective screenshot settings with `comparisonDefaults` before installing the breaking release. Use `{}` only when you intend the built-in policy. The exact Playwright peer pin remains `1.63.0`; a later version requires actual capture verification.

Starting with adapter `0.5.0`, this public configuration is required. See the [comparison-default migration record](../../docs/operations/strict-adapter-comparison-defaults.md) for the coordinated release sequence.

Capture image attachments use private `0600` attempt files outside `test-results`. The reporter reads one image at a time and removes those files after successful or failed attempts. It uses the public attachment array because Playwright's `attach({ path })` copies bytes into diagnostic results. This keeps successful capture bytes out of the seven-day failure artifact.

Upload the complete successful capture directory as one ordinary GitHub Actions artifact per required shard. Name it `visonaut-capture-<run-id>-<source-attempt>-<shard-key>` and retain it for one day. Keep failure screenshots and retry traces in ordinary bounded seven-day diagnostic artifacts. Candidate jobs receive no GitHub OIDC or service upload credential.

The sole trusted Submit job runs `visonaut submit --shard linux --shard safari`, which starts the Visonaut App check before artifact downloads and image staging. It downloads exact verified artifacts, validates every image and rendering profile, and submits a new complete bundle. An expired inherited artifact requires a full visual rerun. Upload or submission never grants review approval.

The old `@visonaut/playwright/ci` export, `visonaut-capture` binary, second test configuration, runtime lock, dependency bootstrap, transfer encryption, and per-shard signed upload are removed. New integrations use their normal Playwright jobs and the single signed Submit path.
