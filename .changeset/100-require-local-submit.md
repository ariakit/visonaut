---
"@visonaut/web": minor
---

New submissions require trusted local comparison

**BREAKING** if a client reserves a run without `comparisonMode: "local-v1"`. Upgrade the Visonaut CLI and capture a new complete run. Previously issued upload capabilities and legacy recovery remain available during drain.

Before:

```ts
const request = { ...reservation };
```

After:

```ts
const request = { ...reservation, comparisonMode: "local-v1" };
```
