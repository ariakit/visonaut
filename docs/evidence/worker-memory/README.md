# Worker memory measurement limits

The September 22, 2026 local diagnostics measure the resident-memory high-water mark of a native workerd process. They do not establish a hosted Worker isolate peak below 128 MiB. E01 remains open.

## Local process observations

The probe ran on macOS 26.6.2 arm64 with workerd 1.20260921.1. A Python parent collected `os.wait4(...).ru_maxrss` after each fresh child process exited. The recorded unit is bytes on this Darwin host. The value covers the whole process, including runtime and native allocations. It is not Node RSS or an isolate-only counter. No empty-process value was subtracted.

Each process served either one HTTP request or 25 sequential HTTP requests. Each case had three fresh-process repetitions. The original client checked HTTP 200, the original and decoded-pixel digests, the unchanged comparison outcome, and zero changed pixels. All 234 recorded responses in 18 processes passed those checks.

| Input                                   | Requests per process | Maximum process peak RSS, bytes | Maximum process lifetime CPU, ms |
| --------------------------------------- | -------------------: | ------------------------------: | -------------------------------: |
| Existing WebP, 1248 × 1650              |                    1 |                     128,729,088 |                           86.654 |
| Existing WebP, 1248 × 1650              |                   25 |                     632,324,096 |                          824.773 |
| Lossless PNG of that image, 1248 × 1650 |                    1 |                     142,540,800 |                          135.143 |
| Lossless PNG of that image, 1248 × 1650 |                   25 |                     197,017,600 |                        1,649.895 |
| Decoded-limit PNG, 1400 × 1500          |                    1 |                     170,721,280 |                          212.313 |
| Decoded-limit PNG, 1400 × 1500          |                   25 |                     260,210,688 |                        3,603.855 |

The decoded-limit fixture contains 2,100,000 pixels and 1,668,228 encoded bytes. The [frozen memory bundle](../../../tooling/evidence/worker-memory/README.md) preserves the raw HTTP receipts, six-row summary, and source and fixture identities. Its wrapper extracts those unchanged originals for inspection. The runtime binary SHA-256 is `d93f68bd50a50de5511721ea962727f00c04a95e77c902140f0e8be330467d9a`. The HTTP Worker bundle SHA-256 is `3b4d76a3515556b602fd661f2bb8721b70396a57fd418b00a6b772d0ff6a3028`.

The process CPU values include startup, codec initialization, helper threads, all requests, and shutdown. They do not replace hosted per-invocation CPU observations. The probe compares each fixture to itself and omits production R2, D1, queue metadata, two separately validated originals, differing image pairs, and simultaneous work. Local workerd also uses different memory-limit enforcement from the hosted service. Neither the below-limit nor the above-limit process values establish a hosted isolate result. The original process report inside the frozen bundle retains the method and source references.

## Calibration

The kernel calibration in the frozen bundle held and touched 64 MiB in either a Uint8Array or WebAssembly.Memory. Empty-process peak RSS was 29,786,112–29,884,416 bytes. The Uint8Array cases measured 96,944,128–97,058,816 bytes; the WASM cases measured 97,058,816–97,206,272 bytes. The process counter detected resident WASM pages.

The separate inspector calibration in the frozen bundle has a different scope. A filled 16 MiB Uint8Array increased `Runtime.getHeapUsage.backingStorageSize` by 16,777,216 bytes. A separate filled 16 MiB WebAssembly.Memory then increased that counter by zero. Allocation sampling returned an empty profile for the WASM allocation. These inspector observations do not cover complete WASM memory or a continuous total-isolate peak.

For example, `wasmMemoryBytes` is the retained WASM linear-memory capacity reported by the codec. It is not total isolate memory. Adding that value to an inspector sample does not prove the missing continuous peak.

## Retained evidence and remaining gate

[The archive inventory](../../../tooling/evidence/worker-memory/INPUTS.json) records the identity of the deterministic archive containing 15 unchanged originals. The original hash manifests remain inside it. [Curation checks](./CURATION.json) recompute the six summary rows, check all 234 saved response results, and verify both calibrations. This was local receipt review, not a new runtime execution.

The collection scripts inside the archive preserve the original measurement logic and historical paths. The readable verifier checks the receipts without running those scripts. Runtime binaries, Worker bundles, WASM binaries, and image bodies are omitted. This subset supports receipt and calculation checks; it is not a complete runtime replay package.

The remaining requirement needs a complete hosted measurement with the required accounting scope, or a production Container fallback with codec parity, queue behavior, lifecycle, peak memory, and cost checks. A separate [hosted Container codec probe](../container-codec/README.md) now records parity and a stop/restart cycle. Its cgroup peak counter was unavailable, and it does not run the production queue or R2/D1 path. No production fallback has been deployed or certified.
