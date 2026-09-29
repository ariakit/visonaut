# Image comparison

This private package validates static 8-bit PNG and lossless WebP. It retains exact original bytes. It decodes a separate PNG buffer with color and text metadata removed after validation. The source image remains unchanged.

```ts
const image = await validateImage(uploadBytes);
const pixels = await decodeImage(image, codecs);
// Only now can the service register image.original as a validated public image.
const result = compareImages(referencePixels, pixels, trustedPolicy);
```

`validateImage` checks the container and limits. `decodeImage` must also succeed before image registration. The WebP decoder checks the compressed bitstream. Callers must obtain policies from trusted service configuration.

The package accepts unprofiled sRGB, PNG sRGB markers with the conventional sRGB gamma/chromaticity values, and the exact Chromium sRGB ICC profile found in Ariakit's corpus. The profile SHA-256 is `12afb4d9953adee0607d347daee5b78b18d6b3cab2d572b88970703f5edb37bc`. It also accepts WebKit's exact EXIF layout with only an sRGB color-space code and matching pixel dimensions. Unknown profiles, alternate color/orientation metadata, animation, lossy WebP, and non-8-bit PNG fail with a specific error. The PNG validator checks every chunk CRC and the bounded zlib stream because the pinned PNG decoder ignores checksums. PNG metadata never reaches the decoder.

The comparator uses integer RGBA composites on black and white. This detects visible alpha changes and ignores hidden RGB under zero alpha. The comparator counts visible differences before allocating a review mask. An unchanged or tolerated pair returns `mask: null`. A changed pair makes a second pass; its red mask is transparent at unchanged pixels. A size change always produces a change and a solid red mask at candidate dimensions. Thumbnails use nearest-neighbor sampling and are never baselines.

No default tolerance is implicit. `selectedComparisonPolicy` records the current 0.0005 ratio selection with no absolute pixel cap for trusted service configuration; it does not switch a live project. The [policy record](../../docs/evidence/comparator-policy.md) explains its scope and transition. The earlier study compares exact visible pixels with a one-level channel tolerance and the same ratio rule under an older policy ID. Its [report](./evidence/corpus-study.json) records the corpus digest and measured results. Exact comparison detected all 100 injected defects. The one-level tolerance missed 50; the ratio allowance missed 98. The selected policy has not been rerun on those private originals. Deployed Worker resource tests remain a separate readiness requirement.

```sh
pnpm --filter @visonaut/compare test
pnpm --filter @visonaut/compare study /path/to/ariakit
```

The study reads the Ariakit checkout. It does not change its screenshots. Current resource limits are provisional: 2 MiB encoded bytes, 2.1 million decoded pixels, dimension 8192, 64 KiB profile data, and 1024 PNG chunks. The existing corpus fits these bounds. Deployed memory/CPU evidence must confirm the bounds before launch.

Dependencies are pinned to `@jsquash/png@3.1.1` and `@jsquash/webp@1.5.0`. These packages provide browser/Worker WASM codecs. The service imports precompiled WASM and never compiles request bytes. The optional `wasmMemoryBytes` metric measures linear WASM memory only; it is not peak isolate memory.

References: [jSquash Worker example](https://github.com/jamsinclair/jSquash/blob/main/examples/cloudflare-worker-esm-format/src/index.js), [PNG decoder source](https://github.com/jamsinclair/jSquash/blob/main/packages/png/codec/src/lib.rs), [PNG specification](https://www.w3.org/TR/png-3/), [WebP container specification](https://developers.google.com/speed/webp/docs/riff_container), and [Workers resource limits](https://developers.cloudflare.com/workers/platform/limits/).

The six-pixel PNG/WebP fixtures were generated for this package. The ICC fixture is the embedded profile from Ariakit's screenshot corpus. It is used without modification to test exact profile recognition and retains its embedded copyright, Google Inc. 2016.

[The two-pass study](./evidence/two-pass-mask-study.json) compares the selected implementation with source commit [`7e23173`](https://github.com/ariakit/visonaut/commit/7e23173d11b1081f55021ef498e4c5c6d6a08131) on equal, tolerated, sparse-change, dense-change, and dimension-change pairs at the 2.1-million-pixel limit. It checks every summary field and exact changed-mask bytes before measuring CPU. Returned mask bytes measure the explicit allocation, not peak memory. Decoding, PNG encoding, R2, D1, and hosted Worker CPU are outside this study.

```ts
const result = compareImages(referencePixels, candidatePixels, trustedPolicy);
if (result.outcome === "changed") {
  await codecs.encodePng(result.mask);
}
```

To repeat the study, save the prior comparator source beside its `types.ts` module, then pass that module path and an output JSON path to `scripts/mask-study.ts`. Remove the temporary source after measurement. There is no second comparator in production.

```sh
node --expose-gc --experimental-strip-types packages/compare/scripts/mask-study.ts /absolute/path/to/prior-compare.ts /tmp/mask-study.json
```
