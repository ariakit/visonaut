# Local capture and comparison evidence

E01 remains partial. These results extend the local adapter and reporter checks to Chromium, Firefox, and WebKit. They do not replace the required Ariakit captures on Ubuntu Chromium/Firefox and macOS WebKit, or the peak-memory gate.

The source is an exact copy of the working tree based on [`c8c465c`](https://github.com/ariakit/ariviso/commit/c8c465cedd8318b1bbe4b99baec1757ec02347c6). This commit alone does not identify the tested code: the implementation was uncommitted. [Source and build hashes](./source-hashes.json) identify the copied files and rebuilt public adapter/reporter. The root checkout was not changed during the study. These hashes describe the recorded source copy, not the final implementation. A rerun against the current checkout produces new evidence and must record its own hashes.

## Results

The [raw summary](./summary.json) records the time, Node version, operating system, font digest, images, and manifest digests. The runtime was Node 24.18.0, Playwright 1.63.0, and local macOS arm64. Three separate Playwright processes per engine each captured ten clean synthetic cases in fresh browser contexts. These cases contain antialias text, alpha, rounded borders, and an infinite CSS animation. The prepared context uses reduced motion; the public adapter disables screenshot animation.

| Engine   | Browser version | Clean captures | Comparisons against first capture | Changes | Recovered tests |
| -------- | --------------- | -------------: | --------------------------------: | ------: | --------------: |
| Chromium | 153.0.8010.12   |             30 |                                29 |       0 |             5/5 |
| Firefox  | 155.0           |             30 |                                29 |       0 |             5/5 |
| WebKit   | 26.6            |             30 |                                29 |       0 |             5/5 |

All 87 comparisons use `visible-exact-v1`: channel threshold 0, changed pixels 0, ratio 0. A second comparison of each pair produced the same complete result and mask. This is deterministic local recomparison evidence, not a measured false-positive rate for the Ariakit suite.

Nine delayed-font cases passed: one in each clean process. A real font request stayed pending across capture startup. No screenshot started before the request was released; each capture then took at least two screenshots with loaded fonts. The request was intercepted locally and served the installed Arial font. Its bytes are not included in this repository evidence.

Each of the 15 recovered tests captured blue, failed after capture, restarted its worker, captured green, and passed. The manifest selected retry 1 only, and decoded selected pixels were `[0, 255, 0, 255]`. Retry success did not issue a visual approval.

In all three engines, these separate failing runs exited 1 and emitted no successful manifest:

- Caller preparation failed before capture.
- Both attempts captured an image and then failed.
- A controlled wrapper changed real rendered pixels before each native screenshot while dimensions stayed fixed; the capture timed out.

The [compressed Playwright receipts](./playwright-receipts.json.gz) retain test outcomes and attempts. [Ten codec tests](./codec-tests.json) also passed against the same comparator snapshot: byte preservation, supported/unknown color data, alpha, malformed images, bounds, dimensions, deterministic output, and a 20-step tolerated-drift model.

## Remaining gates

| Requirement                                                     | Evidence now                                                                                                             | Required closure                                                                                                                                                                    |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Original PNG/WebP bytes, sRGB/alpha, malformed data, dimensions | Local codec fixtures pass; existing hosted probe has PNG/WebP decoded parity                                             | Keep the same pinned codec and validation rules in the selected production runtime. Run the negative/color fixtures there too.                                                      |
| Prepared capture and retry selection                            | Local public adapter/reporter passes in three engines, including delayed fonts and changing pixels                       | Repeat under the actual trusted Ubuntu/macOS capture jobs. Local WebKit is not branded Safari or the hosted runner image.                                                           |
| Defect/noise study and policy                                   | Existing corpus injects 100 defects; exact policy detects all. Existing and new synthetic clean cases are stable         | Repeated clean Ariakit captures on the full runner matrix; compare policy alternatives and report false positives and missed defects. Confirm final measured limits.                |
| Repeated tolerated drift                                        | Comparator test models 20 accepted one-level changes; strict policy flags each step                                      | Prove through the service that each accepted candidate, including tolerance-unchanged bytes, becomes the next baseline. The comparator-only model does not prove service promotion. |
| CPU                                                             | Existing hosted probe measures CPU for the largest historical fixture                                                    | Measure the selected full production codec path at its final image limits, including changed masks and relevant worst-case fixtures.                                                |
| Peak memory and concurrency                                     | Existing hosted isolate maximum is sampled at invocation time; the in-isolate capacity token and queue concurrency are 1 | Obtain authoritative peak evidence and safe margin for the selected runtime, across cold/warm and mixed-format cases. A sampled value or successful response is not a peak.         |
| Container fallback, when needed                                 | No deployed fallback evidence was present in this snapshot                                                               | If Worker resource or codec requirements cannot pass, test the pinned Container decoder, parity, memory/CPU, lifecycle, retry contract, and cost before production use.             |

After this snapshot, the separate service owner supplied an A0 → B1 → C2 comparator/service/promotion test with an old-baseline negative control. That follow-up addresses the service drift row above when it is integrated and rerun. This local browser study does not duplicate or claim that test.

The issue's E01 and D45 make the fallback conditional on Worker codec or resource requirements. They do not permit moving authoritative comparison back to CI. A missing Worker peak measurement does not establish an actual Worker failure, but it leaves the memory gate open.

Cloudflare documents that its memory metric measures shared isolate use at invocation time. It also states that an over-limit isolate can finish in-flight work and be replaced. Thus HTTP 200 and an `ok` outcome alone do not establish peak usage below the limit. [Workers metrics](https://developers.cloudflare.com/workers/observability/metrics-and-analytics/), [Workers limits](https://developers.cloudflare.com/workers/platform/limits/).

DevTools supports memory snapshots and debugger pauses. This can identify phase allocations in local workerd, but a heap snapshot or native process RSS must not be relabeled as hosted isolate peak. [Memory profiling](https://developers.cloudflare.com/workers/observability/dev-tools/memory-usage/).

## Reproduce

Install the pinned workspace dependencies and Playwright browsers first. On macOS with the same Arial font, run from the repository root:

```sh
python3 tooling/evidence/e01-clients/snapshot.py "$PWD" /tmp/ariviso-e01-repeat
```

This creates a new isolated copy of the source passed to the script, builds the public adapter, and runs the matrix. It does not reconstruct the old uncommitted source from its hashes. Compare the rerun source and build hashes with the recorded hashes before treating it as a reproduction of the same implementation. It does not use discovery evidence or GitHub OIDC and must not be uploaded as a trusted capture run. The harness makes no external writes. It records screenshots locally; image binaries are excluded from this repository evidence.

Two initial harness setup attempts stopped before browser tests because of a TypeScript import path and JSON config loading. The final harness fixes those setup errors; all recorded matrix runs completed with the expected outcomes. This study does not claim a new regression against a known-broken product revision.
