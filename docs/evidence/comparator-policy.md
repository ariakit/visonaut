# Selected comparator policy

The original policy was selected on September 22, 2026 for [issue #1](https://github.com/ariakit/visonaut/issues/1). On September 27, the user requested a conservative tolerance after an Ariakit main capture differed at two of 179,280 pixels by one or two color levels. This record replaces the selected exact policy. It does not mark capture, memory, cost, or launch gates as passed. The production project and trusted capture configuration have not been switched by this change.

Use this immutable trusted service policy for the next controlled policy transition:

```json
{
  "id": "visible-two-pixel-v2",
  "channelThreshold": 0,
  "maxChangedPixels": 2,
  "maxChangedRatio": 0.0005
}
```

The canonical JSON SHA-256 policy digest is `9c4627104b4af7760a2891bd897dded9a5b449a68c1d7931e04d45fcca49c4bd`. The exported `selectedComparisonPolicy` in `packages/compare/src/compare.ts` contains the same values. A result is unchanged only when **both** the changed-pixel count is at most 2 and its ratio is at most 0.0005. The reported pair has a ratio of about 0.0000112, so it is within both limits. A one-pixel difference in an image smaller than 2,000 pixels still needs review. A three-pixel difference needs review at every image size.

The comparator measures visible integer RGBA composites on black and white backgrounds. Fully transparent hidden RGB does not count as a visible change. `channelThreshold: 0` keeps every visible one-level change in the changed-pixel count and red mask. A dimension change always needs review. A 16-pixel missing stroke on a large full-page image also exceeds the absolute cap. The two-pixel cap applies to full-page captures too. Ariakit's former Playwright helper used the same 0.0005 ratio for ordinary captures but zero allowance for captures larger than the viewport; this selection deliberately changes that exception.

## Evidence and tradeoff

The [injected-defect study](../../packages/compare/evidence/corpus-study.json) tested four defect types across 25 historical images. The [repeated Ariakit matrix](./ariakit-capture-measurement/README.md) compared three complete passes of 3,582 authored captures. These older studies tested exact visible pixels, a one-level channel tolerance, and the former unbounded 0.0005 ratio. They did not evaluate this new two-pixel cap against the private originals.

| Studied policy                 | Injected defects missed, out of 100 | Changed repeated-capture pairs, out of 10,746 |
| ------------------------------ | ----------------------------------: | --------------------------------------------: |
| Exact visible pixels           |                                   0 |                                            12 |
| One-level channel tolerance    |                                  50 |                                             8 |
| Former ratio allowance, 0.0005 |                                  98 |                                             0 |

All repeated-capture differences occurred in Chromium. Their locations suggest capture variation around rounded input and checkbox edges, but that is an inference. The new policy is narrower than the former ratio-only policy starting at 6,000 pixels, where the former ratio allows three changed pixels. It can still miss an intentional one- or two-pixel defect, even when the changed color is strong. The selected cap trades that small blind spot for avoiding the reported two-pixel review. It does not establish how many of the 12 historical repeated pairs would be tolerated or a production false-positive rate. The prior study and its raw evidence remain unchanged.

## Policy transition and stored history

The service stores the policy digest in each immutable comparison and exact acceptance tuple. Earlier failed or approved comparisons keep their original policy and outcome. A new policy needs its own registered ID and digest, then a new comparison; updating the policy document or code constant alone does not change an existing result.

Capture profiles also include the policy digest. On a new live comparison, the service permits an unchanged pixel result across old and new profile digests only after it verifies both stored profile records, checks that the candidate names the new comparison policy, and confirms that every rendering field is equal. A font, browser, viewport, capture-option, or engine change still needs review. Historical recomparisons of stored runs remain read-only and use their immutable captured originals and the comparison policy recorded for that new revision. This permits the 1,058 existing Ariakit variants to meet a new policy without a policy-only mass review while preserving real image and environment changes for review.

The live switch must register the new policy and align the trusted capture policy digest with the project policy during a controlled transition. Existing comparisons in flight must finish or be invalidated before the project policy changes. This work does not update the live project record or deploy a new capture configuration.
