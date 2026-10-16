---
"@visonaut/playwright": patch
---

Captures can accept the first screenshot when an earlier capture has the same image

Set `VISONAUT_PREVIOUS_CAPTURE` to the directory of an earlier capture bundle, for example the capture artifact of the base commit. When the first screenshot of [`visual`](https://github.com/ariakit/visonaut/blob/main/packages/playwright/README.md) has the image digest that the bundle's `manifest.json` records for the same item and variant, the capture accepts it with no second screenshot and no wait. [`visualBatch`](https://github.com/ariakit/visonaut/blob/main/packages/playwright/README.md) accepts its first full-page screenshot only when each crop has its digest.

```sh
VISONAUT_PREVIOUS_CAPTURE="$RUNNER_TEMP/visonaut-previous" npx playwright test
```

Each other case waits for two consecutive equal screenshots as before: an item or variant with no capture in the bundle, a different digest, and a bundle that is missing, has a manifest above 8 MiB, or is not readable by this release. An unusable bundle writes one warning and never fails a capture. A capture that accepts its first screenshot records the same digest that two equal screenshots of that image give. A render that changes after a matching first screenshot is not seen; the stability loop sees it when it shows before the second screenshot.
