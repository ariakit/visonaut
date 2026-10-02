---
"visonaut": minor
---

Native Plan skips and exact capture job names

Use [`visonaut submit --no-visual`](https://github.com/ariakit/visonaut/blob/main/packages/cli/README.md) in the native CI Plan job when its successful calculator says that visual capture is unnecessary. The command sends the signed false result without capture artifacts or upload credentials.

**BREAKING** if your capture workflow sets `VISONAUT_CAPTURE_JOB_PREFIX`. Pinned capture workflows now supply one complete job name template through `VISONAUT_CAPTURE_JOB_NAME`. Replace the old prefix setting with a template that contains one `{shard}` slot. `VISONAUT_SUBMIT_JOB_NAME` continues to hold the exact Submit name.

Before:

```yaml
VISONAUT_CAPTURE_JOB_PREFIX: "App / Visual capture / "
```

After:

```yaml
VISONAUT_CAPTURE_JOB_NAME: "App / Visual Capture ({shard})"
VISONAUT_SUBMIT_JOB_NAME: "App / Visual Submit"
```
