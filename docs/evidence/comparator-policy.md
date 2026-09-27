# Selected comparator policy

The original policy was selected on September 22, 2026 for [issue #1](https://github.com/ariakit/visonaut/issues/1). On September 27, the user selected a percentage-only tolerance after Ariakit main captures showed small edge differences. The latest [grouped input focus comparison](https://visonaut.com/runs/e4cea8de-56ec-4347-932a-5e91e0c7ab3c?item=ariakit-ui-input%2Fgrouped-focus%2Faction&variant=react-chrome-desktop-dark-dark-no-preference-none) differed at four of 67,392 pixels. This record replaces the selected two-pixel policy. It does not mark capture, memory, cost, or launch gates as passed. The production project and trusted capture configuration have not been switched by this change.

Use this immutable trusted service policy for the next controlled policy transition:

```json
{
  "id": "visible-ratio-v3",
  "channelThreshold": 0,
  "maxChangedRatio": 0.0005
}
```

The canonical JSON SHA-256 policy digest is `6a97812c0ad3a5e8e006904995e75f8f15671260fb2ee53d31a1527c7d990fd1`. The exported `selectedComparisonPolicy` in `packages/compare/src/compare.ts` contains the same values. The 0.0005 ratio allows changed visible pixels in at most 0.05% of the image area, regardless of their color difference. Four pixels out of 67,392 have a ratio of about 0.00005935 (0.005935%), so this policy classifies that pair as unchanged when its dimensions and capture profile match. At those dimensions, 33 changed pixels pass and 34 require review. A one-pixel difference in an image smaller than 2,000 pixels still needs review.

The comparator measures visible integer RGBA composites on black and white backgrounds. Fully transparent hidden RGB does not count as a visible change. `channelThreshold: 0` keeps every visible one-level change in the changed-pixel count and red mask. A dimension change always needs review. The ratio applies to full-page captures too: a 1,000-by-1,000 image can differ by 500 pixels without review, including a 16-pixel missing stroke. Ariakit's former Playwright helper used the same 0.0005 ratio for ordinary captures but zero allowance for captures larger than the viewport; this selection changes that exception.

## Evidence and tradeoff

The [injected-defect study](../../packages/compare/evidence/corpus-study.json) tested four defect types across 25 historical images. The [repeated Ariakit matrix](./ariakit-capture-measurement/README.md) compared three complete passes of 3,582 authored captures. The injected-defect study recorded `channelThreshold: 0`, `maxChangedRatio: 0.0005`, and a `maxChangedPixels` value of `Number.MAX_SAFE_INTEGER`. That pixel limit had no effect within the comparator's image limits, so the study exercised the same ratio rule as this selection. The repeated matrix also used a 0.0005 ratio reference. Neither study evaluated the current live run.

| Studied policy                 | Injected defects missed, out of 100 | Changed repeated-capture pairs, out of 10,746 |
| ------------------------------ | ----------------------------------: | --------------------------------------------: |
| Exact visible pixels           |                                   0 |                                            12 |
| One-level channel tolerance    |                                  50 |                                             8 |
| Former ratio allowance, 0.0005 |                                  98 |                                             0 |

All repeated-capture differences occurred in Chromium. Their locations suggest capture variation around rounded input and checkbox edges, but that is an inference. The selected ratio tolerated all 12 repeated-capture differences, but it also missed 98 of 100 injected defects in the study. It can miss an intentional change even when the changed color is strong; the allowed pixel count grows with image area. The repeated matrix does not establish a production false-positive rate. The prior study and its raw evidence remain unchanged.

## Policy transition and stored history

The service stores the policy digest in each immutable comparison and exact acceptance tuple. Earlier failed or approved comparisons keep their original policy and outcome. A new policy needs its own registered ID and digest, then a new comparison; updating the policy document or code constant alone does not change an existing result.

Capture profiles also include the policy digest. On a new live comparison, the service permits an unchanged pixel result across old and new profile digests only after it verifies both stored profile records, checks that the candidate names the new comparison policy, and confirms that every rendering field is equal. A font, browser, viewport, capture-option, or engine change still needs review. Historical recomparisons of stored runs remain read-only and use their immutable captured originals and the comparison policy recorded for that new revision. This permits the 1,058 existing Ariakit variants to meet a new policy without a policy-only mass review while preserving real image and environment changes for review.

The live switch must register the new policy and align the trusted capture policy digest with the project policy during a controlled transition. Existing comparisons in flight must finish or be invalidated before the project policy changes. This work does not update the live project record or deploy a new capture configuration.

The pinned diagnostics Container image still requires `maxChangedPixels` in its request. The Worker adds `Number.MAX_SAFE_INTEGER` only to the Container request when the stored policy omits a pixel cap. This value exceeds the 2.1 million-pixel image limit, so the Container applies the same ratio rule. The registered policy, its digest, and the comparison record remain percentage-only.
