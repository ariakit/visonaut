---
"@visonaut/web": minor
---

Server comparison producers and handlers are removed

**BREAKING** if an old workflow stage requires server image comparison. After the terminal legacy cohort passes the retirement gate, the service requires a verified local Submit receipt to create a comparison. Upgrade the CLI and capture a new complete run. Existing reviews, approval tuples, history, originals, and native Submit recovery retain their current rules.

Before:

```ts
await service.createComparison({ ...comparison, maxAttempts: 5 });
```

After:

```ts
await service.createComparison({ ...comparison, localComparison: verifiedReceipt });
```

The private image validation endpoint still supports PNG and WebP. Remove the retired `comparisonMaxAttempts` field from selected `VISONAUT_API_LIMITS` overrides before deployment. Remaining numeric bounds keep their existing values. Operators must detach the existing comparison and comparison dead-letter consumers before they deploy the fetch-only validation Worker. Queue resources and stored records remain in place. Follow the [retirement runbook](https://github.com/ariakit/visonaut/blob/main/docs/operations/retire-server-comparison.md).
