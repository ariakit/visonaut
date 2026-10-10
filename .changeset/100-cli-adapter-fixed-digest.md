---
"visonaut": minor
---

The CLI and the adapter upgrade together

**BREAKING** if you install `visonaut` and `@visonaut/playwright` at different releases, or if your workflow sets `VISONAUT_PACKAGE_SHA256` or `VISONAUT_WORKFLOW_SOURCE_SHA`.

The CLI reads neither `VISONAUT_PACKAGE_SHA256` nor `VISONAUT_WORKFLOW_SOURCE_SHA`. A value that is set changes nothing and is no error. Submit sends one fixed digest, the SHA-256 of the empty text, in `run.planDigest` and in `discovery.executorDigest`. The service compares neither field with a setting, so a workflow edit needs no cutover in this repository.

The new CLI refuses a capture bundle of `@visonaut/playwright@0.5.0` with exit code `4`:

```
visonaut: A capture bundle does not have the digest that this CLI expects. Use the same release of visonaut and @visonaut/playwright.
```

`visonaut@0.5.4` refuses a bundle of the new adapter while `VISONAUT_PACKAGE_SHA256` holds another digest. Upgrade both packages in one pull request, and then remove the two variables from your workflow.

These CLI messages are gone:

- `VISONAUT_PACKAGE_SHA256 is required for signed submission.` (exit code `2`)
- `VISONAUT_WORKFLOW_SOURCE_SHA is required for signed submission.` (exit code `2`)
- `The pinned package or workflow digest is invalid.` (exit code `4`)

This message changed (exit code `4`):

- Before: `Submit did not use this commit's pinned visual workflow.`
- After: `Submit did not use this commit's visual workflow.`

`A capture bundle has the wrong shard or package identity.` (exit code `4`) is now three messages:

- `A capture bundle has the wrong shard.`
- `A capture bundle has no discovery record. Set the discovery option of the reporter.`
- The digest message above.

Before:

```yaml
env:
  VISONAUT_PACKAGE_SHA256: ${{ vars.VISONAUT_PACKAGE_SHA256 }}
  VISONAUT_WORKFLOW_SOURCE_SHA: ${{ vars.VISONAUT_WORKFLOW_SOURCE_SHA }}
  VISONAUT_CAPTURE_JOB_NAME: "App / Visual Capture ({shard})"
  VISONAUT_SUBMIT_JOB_NAME: "App / Visual Submit"
```

After:

```yaml
env:
  VISONAUT_CAPTURE_JOB_NAME: "App / Visual Capture ({shard})"
  VISONAUT_SUBMIT_JOB_NAME: "App / Visual Submit"
```
