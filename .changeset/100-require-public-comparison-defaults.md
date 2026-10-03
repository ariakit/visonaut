---
"@visonaut/playwright": minor
---

Required public comparison defaults

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
