---
"@visonaut/playwright": patch
---

Capture several items from one screenshot pair

The new [`visualBatch`](https://github.com/ariakit/visonaut/tree/main/packages/playwright#capture) API captures several document clips from one stable full-page image. Each item keeps its own identity and capture profile.

```ts
await visualBatch(page, {
  variant: { key: "react-chromium-light", browser: "chromium" },
  items: [
    { item: "button/default", clip: { x: 24, y: 24, width: 360, height: 180 } },
    { item: "button/brand", clip: { x: 400, y: 24, width: 360, height: 180 } },
  ],
});
```
