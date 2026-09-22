# Repeated Ariakit capture measurements

Three complete invocations of the current Ariakit desktop visual suite produced 10,746 selected captures. The hosted capture workflow completed, and the separate historical local audit validated all selected PNGs with the exact recorded service validator and WASM codecs. This closes the actual-matrix capture measurement gap. It does not establish trusted Ariviso uploads, hosted comparator performance, or authoritative Worker peak memory.

[PR 7583](https://github.com/ariakit/ariakit/pull/7583) and [run 35738622418](https://github.com/ariakit/ariakit/actions/runs/35738622418) used tested merge [`5a1e137`](https://github.com/ariakit/ariakit/commit/5a1e13790a21658179475a52257eed178a192049), from reviewed head [`e54ebc3`](https://github.com/ariakit/ariakit/commit/e54ebc3491e06e273f64120f2b383a2b3b22c04e). The workflow used `contents: read`, one build, and three separate Playwright processes per browser. It preserved the trusted workflows, pins, plan, and profile allowlists. It made no OIDC or Ariviso service requests.

## Recorded measurements

| Browser  | Platform     | Tests per pass | Captures per pass | Pass times, seconds               | Failed attempts |
| -------- | ------------ | -------------: | ----------------: | --------------------------------- | --------------- |
| Chromium | Ubuntu 24.04 |            106 |             1,230 | 661.586 / 655.640 / 655.095       | 0 / 0 / 0       |
| Firefox  | Ubuntu 24.04 |            106 |             1,230 | 374.854 / 375.600 / 383.481       | 1 / 1 / 2       |
| WebKit   | macOS 15     |             95 |             1,122 | 1,295.702 / 1,182.029 / 1,164.525 | 0 / 0 / 0       |

All final tests passed. Each browser retained the same inventory, profile identities, and dimensions across its three passes. Firefox had four recovered 120-second timeout attempts. Four completed PNGs from those failed attempts remain in the private evidence; all selected captures came from the last successful attempt. An earlier audit read the wrong blob field and said the failed attempts had no captures. That claim is withdrawn. The corrected attempt receipts and full independent audit preserve the four failed PNGs. The underlying timeout cause remains unknown.

The historical local audit checked every one of the 10,750 capture markers against its PNG attachment, including the four failed-attempt PNGs. It verified 10,746 selected original payloads, profile digests, and unchanged original encoded bytes before and after service decoding. Chromium and Firefox used `srgb-unprofiled-v1`; WebKit used `srgb-explicit-v1`.

| Comparison policy                                 | Changed image pairs | Changed pixels |
| ------------------------------------------------- | ------------------: | -------------: |
| `visible-exact-v1`: channel 0, pixels 0, ratio 0  |                  12 |             86 |
| One-level channel threshold, pixels 0, ratio 0    |                   8 |             70 |
| Previous ratio reference: channel 0, ratio 0.0005 |                   0 |             86 |

There were 10,746 pair comparisons: pass 1 to 2, 2 to 3, and 1 to 3 for each browser. These pairs share images. All differences were in Chromium; Firefox and WebKit were exact. The ratio policy records changed pixels while accepting the pair as unchanged. Six Chromium identities varied. Private pixel inspection found small focus-edge, checkbox-edge, and corner differences. Rendering noise is an inference from the unchanged source and pixel locations, not a general guarantee that such changes are harmless.

The separate intentional-defect study in [corpus-study.json](../../../packages/compare/evidence/corpus-study.json) contains 100 small defects. Strict comparison missed none; the one-level policy missed 50; the previous ratio reference missed 98. The real captures were not altered for that study. The conservative recommendation retains the strict policy and accepts the measured review burden:

```json
{ "channelThreshold": 0, "maxChangedPixels": 0, "maxChangedRatio": 0 }
```

All three invocations for a browser used the same runner job. Variation across fresh runners and future image updates remains unmeasured. Local Node 24.18.0 CPU, RSS, and WASM measurements are not Cloudflare Worker CPU or authoritative peak memory. PNG checks do not replace the separate lossless WebP, alpha, color, corrupt-file, dimension-limit, and tolerated-drift evidence.

## Workload and source scope

A full pass contained 307 tests and 3,582 split captures. Pass 1 had 62,898,893 encoded bytes: mean 17,559.71, p95 41,137, maximum 210,157 bytes per capture. Its 510,234,282 pixels gave a mean of 142,443.96 and maximum of 1,547,520 pixels per capture. The 3,491 distinct encoded digests totaled 60,876,246 bytes; duplicate captures still count toward the workload.

The [scope report](./SCOPE.md) accounts for all current upstream desktop `@visual` tests and explains why the issue's 10,580-capture target and the 35,820-capture stress scenario remain separate capacity workloads. These measured distributions may inform those models. They do not prove their capacity or enumerate that many authored states.

## Frozen record and portable verification

The [frozen package](../../../tooling/evidence/ariakit-capture-measurement/README.md) preserves all 27 original report, receipt, and script files plus their original `HASHES.json`, unchanged. Historical scripts retain their original paths and formatting inside the archive. No formatter exception was added. The [input manifest](../../../tooling/evidence/ariakit-capture-measurement/INPUTS.json) records exact archive and original-manifest identities.

Run the portable check with Python 3.9 or later and a new output directory outside the repository:

```sh
python3 -B tooling/evidence/ariakit-capture-measurement/verify.py \
  --out /private/tmp/ariviso-capture-evidence-check
```

This new wrapper checks the archive, original file hashes, saved source identities, and consistency of recorded counts. It extracts only the exact verified files and writes `VERIFICATION.json`. It does not execute the archived analysis or rehash omitted private images, encrypted archives, codec binaries, source bodies, or the raw upstream inventory. Its result is a local receipt-consistency check. The separate historical independent audit used those private originals and the recorded runtime; its saved receipt is evidence of that earlier audit, not a new execution by this wrapper. Recorded quantiles and digest deduplication are not recalculated from omitted images.

The measurement workflow retained encrypted raw screenshots, profiles, attempts, logs, and traces; its private key remains local and is omitted here. A separate unchanged legacy probe briefly published raw environment artifacts. Those three artifacts were preserved privately and deleted from GitHub. Do not infer that the legacy probe profiles were always private. This package contains aggregate reports and hashes, with no raw screenshots, secret keys, or capture identities.
