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

The comparator uses integer RGBA composites on black and white. This detects visible alpha changes and ignores hidden RGB under zero alpha. Its red mask is transparent at unchanged pixels. A size change always produces a change and a solid red mask at candidate dimensions. Thumbnails use nearest-neighbor sampling and are never baselines.

No default tolerance is implicit. The study compares exact visible pixels with a one-level channel tolerance and the prior ratio allowance. The report in [evidence/corpus-study.json](./evidence/corpus-study.json) records the corpus digest and measured results. Exact comparison detected all 100 injected defects. The one-level tolerance missed 50; the prior ratio allowance missed 98. Exact comparison also flagged synthetic antialias changes. Real repeated browser capture noise, the split capture workload, and deployed Worker resource tests remain separate readiness requirements.

```sh
pnpm --filter @visonaut/compare test
pnpm --filter @visonaut/compare study /path/to/ariakit
```

The study reads the Ariakit checkout. It does not change its screenshots. Current resource limits are provisional: 2 MiB encoded bytes, 2.1 million decoded pixels, dimension 8192, 64 KiB profile data, and 1024 PNG chunks. The existing corpus fits these bounds. Deployed memory/CPU evidence must confirm the bounds before launch.

Dependencies are pinned to `@jsquash/png@3.1.1` and `@jsquash/webp@1.5.0`. These packages provide browser/Worker WASM codecs. The service imports precompiled WASM and never compiles request bytes. The optional `wasmMemoryBytes` metric measures linear WASM memory only; it is not peak isolate memory.

References: [jSquash Worker example](https://github.com/jamsinclair/jSquash/blob/main/examples/cloudflare-worker-esm-format/src/index.js), [PNG decoder source](https://github.com/jamsinclair/jSquash/blob/main/packages/png/codec/src/lib.rs), [PNG specification](https://www.w3.org/TR/png-3/), [WebP container specification](https://developers.google.com/speed/webp/docs/riff_container), and [Workers resource limits](https://developers.cloudflare.com/workers/platform/limits/).

The six-pixel PNG/WebP fixtures were generated for this package. The ICC fixture is the embedded profile from Ariakit's screenshot corpus. It is used without modification to test exact profile recognition and retains its embedded copyright, Google Inc. 2016.
