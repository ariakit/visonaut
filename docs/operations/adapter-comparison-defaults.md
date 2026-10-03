# Public adapter comparison defaults

This record describes the earlier compatibility preparation. The [strict adapter preparation](strict-adapter-comparison-defaults.md) records the later breaking source and its release hold.

This is the compatibility stage of issue #204 D07/W05. The adapter source accepts `project.metadata.visonaut.comparisonDefaults` beside `profile`. Explicit defaults, including `{}`, bypass private screenshot inheritance. Missing defaults retain the tested Playwright `1.63.0` fallback for unchanged consumers. The compatible changeset is prepared; no package publication, consumer change, deployment, or final private-field retirement is proved by this record.

```ts
const comparisonDefaults = { threshold: 0.2, maxDiffPixels: 0 };
export default defineConfig({
  expect: { toHaveScreenshot: comparisonDefaults },
  metadata: { visonaut: { profile, comparisonDefaults } },
});
```

Only own comparison fields count. Project defaults, batch options, and image options apply in that order. Explicit `undefined` clears a setting; a cleared threshold returns to `0.2`, and clearing both pixel caps allows zero changed pixels. Both caps still apply when present. Comparison settings stay separate from rendering profiles, comparison engine identity, and codec identity. Two consecutive identical images are still required before capture can complete.

## Prepared Ariakit configuration

The [configuration patch](ariakit-comparison-defaults.patch) targets Ariakit source [`c3846e9`](https://github.com/ariakit/ariakit/commit/c3846e9bf542f4cd08fb4b2f746a94c0587c7238), read on 2026-10-02. It changes only `app/playwright.config.ts`. That file and `app/src/test-utils/visual.ts` specify no threshold or pixel cap, so their effective existing policy is `threshold: 0.2` and `maxDiffPixels: 0`. The patch shares those exact values between `expect.toHaveScreenshot` and the existing visual-project metadata. It does not change capture helpers, projects, geometry, workflow pins, or screenshot tolerances. The separate website configuration's `maxDiffPixelRatio: 0.05` does not supply the app's Visonaut captures.

The patch passes `git apply --check` against that exact source snapshot. This is local source evidence, not consumer adoption. Apply it only after the compatible adapter release is available and the current consumer source has been reviewed again. Install the verified exact adapter version and regenerate the consumer lockfile through its normal package manager. The existing consumer uses adapter `0.4.0`; the new patch requires the compatible release. Do not fabricate the unpublished package integrity or edit the consumer repository in this Visonaut task.

## Release order and final hold

1. Review and merge the compatible adapter source, its capture evidence, and `.changeset/200-public-comparison-defaults.md`. The v0 feature uses a patch changeset and keeps the exact Playwright `1.63.0` peer. Package publication requires a separate instruction.
2. Publish and verify the compatible version through the approved release workflow. Recheck the prepared consumer patch, install that version, and test real captures and manifests through the consumer's existing jobs. Consumer changes require a separate instruction.
3. Verify adoption by every supported consumer identified by W03. A source patch, one consumer, or an unknown inventory does not establish complete adoption. Keep the tested compatibility fallback while that evidence is missing.
4. Prepare the declared breaking release. Require an explicit `comparisonDefaults` object, including `{}` for the built-in policy. Missing configuration must fail with a clear setup error. Remove the private `_projectInternal` reader only in that release after the adoption gate passes.

The final D07 private-field retirement remains **held**. The public API has a compatibility bridge in this stage. Do not widen the Playwright peer range, relabel old receipts, or mark W05's final removal complete from compatible source alone. Retain the reviewed adapter/consumer pair as rollback material; do not restore a bridge for an untested Playwright version.

## Local validation

The adapter's real-browser client harness exercises explicit defaults, batch and image overrides, explicit `undefined`, both caps, `{}` without the private field, missing configuration through the pinned bridge, inherited and non-enumerable properties, and malformed explicit configuration. Manifests preserve rendering identity across policy changes. The existing stable-image rejection case now uses permissive explicit comparison defaults, so tolerance cannot admit continuously changing pixels. The worker/comparator tests retain the pinned Playwright oracle for cap and threshold semantics.

Build the public adapter and CLI before running the package smoke check. Packed archives verify runtime files, declarations, exports, and dependency independence. Record the final commands and results in the implementation handoff. A packed local archive is not publication proof or verified consumer adoption.

Local adapter capture and manifest tests, CLI comparison regressions, adapter type checks, public package builds, lint, and the repository's packed-package smoke passed. The new public-default checks fail against the old reader and pass after the saved implementation is restored. The prepared Ariakit configuration also passed a local packed-adapter check in its macOS Safari project: a synthetic direct capture and batch capture both recorded the unchanged `threshold: 0.2` and `maxDiffPixels: 0` policy, and the packed public `ComparisonOptions` type compiled. That harness replaced application servers and used a synthetic page. It does not establish a full Ariakit build or CI result, the future release version, publication, or adoption.
