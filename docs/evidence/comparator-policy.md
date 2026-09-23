# Selected comparator policy

Selected on September 22, 2026 under the user's authorization to select and document measured limits for [issue #1](https://github.com/ariakit/ariviso/issues/1). This decision selects comparison tolerance. It does not mark the complete capture, memory, cost, or launch gates as passed.

Use the following immutable trusted service policy:

```json
{
  "id": "visible-exact-v1",
  "channelThreshold": 0,
  "maxChangedPixels": 0,
  "maxChangedRatio": 0
}
```

The comparator measures visible integer RGBA composites on both black and white backgrounds. Fully transparent hidden RGB does not count as a visible change. A dimension change always needs review. The service owns the effective policy and masks; a pull request cannot change its own tolerance. Preserve policy and codec identities with each immutable comparison revision.

## Measured tradeoff

The [injected-defect study](../../packages/compare/evidence/corpus-study.json) tests four defect types across 25 historical images: a one-level change, one changed pixel, a missing stroke, and an alpha change. The [actual Ariakit matrix](./ariakit-capture-measurement/README.md) contains three full passes across the current 3,582 authored captures, with three pair comparisons per capture. It ran on one runner per browser. Exact captured originals and profiles were validated with the service comparator locally; this was not hosted comparator execution or a trusted upload test.

| Policy                        | Injected defects missed, out of 100 | Changed repeated-capture pairs, out of 10,746 | Visible changed pixels |
| ----------------------------- | ----------------------------------: | --------------------------------------------: | ---------------------: |
| Exact visible pixels          |                                   0 |                                            12 |                     86 |
| One-level channel tolerance   |                                  50 |                                             8 |                     70 |
| Prior ratio allowance, 0.0005 |                                  98 |                                             0 |                     86 |

All repeated-capture differences occurred in Chromium. Firefox and WebKit matched exactly. The source and capture configuration were unchanged within each browser's three passes. The locations suggest capture variation around rounded input and checkbox edges, but this is an inference, not proof that every changed pixel is harmless. The ratio policy classified all repeated pairs as unchanged while still counting the 86 changed pixels.

Select exact visible comparison because the alternatives missed known small defects and only removed a small number of observed changed pairs. The operator must review the remaining differences. These samples do not establish a production false-positive rate, a fresh-runner noise rate, or sensitivity to every possible defect. Four completed PNG attachments from failed Firefox attempts remain in the encrypted evidence; successful retries supply the selected final captures.

## Scope and change control

The current authored invocation is 3,582 captures. The design's approximately 10,580 captures and the separate tenfold 35,820 scenario are expanded workload cases. They are not additional distinct tests measured by this capture study.

Zero visible tolerance does not permit a sequence of tolerated visible changes to move the baseline. Human acceptance can change the accepted bytes through the normal review and promotion rules. A later policy change needs an explicit new identity and measured rationale; it must not silently turn an existing failed comparison green.

Encoded-byte, decoded-pixel, CPU, peak-memory, latency, admission, and cost bounds remain separate decisions. The provisional decoder limits must not be reported as final solely because these captured images fit them. E01 stays partial until the runtime and peak-memory requirements are met.
