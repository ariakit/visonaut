---
"visonaut": patch
"@visonaut/playwright": patch
---

Compare captures in the trusted Submit job

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
