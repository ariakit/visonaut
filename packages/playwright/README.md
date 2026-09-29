# @visonaut/playwright

Capture prepared Playwright pages with stable item and variant identities. Ariakit owns its projects, page preparation, clip geometry, and normal Playwright command. Visonaut waits for settled font faces and two consecutive equal screenshots. A failed or incomplete test run produces no manifest.

```ts
import { visual } from "@visonaut/playwright";
import { measureEnvironment } from "@visonaut/playwright/environment";

const environment = await measureEnvironment({
  outputDirectory: captureDirectory,
  appPackageFile: new URL("./package.json", import.meta.url).pathname,
  applicationFontPackage: "@fontsource-variable/inter",
});
// Set project.metadata.visonaut.profile = environment.profile.
await visual(page, {
  item: "dialog/open",
  variant: { key: "react-light", browser: "chromium" },
});
```

Configure `@visonaut/playwright/reporter` in the caller's normal Playwright configuration. Set `outputFile`, the exact GitHub run and tested commit, the shard key and source attempt, and trusted discovery options. Candidate discovery uses the pinned package digest and the complete selected suite. Keep expected invocation and project checks explicit in the local Ariakit setup helper.

The reporter writes `manifest.json` and `images/<sha256>.png` beside `environment.json`. Rendering profiles contain browser, OS, fonts, viewport, locale, media, and screenshot settings. Comparison policy and engine identity belong to the service comparison and do not change the captured rendering identity.

Capture image attachments use private `0600` attempt files outside `test-results`. The reporter reads one image at a time and removes those files after successful or failed attempts. It uses the public attachment array because Playwright's `attach({ path })` copies bytes into diagnostic results. This keeps successful capture bytes out of the seven-day failure artifact.

Upload the complete successful capture directory as one ordinary GitHub Actions artifact per required shard. Name it `visonaut-capture-<run-id>-<source-attempt>-<shard-key>` and retain it for one day. Keep failure screenshots and retry traces in ordinary bounded seven-day diagnostic artifacts. Candidate jobs receive no GitHub OIDC or service upload credential.

The sole trusted Submit job runs `visonaut begin --run <run-id>` before lengthy work, then `visonaut submit --shard linux --shard safari`. It downloads exact verified artifacts, validates every image and rendering profile, and submits a new complete bundle. An expired inherited artifact requires a full visual rerun. Upload or submission never grants review approval.

The old `@visonaut/playwright/ci` export, `visonaut-capture` binary, second test configuration, runtime lock, dependency bootstrap, transfer encryption, and per-shard signed upload are removed. New integrations use their normal Playwright jobs and the single signed Submit path.
