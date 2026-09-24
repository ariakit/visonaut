---
"@visonaut/playwright": minor
"visonaut": minor
---

Use existing visual jobs for Visonaut capture

**BREAKING** Workflows that use `visonaut-capture upload` must move packing to the visual job and use the Visonaut CLI in the signed job.

Before:

```sh
visonaut-capture upload --shard linux \
  --comparison-policy-digest "$POLICY" --bundle-sha256 "$ADAPTER_SHA" \
  --input "$RUNNER_TEMP/visonaut-linux.enc" --output-directory "$RUNNER_TEMP/visonaut-upload"
```

After:

```sh
pnpm exec visonaut pack --dir "$RUNNER_TEMP/visonaut-linux" --output "$RUNNER_TEMP/visonaut-linux.enc"
pnpm exec visonaut upload --bundle "$RUNNER_TEMP/visonaut-linux.enc"
```

Run `pack` in the unsigned visual job after the [Playwright reporter](../packages/playwright/README.md#workflow-capture) writes its captures. Run `upload --bundle` in a separate signed job. The reporter now accepts Chrome and Firefox in one visual job. Diagnostic workflows can still use `visonaut-capture render`.
