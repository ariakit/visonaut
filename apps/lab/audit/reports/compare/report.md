# Comparison Worker, container, and compare package

Audited source: [`f83fef6`](https://github.com/ariakit/visonaut/commit/f83fef6bfcaeb44ad0ed8fa91d5ae6cd4a1ecc90) in the worktree `serialized-dazzling-pixel`. All paths are relative to the repository root. This audit changed no repository file and ran no remote command.

## How it works (map)

### The parts

| Part                        | Files                                                                                    | What it is                                                                                                                                                                     |
| --------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `visonaut-compare` Worker   | `apps/compare/src/index.ts`, `validate.ts`, `capacity.ts`, `codecs.ts`, `wrangler.jsonc` | A fetch-only Worker. Its only route is `POST /validate`. It has no queue handler, no cron, and no Durable Object (`index.ts:4-8`).                                             |
| Legacy task processor       | `apps/compare/src/process.ts`                                                            | The old queue task body (`processComparisonTask`). No handler imports it.                                                                                                      |
| Codec probe Worker          | `apps/compare/src/probe.ts`, `probe-auth.ts`, `wrangler.probe.jsonc`                     | A token-protected diagnostic `POST /probe`.                                                                                                                                    |
| Container probe             | `apps/compare/container/*`, `wrangler.container-probe.jsonc`, root `.dockerignore`       | A token-protected diagnostic Worker in front of a sharp/libvips Container. `transport.ts` is used by a local test only.                                                        |
| `@visonaut/compare` package | `packages/compare/src/*`                                                                 | Validators (`image.ts`, `png.ts`, `webp.ts`, `binary.ts`, `exif.ts`, `profile.ts`, `types.ts`), the legacy RGBA engine (`compare.ts`), and the jSquash adapter (`jsquash.ts`). |
| Research record             | `packages/compare/scripts/*` (518 lines), `packages/compare/evidence/*` (544 KB)         | Study scripts and dated measurements.                                                                                                                                          |

### What is in the production path today

| Code                                                                                                                | Status                                           | Reached from                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `validateImage`, `inspectPng`, `binary.ts`, `exif.ts`, `profile.ts`                                                 | Production                                       | The published CLI bundles the package (`packages/cli/tsup.config.ts:14`). Trusted Submit calls it for each capture and each changed reference (`packages/cli/src/png-comparison.ts:15`). |
| `imageLimits`, `assertDimensions`                                                                                   | Production                                       | Web Worker: `apps/web/src/runtime.ts:109`, `apps/web/src/api/local-comparison.ts:548`. CLI: `packages/cli/src/local-comparison.ts:72-81`, `png-comparison.ts:98`.                        |
| `inspectWebp`                                                                                                       | Reachable, then always rejected                  | The CLI rejects every non-PNG result (`png-comparison.ts:11-13`, `:17`).                                                                                                                 |
| `/validate`, `capacity.ts`, `codecs.ts`, `decodeImage`, `readBounded`, jSquash decoders                             | Deployed, but no request reaches it (CMP-01)     | Only a capability without `comparisonMode`. The service no longer issues one.                                                                                                            |
| `process.ts`, `compareImages`, `createThumbnail`, `validatePolicy`, `selectedComparisonPolicy`, jSquash `encodePng` | Legacy. Tests, probes, and scripts only (CMP-04) | No production import.                                                                                                                                                                    |
| Probes and Container                                                                                                | Diagnostic                                       | Manual. The contract authorizes no hosted diagnostic run (`docs/current-contract.md:188`).                                                                                               |

### Walk-through of `POST /validate` as coded

1. The CLI sends `PUT` with one image. `uploadStagedImage` checks the capability, the upload ticket, the staged row, and the admitted manifest (`apps/web/src/api/workflow-owned.ts:1005-1034`).
2. The web Worker reads the body (at most 2 MiB) and checks the size and the SHA-256 (`workflow-owned.ts:1038-1044`).
3. Only when `capability.comparisonMode !== "local-v1"`, the web Worker calls `context.comparator.fetch("https://compare.internal/validate", ...)` (`workflow-owned.ts:1066-1071`). The `COMPARATOR` service binding carries the call (`apps/web/src/runtime.ts:263`, `apps/web/wrangler.jsonc:85-90`).
4. The compare Worker takes the single per-isolate codec token. If the token is taken, it returns HTTP 503 `codec-busy` with `Retry-After: 1` (`apps/compare/src/capacity.ts:17-20`, `validate.ts:39-44`).
5. `readBounded` copies the body into a new 2 MiB buffer (`packages/compare/src/image.ts:57-76`).
6. `validateImage` copies the bytes again, detects the format, and runs `inspectPng` or `inspectWebp`. For PNG it checks each chunk CRC-32, the chunk order, the colour metadata allow-list, and the inflated size of all `IDAT` data (`png.ts:44-206`). Then it computes the SHA-256 (`image.ts:14-36`).
7. `decodeImage` runs the jSquash WASM decoder and checks the decoded dimensions (`image.ts:38-55`).
8. The Worker returns `{ digest, width, height, bytes, contentType, profile }` (`validate.ts:26-36`). The web Worker compares five of these fields (`workflow-owned.ts:1081-1089`), writes the object to R2, and marks the staged row complete (`:1103-1120`).

For a `local-v1` capability, steps 3 to 8 do not run. The web Worker goes from step 2 to the R2 write (`workflow-owned.ts:1090-1106`).

### Configuration side by side

| Key                           | `apps/compare/wrangler.jsonc`                 | `wrangler.probe.jsonc`  | `wrangler.container-probe.jsonc` | `apps/web/wrangler.jsonc`                                |
| ----------------------------- | --------------------------------------------- | ----------------------- | -------------------------------- | -------------------------------------------------------- |
| Name (top level / production) | `visonaut-compare-local` / `visonaut-compare` | `visonaut-codec-probe`  | `visonaut-container-probe`       | `visonaut-preview` / `visonaut`                          |
| `compatibility_date`          | `2026-09-22`                                  | `2026-09-21`            | `2026-09-29`                     | `2026-09-22`                                             |
| `compatibility_flags`         | none                                          | none                    | none                             | `nodejs_compat`                                          |
| `workers_dev`                 | `false`                                       | `true`                  | `true`                           | `true`                                                   |
| `preview_urls`                | `false`                                       | not set                 | `false`                          | `false`                                                  |
| `observability`               | enabled, traces enabled                       | enabled, traces enabled | enabled, traces enabled          | enabled, traces enabled                                  |
| `limits.cpu_ms`               | `30000`                                       | `30000`                 | not set                          | `240000`                                                 |
| Production bindings           | `DB`, `IMAGES`, `OPERATIONS` producer         | none                    | `CODEC_CONTAINER`                | `DB`, `IMAGES`, `QUARANTINE`, `COMPARATOR`, `OPERATIONS` |

The service binding matches: web `"service": "visonaut-compare"` (`apps/web/wrangler.jsonc:88`) and compare `"name": "visonaut-compare"` (`apps/compare/wrangler.jsonc:60`). The production compatibility dates match. Observability matches.

## Findings

### CMP-01 · No request reaches `POST /validate`, but the contract says the Worker validates uploads

- Kind: inconsistency
- Severity: high. Confidence: high. Measured: no. Effort: M
- Evidence:
  - The only call site. `apps/web/src/api/workflow-owned.ts:1066-1067`: `if (capability.comparisonMode !== LOCAL_COMPARISON_MODE) {` then `const validation = await context.comparator.fetch("https://compare.internal/validate", {`. The search `rg "comparator" apps/web/src packages -g '!*.test.ts'` returns no second call.
  - New reservations must be local. `workflow-owned.ts:182-187`: `if (body.comparisonMode !== LOCAL_COMPARISON_MODE) throw new SecurityError("local_comparison_required", 409, "Server comparison no longer accepts new submissions. ...`.
  - The two capability issuers always set local mode. `workflow-owned.ts:383`: `comparisonMode: LOCAL_COMPARISON_MODE,`. `apps/web/src/api/local-comparison.ts:297` rejects any other mode before it issues again at `:444-447`.
  - A capability lives 15 minutes at most. `packages/security/src/capabilities.ts:98`: `expiresIn < 1 || expiresIn > 900`. `:123`: `maxTokenAge: "15m"`.
  - An existing test asserts the behavior. `apps/web/src/api/workflow-owned.test.ts:1740`: `it("admits a complete new capture without calling the comparison Worker or creating pixel tasks"`. `:1750`: `expect(compare).not.toHaveBeenCalled();`.
  - History. [`4f387ce`](https://github.com/ariakit/visonaut/commit/4f387ce4f2ad25d2c6c928427e6720847562c895) added the mode gate. [`19dc91b`](https://github.com/ariakit/visonaut/commit/19dc91b0300994e631919cf81bd2bda8bcf52c79) closed non-local admissions. The runbook records its production deployment before 2026-10-03 (`docs/operations/retire-server-comparison.md:5`).
  - The documents say the opposite. `docs/current-contract.md:32`: "The private Worker validates PNG/WebP through fetch". `:188`: "The production compare Worker retains image validation and its codecs". `README.md:5`: "The comparison Worker still validates uploaded images and processes supported legacy comparisons." `apps/compare/README.md:3`: "This Worker owns private image validation." `docs/operations/retire-server-comparison.md:39`: "Retained images and validation still need them."
  - The Worker is still a hard dependency. `apps/web/src/runtime.ts:49` requires `"COMPARATOR"` on each backend request. `.github/workflows/deploy.yml:130-131` deploys the comparator before each web deploy.
- What happens: Each run now uses a `local-v1` capability. The upload handler skips the validation branch for that mode. A capability without the mode cannot exist more than 15 minutes after the admission fence. Thus `/validate` receives no request in the normal path. For a local upload, the service checks the byte length and the SHA-256 against the signed manifest. It does not parse or decode the bytes. The CLI does the structure check and the decode inside the trusted Submit job (`packages/cli/src/png-comparison.ts:15`, `:25`).
- Impact:
  - Image validation adds no latency to ingest today, because the call does not occur.
  - The statement "the service validates image bytes" is true only for size and digest. The decode guarantee now depends on the trusted job. The public image route still sends `X-Content-Type-Options: nosniff` and `Content-Security-Policy: default-src 'none'; sandbox` (`apps/web/src/api/images.ts:51-54`), and D1 marks each image row as validated by schema (`apps/web/migrations/0001_service.sql:73`: `validated INTEGER NOT NULL DEFAULT 1 CHECK (validated = 1)`).
  - The project deploys, binds, tests, and documents a Worker that does no work. The CI and deploy files bundle it 5 times for a pull request and 7 times for a main deploy (count from `.github/workflows/checks.yml:71`, `:102` with 3 shards, `apps/compare/test/validation.native.test.ts:16-38`, and `deploy.yml:74`, `:131`).
  - The dead branch can mislead. A reader of `uploadStagedImage` sees a "trusted decoding" step and can assume that it protects each upload.
- Recommendation: Select one direction, then make the code, the contract, and the documents agree. If the trusted job is sufficient, remove the branch, the binding, and the Worker. Deploy the web Worker without the binding first, then delete the Worker. Cloudflare refuses to delete a Worker while a service binding points to it.

  ```ts
  // apps/web/src/api/workflow-owned.ts, in uploadStagedImage
  if (capability.comparisonMode !== LOCAL_COMPARISON_MODE) {
    throw new SecurityError(
      "local_comparison_required",
      409,
      "Server comparison no longer accepts uploads. Capture a new complete run.",
    );
  }
  ```

  ```ts
  // apps/web/src/runtime.ts
  for (const binding of ["DB", "IMAGES", "QUARANTINE", "OPERATIONS"] as const) {
  ```

- Alternatives:
  - Keep a server check, but without the second Worker. `validateImage` has no WASM. The web Worker already imports `@visonaut/compare`. Call it inline before the R2 write. This gives the structure check, the CRC check, and the inflate bound. It does not give a full pixel decode. Local Node cost: 4.5 ms at 0.54 megapixels and about 14 ms at 2.06 megapixels (see Measurements). Hosted CPU is not measured.
  - Call `/validate` for local uploads also. This restores the full decode. It adds one service-binding call for each uploaded image and the limits in CMP-07.
  - Minimal: keep all code and correct only the four documents.
- Maintainer decision needed: yes. Is the decode check in the trusted Submit job sufficient, or must the service parse or decode the bytes before it stores them? The contract (D03) tells the project to keep the Worker's image validation, so removal needs an explicit approved change.

### CMP-02 · The production comparator binds D1, R2, and the operations queue, but its code uses none of them

- Kind: security
- Severity: medium. Confidence: high. Measured: no. Effort: S
- Evidence:
  - `apps/compare/wrangler.jsonc:38-59` binds `"binding": "DB"` to `"database_name": "visonaut"`, `"binding": "IMAGES"` to `"bucket_name": "visonaut-images"`, and `"binding": "OPERATIONS"` to `"queue": "visonaut-production-operations"`.
  - `apps/compare/src/index.ts:5`: `async fetch(request: Request) {`. The handler takes no `env` parameter.
  - `rg "env\b|Env\b" apps/compare/src` returns only `index.ts:8` (`satisfies ExportedHandler<Env>`) and three lines in `probe.ts` for `PROBE_TOKEN`.
  - `apps/compare/README.md:18`: "The production Wrangler environment retains the provisioned D1, R2, and OPERATIONS bindings."
- What happens: The queue consumer needed these bindings. That consumer is gone. The bindings stayed.
- Impact: The Worker that parses image bytes with WASM codecs holds write access to the production database, the image bucket, and the operations queue. It needs none of them. This is unnecessary privilege. It also makes the deployed binding list different from what the code uses, which makes a readback harder to interpret.
- Recommendation: Remove the three bindings from `env.production`. Keep `migrations` and `name`.

  ```jsonc
  "env": {
    "production": {
      "migrations": [
        { "tag": "container-v1", "new_sqlite_classes": ["ComparisonContainer"] },
        { "tag": "worker-only-v2", "deleted_classes": ["ComparisonContainer"] },
      ],
      "name": "visonaut-compare",
    },
  },
  ```

- Alternatives: Keep the bindings until the CMP-01 decision, because removal of the Worker also removes them. Minimal: none.
- Maintainer decision needed: yes. The README records the retention as intended. Is there a reason to keep these bindings on a fetch-only Worker?

### CMP-03 · Two guards for a completed retirement still gate each production deploy

- Kind: inconsistency
- Severity: medium. Confidence: high. Measured: no. Effort: S
- Evidence:
  - `.github/workflows/deploy.yml:117-124` runs `deploy-infrastructure.mjs` and `deploy-comparison-retirement.mjs` before each production deploy.
  - `.github/workflows/scripts/deploy-comparison-retirement.mjs:5-9` holds two queue IDs: `visonaut-production-comparisons` and `visonaut-production-comparison-dead-letter`. `:32`: `assert(response.ok, "Cannot read the comparison queue");`. `:38-42` requires `consumers.length` to be `0`.
  - `.github/workflows/scripts/deploy-infrastructure.mjs:7-8`: `const container = settings.bindings.find((binding) => binding.name === "CODEC_CONTAINER"); if (!container) return;`. `:11` reads a `VISONAUT_CODEC_BACKEND` binding. No Wrangler file in the source defines that name (search in Measurements).
  - `docs/operations/retire-server-comparison.md:5`: "The selected production rollout completed on 2026-10-03".
- What happens: Each production deploy makes three Cloudflare API reads for a rollout that is complete. The Container guard returns at once when the binding is absent. The queue guard reads two retained queues by ID and fails the deploy if a read fails.
- Impact: If a person deletes the two unused comparison queues, each later production deploy fails at "Cannot read the comparison queue". The deploy credential must keep queue read permission for these two queues. The guards are 100 lines of script and 97 lines of tests.
- Recommendation: After one last live readback, remove both steps, both scripts, both tests, and the `VISONAUT_CONTAINER_RETIREMENT_VERIFIED` variable. Record the readback in the dated evidence.
- Alternatives: Keep the queue guard, but accept a deleted queue (HTTP 404) as a pass. Or move both checks to a manual operations command outside the deploy path. Minimal: add a note that the queues must not be deleted while the guard exists.
- Maintainer decision needed: yes. Will the two retained comparison queues be deleted? The guard must go first.

### CMP-04 · The legacy comparison engine and its helpers have no production caller

- Kind: dead-code
- Severity: medium. Confidence: high. Measured: no. Effort: M
- Evidence:
  - `apps/compare/src/process.ts` (232 lines) exports `processComparisonTask`. Its importers are `apps/compare/test/process.test.ts`, `apps/web/src/api/tolerated-mask.test.ts:11`, and `apps/compare/container/transport.ts:3` (two symbols).
  - `packages/compare/src/compare.ts` (147 lines) exports `compareImages`, `createThumbnail`, `validatePolicy`, and `selectedComparisonPolicy`. Their importers are `process.ts`, `probe.ts`, `container/server.mjs`, tests, and scripts. `packages/cli/test/local-comparison.test.ts:574` states: "The private comparator is a test oracle; it is absent from shipped CLI code."
  - `apps/compare/src/capacity.ts:13-30`: the `waitMilliseconds` branch and the `release` argument. The only caller is `validate.ts:22`: `return await withCodecCapacity(async () => {`. It passes neither.
  - `apps/compare/test/validate.test.ts:47`: `it("refuses new allocations while a queue task owns capacity and releases after failure"`. No queue task exists.
  - `apps/compare/src/probe.ts:37-46` decodes the same image twice and compares the two results. `result.mask` is thus always `null`, and the mask branch on line 46 cannot run.
  - Size of the non-production code: `apps/compare/container` 573 lines plus a 651-line lock file, `apps/compare/test` 682 lines, `apps/compare/src/probe.ts` and `probe-auth.ts` 102 lines, `packages/compare/scripts` 518 lines.
  - Contract text. `docs/current-contract.md:48`: "W08 retires only legacy admission, scheduling, consumers, and helpers ... Keep the Worker's image validation, required codecs/readers, immutable old engine/codec identity, and stored approval tuples." `docs/operations/retire-server-comparison.md:39`: "Keep diagnostic probe support unless separately retired."
- What happens: The queue handler was removed, but the task body, the RGBA engine, the PNG encoder path, and the wait logic stayed. Tests and probes keep them alive.
- Impact: About 2,000 lines of TypeScript and JavaScript, one Dockerfile, one separate npm lock file, and two WASM codecs need maintenance, dependency updates, and review. One web test imports across applications by relative path (`../../../compare/src/process.ts`), so an edit in `apps/compare` can break `apps/web` tests.
- Recommendation: Split the retirement by contract status.

  | Step | Needs a contract change           | Content                                                                                                                                                                                                                                             |
  | ---- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | 1    | No ("helpers")                    | Delete `process.ts` and `process.test.ts`. Move `readOriginalValidated` and `ArtifactStorage` into `container/transport.ts`. Seed the mask fixture in `tolerated-mask.test.ts` without the task processor. Delete the wait branch in `capacity.ts`. |
  | 2    | Yes ("unless separately retired") | Retire the codec probe and the Container probe, their configs, the Dockerfile, the root scripts `test:container` and `check:container-image`, and `.dockerignore`.                                                                                  |
  | 3    | Yes (follows CMP-01)              | Delete `compare.ts` engine functions and `jsquash.ts`. Keep the identity strings `rgba-visible-1` and `jsquash-png-3.1.1-webp-1.5.0` in `packages/protocol/src/types.ts:44-45`. Stored approval tuples need the strings, not the code.              |

- Alternatives: Move the legacy engine, probes, and scripts to an archive directory that is outside the workspace build and CI. Minimal: do step 1 only.
- Maintainer decision needed: yes. Does the project still plan a hosted probe run or a Container fallback? If not, steps 2 and 3 are available.

### CMP-05 · `validateImage` spends about half of its time in a bitwise CRC-32 and keeps two copies of the inflated image

- Kind: performance
- Severity: medium. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - `packages/compare/src/binary.ts:14-23`: `for (const byte of bytes) { value ^= byte; for (let i = 0; i < 8; i += 1) { value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0); } }`. `png.ts:75` calls it for each chunk.
  - `binary.ts:56` and `:66`: `parts.push(next.value);` and `return joinBytes(parts);`. The caller uses only the length. `png.ts:200-201`: `const inflated = await inflateBounded(joinBytes(compressed), expected); if (inflated.length !== expected) {`.
  - Full copies of the encoded bytes: `image.ts:24` (`Uint8Array.from(input)`), `png.ts:200` (`joinBytes(compressed)`), `png.ts:205` (`joinBytes(decodeChunks)`), and in the Worker `image.ts:59` plus `:75` (`new Uint8Array(maximum)` then `buffer.slice(0, offset)`).
  - The production caller runs it two times for each capture. `packages/cli/src/local-comparison.ts:44`: `await decodePng(await readImage(local.directory, capture), capture.image);`. `:239`: `const candidate = await decodePng(await readImage(local.directory, capture), capture.image);`. Line 239 runs before the equal-digest shortcut on lines 260-273.
  - Measurements (local Node 24.18, darwin-arm64): at 640 by 845 pixels and 82,053 bytes, CRC-32 takes 2.18 ms of 4.52 ms. A table CRC-32 takes 0.156 ms. At 1248 by 1650 pixels, the size check keeps 8,238,450 bytes two times.
- What happens: The CRC loop does eight shift steps for each byte. The inflate helper keeps each output chunk, then joins them into a second buffer, and the caller reads only `.length`.
- Impact: In the trusted Submit job, each capture pays this cost two times. With the recorded count of 3,582 captures for each full cycle (`packages/compare/evidence/ariakit-capture-count.md:3`), the arithmetic is 3,582 × 2 × 2.0 ms ≈ 14 s of CRC time on this machine. This is a calculation from a measured unit cost, not a measured Submit time. A GitHub runner is slower. The transient memory for one maximum-size PNG is about 16.5 MB more than necessary.
- Recommendation: Use a table CRC-32 and count the inflated bytes without keeping them.

  ```ts
  const crcTable = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    crcTable[index] = value >>> 0;
  }

  export function crc32(bytes: Uint8Array) {
    let value = 0xffffffff;
    for (const byte of bytes) {
      value = (crcTable[(value ^ byte) & 0xff] ?? 0) ^ (value >>> 8);
    }
    return (value ^ 0xffffffff) >>> 0;
  }
  ```

  ```ts
  // png.ts: the caller needs only the length.
  const inflatedBytes = await inflatedLength(joinBytes(compressed), expected);
  if (inflatedBytes !== expected) {
    invalid("decoded-size", "PNG decompressed data does not match its dimensions.");
  }
  ```

- Alternatives: In the CLI only, use `zlib.crc32` from `node:zlib` (0.01 ms for the same 295 KB file). The package must then keep a portable path for Workers. Or let the CLI pass the validated result from `validateLocalImages` to `compareLocally`, which removes the second validation and the second decode for each capture (CLI lane). Minimal: the table CRC-32 only.
- Maintainer decision needed: no.

### CMP-06 · The image bounds were sized for the Worker isolate, and the largest known capture uses 98% of the pixel bound

- Kind: inconsistency
- Severity: medium. Confidence: medium. Measured: no. Effort: S
- Evidence:
  - `packages/compare/src/types.ts:8-14`: `/** Provisional resource bounds; the deployed probe must pass before launch. */` with `maxEncodedBytes: 2 * 1024 * 1024`, `maxPixels: 2_100_000`, `maxDimension: 8192`.
  - `packages/compare/evidence/corpus-study.json:14-18`: `"pixels": { "mean": 540632.07, "p95": 1421472, "maximum": 2059200 }`. The maximum is 98.06% of `maxPixels`. At 1,248 pixels wide, 32 more rows exceed the bound.
  - `packages/compare/evidence/hosted-resource-evidence.md:23`: "The original 2 MiB encoded, 2.1 million decoded pixel, and one active decode/comparison per isolate bounds still apply."
  - The capture adapter uses other bounds. `packages/playwright/src/visual.ts:352`: `bytes.byteLength > 20 * 1024 * 1024`. `:356`: `if (pixels > 32_000_000) {`. `packages/cli/src/files.ts:10`: `const MAX_IMAGE_BYTES = 20 * 1024 * 1024;`.
  - The service still applies the small bounds: `apps/web/src/api/local-comparison.ts:548` and `packages/cli/src/png-comparison.ts:15`.
  - `apps/web/wrangler.jsonc:24` and `:53`: launch is enabled in production, but the comment and `packages/compare/README.md:25` still say "provisional" and "before launch".
- What happens: The 2.1 megapixel bound came from the memory of one Worker isolate that decoded two images and a mask. No Worker decodes images in the current path (CMP-01). The CLI decodes in the CI runner. The capture adapter accepts images up to 15 times larger in pixels and 10 times larger in bytes.
- Impact: A capture between 2.1 and 32 megapixels passes each capture job, then fails at trusted Submit. The failure message is generic (CMP-08). The complete capture run is lost. The evidence is from the older grouped screenshots. The sizes of the current section captures were not measured in this audit.
- Recommendation: Use one set of bounds from capture to service, and derive it from the current constraints (runner memory, review page rendering, R2 object size). Make the adapter fail at capture time with the same bounds. Remove the "provisional" wording.

  ```ts
  // packages/playwright/src/visual.ts, after the crop
  if (clip.width * clip.height > imageLimits.maxPixels) {
    throw new Error(
      `Capture is ${clip.width}x${clip.height}. The limit is ${imageLimits.maxPixels} pixels.`,
    );
  }
  ```

- Alternatives: Keep the bounds, and only add the capture-time check and a clear message. Or raise the bounds to a measured value. Minimal: correct the two "provisional" texts.
- Maintainer decision needed: yes. `docs/current-contract.md:57` says "No new telemetry service or larger bound." Does the maintainer want to keep 2.1 megapixels now that the isolate does not decode images?

### CMP-07 · If `/validate` stays, its current design adds avoidable latency and reports failures incorrectly

- Kind: performance
- Severity: low. Confidence: high. Measured: yes. Effort: M
- Evidence:
  - One token for each isolate, no wait. `apps/compare/src/capacity.ts:17-20`: `if (occupied) { if (waitMilliseconds <= 0) { throw new CodecBusyError(); }`.
  - The CLI sends five uploads at the same time. `packages/cli/src/engine.ts:33`: `const IMAGE_PUT_CONCURRENCY = 5;`. A busy answer costs at least one second. `packages/cli/src/http.ts:109`: `return Math.max(100, milliseconds) + Math.floor(Math.random() * 250);`.
  - Measurement: five concurrent calls to one handler instance gave `[200, 503, 503, 503, 503]` in each of five rounds.
  - Failure mapping. `apps/web/src/api/workflow-owned.ts:1075-1077`: `if (!validation.ok) { throw new SecurityError("invalid_image", 422, "The image failed trusted decoding."); }`.
  - The digest is computed two times: `workflow-owned.ts:1042` and `packages/compare/src/image.ts:35`.
  - The response field `profile` (`validate.ts:33`) has no reader (`workflow-owned.ts:1081-1087`).
  - `packages/compare/src/image.ts:42` passes `image.decodeBytes.buffer`. This ignores `byteOffset` and `byteLength`. It is correct today only because both producers return an array that owns its complete buffer (`png.ts:205`, `webp.ts:82`).
- What happens: When two requests reach the same isolate, the second gets HTTP 503. The CLI waits 1.0 to 1.25 seconds and sends the complete image again. Each retry repeats the capability, ticket, and D1 checks in the web Worker. An HTTP 500 from the comparator, for example a CPU or memory limit, becomes a permanent "invalid image" for the CLI.
- Impact: None today (CMP-01). If the maintainer selects full server decode for local uploads, a batch of five uploads can take four retry rounds when all calls reach one isolate. Whether Cloudflare sends concurrent calls to one isolate was not measured.
- Recommendation: If the endpoint stays, wait for the token for a short time, and map only HTTP 422 to `invalid_image`.

  ```ts
  // apps/compare/src/validate.ts
  return await withCodecCapacity(validate, 2_000);
  ```

  ```ts
  // apps/web/src/api/workflow-owned.ts
  if (validation.status === 422) {
    throw new SecurityError("invalid_image", 422, "The image failed trusted decoding.");
  }
  if (!validation.ok) {
    throw new SecurityError("validation_busy", 503, "Image validation is unavailable. Retry.");
  }
  ```

- Alternatives: Use the inline structure check from CMP-01, which needs no token and no second Worker. Minimal: none while the path has no caller.
- Maintainer decision needed: no. This finding applies only if CMP-01 keeps the endpoint.

### CMP-08 · Both consumers discard the validation error codes

- Kind: dx
- Severity: low. Confidence: high. Measured: no. Effort: S
- Evidence:
  - The package defines specific codes, for example `packages/compare/src/types.ts:61`: `invalid("image-too-large", "Image dimensions exceed the configured decode limit.");` and `png.ts:147`: `invalid("unsupported-profile", "PNG gamma must describe sRGB.");`.
  - `packages/cli/src/png-comparison.ts:34-39`: `} catch (error) { if (error instanceof CliError) { throw error; } throw new CliError("An image is not a supported, bounded PNG. Capture the image again."); }`.
  - `apps/web/src/api/workflow-owned.ts:1075-1077` maps each non-busy failure to one message.
- What happens: The validator knows the exact reason (size, colour profile, CRC, chunk order, animation). The CLI replaces it with one sentence. The web Worker did the same.
- Impact: A maintainer who sees a failed Submit cannot tell an oversized capture from an unsupported colour profile. "Capture the image again" does not help for either cause.
- Recommendation: Include the code and message in the CLI error.

  ```ts
  if (error instanceof ImageValidationError) {
    throw new CliError(`${metadata.digest.slice(0, 12)}: ${error.message} (${error.code})`);
  }
  ```

- Alternatives: Print only the code. Minimal: print the image digest so that the maintainer can find the capture.
- Maintainer decision needed: no.

### CMP-09 · Four documents describe a comparator that no longer exists

- Kind: copy
- Severity: low. Confidence: high. Measured: no. Effort: S
- Evidence:
  - `README.md:5`: "The comparison Worker still validates uploaded images and processes supported legacy comparisons." The Worker has no queue handler (`apps/compare/src/index.ts:4-8`).
  - `README.md:60`: "`apps/compare` | Image validation and legacy comparison Worker".
  - `apps/web/src/operations/README.md:3`: "the compare Worker consumes work and publishes a status wakeup."
  - `apps/compare/README.md:5`: "Existing live consumer assignments must be detached explicitly before this version is deployed." `:18`: "Verify exact resource IDs and detached comparison consumers before production deployment." `:34`: "Before deploying that migration, check the live deployment". The runbook says the rollout completed on 2026-10-03.
  - `apps/compare/wrangler.jsonc:33`: `// Apply the same live-use gate before the production namespace deletion.`
  - `apps/compare/README.md:12` uses `https://compare/validate`. The code uses `https://compare.internal/validate` (`workflow-owned.ts:1067`).
- What happens: The documents kept the pre-retirement instructions and descriptions.
- Impact: A new contributor reads that the Worker consumes queue work and that a deployment gate is open. Both are false. The `apps/compare/README.md` is 43 lines of dense text, and most of it describes completed gates.
- Recommendation: After the CMP-01 decision, replace the comparator text with three facts: what the Worker does, who calls it, and what is diagnostic. Move completed gates to the dated evidence.
- Alternatives: Minimal: correct the three false sentences in `README.md:5` and `apps/web/src/operations/README.md:3`.
- Maintainer decision needed: no.

### CMP-10 · The Wrangler files differ in dates, preview URLs, and limits without a stated reason

- Kind: inconsistency
- Severity: low. Confidence: high. Measured: no. Effort: S
- Evidence:
  - `compatibility_date`: `apps/compare/wrangler.jsonc:5` `"2026-09-22"`, `wrangler.probe.jsonc:5` `"2026-09-21"`, `wrangler.container-probe.jsonc:5` `"2026-09-29"`. `apps/compare/test/validation.native.test.ts:51` hard-codes `"2026-09-22"`.
  - `preview_urls`: `false` in three files. `wrangler.probe.jsonc` does not set it and has `"workers_dev": true` (line 6).
  - `limits.cpu_ms`: `30000` in `apps/compare/wrangler.jsonc:14`. The recorded hosted maximum for the heavier probe is 431.753 ms (`packages/compare/evidence/hosted-resource-summary.json:53`). The value is a remainder of queue comparison work.
  - Top-level names: `visonaut-compare-local` in compare and `visonaut-preview` in web for the same "not production" role.
  - `$schema`: `"node_modules/wrangler/config-schema.json"` in compare and `"../../node_modules/wrangler/config-schema.json"` in web.
  - `secrets.required`: web declares its secrets (`apps/web/wrangler.jsonc:113-121`). The two probe configs need `PROBE_TOKEN` and do not declare it.
- What happens: Each file was edited at a different time.
- Impact: Small. A probe deployed with the older date can run with different runtime behavior than production. A missing `preview_urls` value leaves that decision to the Wrangler default.
- Recommendation: Use one compatibility date in all four files and in the native test. Set `"preview_urls": false` and `"secrets": { "required": ["PROBE_TOKEN"] }` in both probe configs. Lower `cpu_ms` to a value near the measured need, for example `5000`.
- Alternatives: Minimal: set `preview_urls` in `wrangler.probe.jsonc`. If CMP-04 step 2 removes the probes, only the date in the native test remains.
- Maintainer decision needed: no.

### CMP-11 · The compare tests are not type-checked, and the Container type check does not run in CI

- Kind: dx
- Severity: low. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - `apps/compare/tsconfig.json:13`: `"include": ["src", "worker-configuration.d.ts"]`. The `test` directory is not included.
  - `apps/compare/package.json:12` defines `typecheck:container`. The root script is `"typecheck": "pnpm -r --if-present typecheck"` (`package.json:9`), which runs only scripts named `typecheck`.
  - `vitest.config.ts:5` includes `apps/**/*.test.ts`. Thus `container.test.ts` and `container-probe.test.ts` run in each CI test job. `.github/workflows/README.md:3` says: "Container diagnostics run on demand and do not enter normal CI."
  - Measurement: a scratch `tsc` project over the five test files and the two Container files reported 11 errors in 2 test files. Three of them do not depend on the generated `Env` types: `apps/compare/test/container-probe.test.ts(38,41): error TS2493: Tuple type '[]' of length '0' has no element at index '0'.` and two `TS2339` errors on lines 41 and 42.
- What happens: The test files compile only through Vitest, which removes types without a check. The Container Worker and its transport have a type check script that no pipeline calls.
- Impact: Type errors in tests are not detected. The mock on `container-probe.test.ts:7` declares a function with no parameters, then the test reads its first argument. The documents and the CI configuration disagree about which Container tests run.
- Recommendation: Add `test` to the `include` list, and run the Container type check from the `typecheck` script.

  ```json
  "typecheck": "wrangler types && tsc6 -p tsconfig.json && pnpm run typecheck:container"
  ```

- Alternatives: If CMP-04 removes the Container, only the `include` change remains. Minimal: correct the CI document.
- Maintainer decision needed: no.

### CMP-12 · Codec identity strings and the policy type are duplicated, and no check ties them to the installed versions

- Kind: inconsistency
- Severity: low. Confidence: high. Measured: no. Effort: S
- Evidence:
  - `packages/compare/src/compare.ts:3-4`: `export const engineVersion = "rgba-visible-1";` and `export const codecVersion = "jsquash-png-3.1.1-webp-1.5.0";`.
  - `packages/protocol/src/types.ts:44-45`: `export const COMPARISON_ENGINE_VERSION = "rgba-visible-1";` and `export const IMAGE_CODEC_VERSION = "jsquash-png-3.1.1-webp-1.5.0";`.
  - `ComparisonPolicy` is declared in `packages/compare/src/compare.ts:6-13` and in `packages/protocol/src/types.ts:47-52`.
  - The versions are also in `apps/compare/package.json:15-16` and `packages/compare/package.json:17-18`. `renovate.json` uses `"rangeStrategy": "pin"`, so Renovate will propose updates.
  - `apps/compare/container/transport.ts:6` hard-codes `"sharp-0.35.4-vips-8.18.6"`. `transport.ts:62-68` repeats the thumbnail size rule from `compare.ts:133-135`. The 6 MiB request bound is in `container/server.mjs:16` and `container/probe.ts:28`.
- What happens: The same identity exists in two packages and in two manifests. No test compares the string with the installed jSquash version.
- Impact: A jSquash update changes the decoder, but the recorded codec identity stays the same. Stored approval tuples include this identity (`apps/web/src/operations/README.md:24`). Today the risk is small, because no production code decodes with jSquash (CMP-01).
- Recommendation: Keep one definition in `@visonaut/protocol` and import it in `@visonaut/compare`. If the jSquash codecs stay, add a test that reads both `package.json` versions and compares them with the string.
- Alternatives: Tell Renovate to ignore the two jSquash packages. Minimal: a comment at both pins that names the identity string.
- Maintainer decision needed: no.

### CMP-13 · Three codec stacks exist, and the PNG-only local path stores 2.4 to 3.1 times more bytes than lossless WebP

- Kind: cost
- Severity: low. Confidence: medium. Measured: yes. Effort: L
- Evidence:
  - Stack 1, production: pngjs 7.0.0 and pixelmatch in the CLI (`packages/protocol/src/types.ts:130-131`).
  - Stack 2, no caller: jSquash PNG and WebP WASM, 181,088 and 137,960 bytes (`apps/compare/src/codecs.ts:1-2`).
  - Stack 3, diagnostic: sharp 0.35.4 with libvips in the Container (`apps/compare/container/package.json:9`).
  - The CLI rejects WebP. `packages/cli/src/png-comparison.ts:11-13`: `if (metadata.mediaType !== "image/png") { throw new CliError("Local comparison supports PNG only. ...`. `packages/cli/src/local-comparison.ts:255-258` rejects a WebP reference.
  - Measurement: the three committed browser screenshots are 23,264, 27,611, and 30,735 bytes as PNG and 9,622, 9,720, and 9,854 bytes as lossless WebP with identical pixels.
  - Recorded evidence (not measured here): the largest fixture is 368,370 bytes as PNG and 35,796 bytes as WebP (`packages/compare/evidence/hosted-largest-fixture.json:4-5`).
  - Measurement: for the same 2.06 megapixel PNG in Node, jSquash decodes in 14.0 ms and `PNG.sync.read` in 27.6 ms.
- What happens: The service accepts PNG and lossless WebP. The current comparison path accepts PNG only. The WebP validator (83 lines) and the WebP decoder have no production consumer.
- Impact: Uploads, R2 objects, and reference downloads are larger than necessary. The absolute cost is small, because Submit uploads only new or changed originals. The larger cost is the maintenance of three decoders and two hand-written container parsers for one job.
- Recommendation: Select one codec stack for the trusted path and remove the others when CMP-01 and CMP-04 are decided. If PNG stays, remove WebP support from the validator after a check that no retained reference is WebP.
- Alternatives: Add lossless WebP to the local path with the jSquash decoder in Node. This is faster to decode and smaller to store, but it changes the recorded codec identity (`pngjs-7.0.0`) and thus the approval tuple. Minimal: keep all, and record that WebP is a retained read format only.
- Maintainer decision needed: yes. Is PNG the only capture format for the future? If yes, WebP validation and decoding can be retired after a check of retained originals.

### CMP-14 · Workspace dependency declarations do not match the imports

- Kind: dx
- Severity: low. Confidence: high. Measured: no. Effort: S
- Evidence:
  - `apps/web/package.json:37` lists `"@visonaut/compare": "workspace:*"` in `devDependencies`. Runtime source imports it: `apps/web/src/runtime.ts:2` and `apps/web/src/api/local-comparison.ts:1`.
  - `packages/compare/package.json` declares only the two jSquash packages. Its scripts and files use `tsc6`, `vitest`, Node types (`tsconfig.json:12`), and `@playwright/test` (`scripts/browser-study.ts:2`). `packages/compare/node_modules` holds only `@jsquash`.
  - `apps/compare/package.json:18` lists `@visonaut/service` in `dependencies`. Only `process.ts:15` and `container/transport.ts:2` import it, and both are type-only imports from non-production files.
  - `packages/service/src/service.test.ts:17` imports `../../compare/src/compare.ts` by relative path. `packages/service/package.json` does not declare `@visonaut/compare`.
- What happens: The imports resolve through the root `node_modules` or through relative paths across packages.
- Impact: The checks pass today. A stricter install or a moved file breaks them. The compare Worker gets a patch version and a changelog entry for each `@visonaut/service` release (`apps/compare/CHANGELOG.md:3-8`), although its deployed code does not use that package.
- Recommendation: Move `@visonaut/compare` to `dependencies` in `apps/web`. Add the missing `devDependencies` to `packages/compare`. Remove `@visonaut/service` from `apps/compare` when `process.ts` goes (CMP-04).
- Alternatives: Minimal: the `apps/web` change only.
- Maintainer decision needed: no.

## Measurements (command, raw result, limits)

All scripts are in `/Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/compare/`. They import the repository source and write only to that directory. All times are medians on local Node v24.18.0, darwin-arm64. They are not Workers CPU times and not GitHub runner times.

1. `node measure-validate.mjs` (stage cost of the `/validate` work). Fixture: the committed `packages/compare/evidence/browser/chromium.png` and the same image tiled to 1248 by 1650.

   | Stage                                  | 640×360, 23,264 bytes | 1248×1650, 295,311 bytes |
   | -------------------------------------- | --------------------- | ------------------------ |
   | SHA-256                                | 0.03 ms               | 0.11 ms                  |
   | CRC-32 over the file (repository code) | 0.52 ms               | 6.54 ms                  |
   | `validateImage`                        | 1.36 ms               | 14.37 ms                 |
   | `decodeImage` (jSquash WASM)           | 1.23 ms               | 14.02 ms                 |
   | `validateImage` + `decodeImage`        | 2.40 ms               | 26.84 ms                 |
   | `PNG.sync.read` (pngjs)                | 2.33 ms               | 27.56 ms                 |

   WASM linear memory after the run: 28,966,912 bytes. Raw output: `measure-validate.json`.

2. `node measure-crc.mjs`. Output: `"equalOutputs": true`, realistic file (295,311 bytes) `"bitwiseMs": 8.77, "tableMs": 0.57, "zlibCrc32Ms": 0.01, "inspectPngMs": 23.56`. Worst case (2,097,152 bytes) `"bitwiseMs": 59.45, "tableMs": 4.76, "zlibCrc32Ms": 0.12`. Limit: the two runs gave 6.54 and 8.77 ms for the same CRC, and 14.37 and 23.56 ms for PNG inspection. The spread is run-to-run noise from JIT state.

3. `node measure-crc-mean.mjs` (corpus mean size, 640 by 845, 82,053 bytes). Output: `"crcBitwiseMs": 2.181, "crcTableMs": 0.156, "validateImageMs": 4.52`.

4. `node measure-inflate.mjs`. Output: `"compressedBytes": 295254, "expectedFilteredBytes": 8238450, "currentInflateBoundedMs": 6.71, "countOnlyMs": 5.61`. The time gain is small. The memory gain is one retained copy of 8,238,450 bytes plus one joined copy.

5. `node measure-cli-path.mjs` (`validateImage` plus `PNG.sync.read`, the body of the CLI `decodePng`). Output: 640×845 `"validateImageMs": 4.77, "decodePngMs": 12.6, "unchangedCaptureMs": 25.2`. 1248×1650 `"validateImageMs": 15.79, "decodePngMs": 43.91, "unchangedCaptureMs": 87.82`. Limit: `unchangedCaptureMs` is two times `decodePngMs`, from the two call sites in the CLI. It is not a measured Submit run.

6. `node measure-concurrency.mjs` (five concurrent calls to `validateRequest` in one process, five rounds). Output: each round `[200, 503, 503, 503, 503]`, `"accepted": 5, "rejectedBusy": 20`, busy body `{"code":"codec-busy","error":"The image codec is busy. Retry the request."}`. Limit: one process represents one isolate. The distribution of hosted calls over isolates was not measured.

7. `node measure-webp-size.mjs` (PNG against lossless WebP, jSquash encoder, `lossless: 1, exact: 1, method: 6`). Output: chromium `23264` to `9622` (2.42), firefox `27611` to `9720` (2.84), webkit `30735` to `9854` (3.12), `"identicalPixels": true` for all three. Limit: three small synthetic pages.

8. `apps/compare/node_modules/.bin/tsc6 -p typecheck/tsconfig.json --pretty false` (scratch project over `apps/compare/test/*.ts`, `container/probe.ts`, `container/transport.ts`, with stand-in `Env` types). Result: exit code 2, 11 errors, all in `container-probe.test.ts` (6) and `container.test.ts` (5). The source files and the Container files had no error. Limit: eight errors depend on the stand-in for the generated `worker-configuration.d.ts`. Three do not (lines 38, 41, 42 of `container-probe.test.ts`).

9. Static searches.
   - `rg -n "comparator" apps/web/src packages -g '!*.test.ts' -i` shows one call: `apps/web/src/api/workflow-owned.ts:1067`.
   - `rg -n "issueIngestCapability" apps packages` shows two non-test issuers: `workflow-owned.ts:389` and `local-comparison.ts:444`.
   - `rg -n "VISONAUT_CODEC_BACKEND|CODEC_CONTAINER"` outside archived evidence shows no Wrangler definition of `VISONAUT_CODEC_BACKEND`, and `CODEC_CONTAINER` only in `wrangler.container-probe.jsonc:18`.
   - `ls -l` of the codecs: `squoosh_png_bg.wasm` 181,088 bytes, `webp_dec.wasm` 137,960 bytes.

10. Recorded hosted evidence that this audit read but did not measure: `packages/compare/evidence/hosted-resource-summary.json` (2026-09-22, 1248×1650, the older probe with two decodes, a comparison, a thumbnail, and a mask): CPU P50 291.906 ms for PNG and 199.335 ms for WebP, isolate memory maximum 101,049,668 bytes for PNG. No hosted measurement exists for `/validate` alone.

## Open questions and items not verified

- Production request counts for `visonaut-compare` were not read. CMP-01 is a source trace plus an existing test. A Cloudflare analytics read for the days after 2026-10-03 can confirm zero requests.
- The live binding list of `visonaut-compare`, the state of the `worker-only-v2` migration, and the state of the two retained comparison queues were not read. No remote command was run.
- It is not known if the pinned Container image in `wrangler.container-probe.jsonc:12` still exists in the registry, or if a probe Worker is deployed. The hosted evidence names an older endpoint (`ariviso-codec-probe`).
- The sizes of the current Ariakit section captures were not measured. CMP-06 uses the older grouped corpus.
- The time of one compare Worker bundle step was not measured, because this lane must not run a build. The count of bundle steps comes from the workflow files.
- Hosted CPU for `validateImage` in the web Worker (the inline alternative in CMP-01) was not measured.
- Node and Workers can differ in how `DecompressionStream` treats data after the end of a zlib stream. The validator runs in Node (CLI) today. This difference was not tested.
- The vitest suites were not run. A vitest run writes a cache inside the repository, and this lane is read-only.
- Whether any retained reference image is WebP was not checked. This matters for the WebP part of CMP-13.
