---
"@visonaut/playwright": patch
---

Explicit shared comparison defaults

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
