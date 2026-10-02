---
"visonaut": minor
"@visonaut/playwright": minor
---

One verified capture submission path

**BREAKING** if your workflow uses the encrypted capture transport, the renderer binary, or direct upload commands. Use normal Playwright jobs and one signed Submit job with ordinary one-day capture artifacts. The CLI now verifies the complete required job set, source attempts, rendering profiles, and image hashes before it submits. A missing inherited artifact requires a full visual rerun.

Before:

```sh
visonaut pack --dir "$RUNNER_TEMP/visonaut" --output capture.enc
visonaut submit --bundle linux=linux.enc --bundle safari=safari.enc
```

After:

```sh
# Candidate jobs upload their complete capture directory for one day.
visonaut submit --shard linux --shard safari
```

Import rendering environment measurement from `@visonaut/playwright/environment`. Rendering profiles no longer include comparison policy or engine settings. The old `@visonaut/playwright/ci` export and `visonaut-capture` binary are removed. Capture image attachments use private files outside diagnostic artifacts and the reporter removes them after each run.
