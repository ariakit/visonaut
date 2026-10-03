# Strict adapter comparison defaults

This is local preparation of the final issue #204 D07/W05 breaking adapter source. It requires public `visonaut` and `comparisonDefaults` objects as own properties in `project.metadata`. It removes the private Playwright screenshot-default reader. The published compatible adapter `0.4.1` retains its bridge. This source preparation does not prove consumer adoption or final retirement in the live system.

```ts
const comparisonDefaults = { threshold: 0.2, maxDiffPixels: 0 };
export default defineConfig({
  expect: { toHaveScreenshot: comparisonDefaults },
  metadata: { visonaut: { profile, comparisonDefaults } },
});
```

Missing or inherited public configuration fails with a clear setup error, even when a capture supplies all comparison settings. An explicit `{}` selects threshold `0.2` and zero allowed pixels. Invalid explicit defaults also fail before overrides can hide them. Only own comparison fields count, including non-enumerable fields. Project, batch, and image precedence, explicit `undefined` clearing, both pixel caps, and the requirement for consecutive identical images stay the same.

The breaking changeset uses `minor` because the adapter is in v0. From the current package version `0.4.1`, it prepares `0.5.0` through the normal Changesets release process. This branch does not manually change the package version or changelog. The exact Playwright peer remains `1.63.0`. Comparison engine, codec, manifest, rendering-profile, and signature contracts do not change.

## Adoption and release hold

The service trust-pin change and the Ariakit compatible-adapter adoption patch remain separate from this branch. Preserve their reviewed commits and rollout packet. Do not substitute this unpublished strict adapter for the compatible package in that pair.

Before release, the parent must verify public-default adoption by every supported consumer identified by W03. A prepared consumer patch or local capture evidence does not meet that gate. Each consumer must preserve its effective comparison settings; `{}` must not silently replace permissive tolerances. Keep the verified compatible adapter and its service/consumer rollback records available.

This preparation authorizes local source, tests, documentation, package checks, internal review, and a local commit only. Push, PR creation, merge, versioning, package publication, deployment, provider changes, GitHub variable or CI writes, and consumer changes remain held for the parent and separate approval. Final D07/W05 retirement stays held until adoption is verified and the breaking release is approved and verified.

## Validation scope

The local regression checks cover required public defaults, explicit `{}`, malformed defaults, project/batch/image precedence, explicit clearing, and both pixel limits through the public adapter and reporter. The exact Playwright comparator remains the oracle for threshold and cap semantics. Missing configuration cannot produce a successful manifest.

Build, type, lint, and packed-package export checks apply to this source snapshot. Earlier exact capture evidence can support unchanged image, helper, profile, codec, and manifest behavior. It does not prove the new missing-default contract, the future published `0.5.0` archive, or consumer adoption. Keep command results, the exact reviewed tree, the complete patch, planned PR metadata, and release holds in the local handoff outside Git.
