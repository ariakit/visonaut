---
"@visonaut/playwright": minor
---

The reporter needs no package digest

**BREAKING** if your reporter configuration sets `run.planDigest` or `discovery.executorDigest`. The two options are removed.

The reporter writes one fixed digest, the SHA-256 of the empty text, in both manifest fields. The service compares neither field with a setting. The exported option types no longer have the two names. At run time, a value that is set changes nothing.

The adapter error `Capture needs a verified package digest` is gone, because nothing supplies a digest to check.

Upgrade `@visonaut/playwright` and `visonaut` together. The new CLI refuses a capture bundle of `@visonaut/playwright@0.5.0` with exit code `4`, and `visonaut@0.5.4` refuses a bundle of the new adapter while `VISONAUT_PACKAGE_SHA256` holds another digest.

Before:

```ts
reporter: [
  [
    "@visonaut/playwright/reporter",
    {
      run: {
        repository,
        repositoryId,
        workflowRunId,
        workflowAttempt,
        testedSha,
        planDigest: requiredEnv("VISONAUT_PACKAGE_SHA256"),
      },
      discovery: {
        executorDigest: requiredEnv("VISONAUT_PACKAGE_SHA256"),
        repositoryRoot,
        expectedInvocation,
        expectedProjects,
      },
    },
  ],
],
```

After:

```ts
reporter: [
  [
    "@visonaut/playwright/reporter",
    {
      run: {
        repository,
        repositoryId,
        workflowRunId,
        workflowAttempt,
        testedSha,
      },
      discovery: {
        repositoryRoot,
        expectedInvocation,
        expectedProjects,
      },
    },
  ],
],
```
