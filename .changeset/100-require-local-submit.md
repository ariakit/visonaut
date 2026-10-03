---
"@visonaut/web": minor
---

New submissions require trusted local comparison

**BREAKING** if a client reserves a run without `comparisonMode: "local-v1"` or requests server recomparison of a stored legacy run. Upgrade the Visonaut CLI and capture a new complete run with trusted local Submit. Previously issued upload capabilities and legacy recovery remain available during drain. Existing reviews, approvals, history, and originals retain their current rules.

Before:

```ts
const request = { ...reservation };
```

After:

```ts
const request = { ...reservation, comparisonMode: "local-v1" };
```
