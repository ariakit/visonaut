# Native local declaration and renewal probe

The 12,300-image shard passed the real declaration route in local workerd with native D1 and R2. The cold declaration finished in 1431.773 ms, including response body consumption. Five identical replays and renewals also finished within the CLI's 30-second request deadline. No concrete server source defect appeared in this bounded test.

This is local server evidence. It is not GitHub OIDC verification, a hosted latency measurement, or a memory gate pass. The trusted run is an explicit local fixture. No deployment, GitHub request, remote storage write, or credential grant was made.

## Measured results

Recorded from 2026-09-22T12:49:58.509Z through 2026-09-22T12:50:06.470Z. Toolchain: Node v24.18.0, Miniflare 5.20260921.0-alpha, Wrangler 4.136.1 on macOS arm64. Every table row has HTTP 200 and the same manifest digest.

| Request                   | Returned tickets | Response bytes | Controller wall ms | D1 rows read | D1 rows written | D1 duration ms |
| ------------------------- | ---------------: | -------------: | -----------------: | -----------: | --------------: | -------------: |
| cold-declaration          |           12,300 |     10,098,419 |           1431.773 |       24,852 |          74,300 |            461 |
| identical-no-progress     |           12,300 |     10,098,419 |            683.138 |       24,852 |             498 |            132 |
| renewal-after-103-uploads |           12,197 |     10,013,856 |            654.033 |       24,749 |             498 |            142 |
| warm-renewal-1            |           12,196 |     10,013,035 |            666.864 |       24,748 |             498 |            139 |
| warm-renewal-2            |           12,196 |     10,013,035 |            673.510 |       24,748 |             498 |            137 |
| warm-renewal-3            |           12,196 |     10,013,035 |            689.845 |       24,748 |             498 |            133 |

Each declaration used **251 D1 binding calls**, with **12,801 SQL statements**. There were three single-row lookups, one five-statement initial atomic batch, 246 groups of 52 statements, and one final query. The group has 50 inserts, an active-run assertion, and assertion cleanup. Each declaration also made one R2 GET for its trusted plan and one R2 PUT for its unchanged manifest. The D1 duration column sums native result metadata; it is not Worker CPU time.

```text
3 lookup statements + 5 initial statements + 246 * 52 group statements + 1 final query
= 12,801 statements in 251 binding calls
```

The server still prepares every image row on replay. Completed rows and existing incomplete rows use the existing conflict-ignore insert path. Replay reduces measured writes from 74,300 to 498, but keeps all 251 database calls and 12,801 statements. D1's reported write counts include its native index/transaction accounting and are not the number of logical image rows.

The probe uploaded 103 distinct valid PNGs through the real upload route and a separate native comparison Worker. That Worker ran the actual PNG validation and WASM decoder. Renewal then returned exactly 12,197 fresh tickets; no completed digest was present, and every returned token differed from the corresponding initial token. A further upload with the renewed capability and new ticket returned HTTP 204. All three later declarations returned exactly 12,196 remaining tickets.

Final checks found 104 complete upload rows, 12,196 incomplete rows, 104 registered images, and no foreign-key errors. The probe read all 104 retained R2 objects and verified their digests and total 7,176 bytes. These inspection queries and GETs are separate from the declaration/upload counts.

## Fixture and source

The fixture has 12,300 distinct one-pixel RGB PNGs, each 69 bytes. Total encoded bytes: 848,700. Its manifest is 5,367,638 bytes, its fixed trusted plan is 628,797 bytes, and the service's stored plan is 850,209 bytes. It uses valid protocol manifest, profile, policy, and plan shapes. Profile and plan digests are computed by the real protocol helpers and checked by `parseManifest`, `parseTrustedPlan`, and `validateShardDeclaration`.

`Service.createPolicy`, `Service.createProject`, and `Service.reserveRun` create the local state. The harness signs capabilities with the real `issueIngestCapability`. It does not assert that a GitHub job succeeded. Its reservation verification digest is computed from an explicit local-fixture label. It is not evidence of a verified GitHub caller. GitHub calls and queue publication throw if reached. The declarations and uploads run through the real `handleApi` routes. This probe does not finalize, seal, compare, approve, or promote a run.

Manifest digest: `f9893a748b6120e1e3b58abf58da5839c4bb040b7991bf67084e16460665e17d`.

Plan digest: `76c0f491a68d4787cf005373e89f6b09c7c233260241966e361bf453dfb0b10c`.

[source-hashes.json](./source-hashes.json) covers 191 frozen source/configuration/migration files. [artifact-hashes.json](./artifact-hashes.json) covers the harness, compressed exact Worker bundles, fixture, source archive, and the two pinned codec WASM files. The source archive has no dependencies, credentials, local storage, or captured screenshot binaries. The Worker bundles include the dependencies used by this run. The constant local signing keys in the harness have no account privileges and were not sent to an external service. Upload capabilities and ticket strings are not saved in the measurement receipts.

## Measurement limits

- **Memory is unavailable.** Local workerd returns zero stubs from `process.memoryUsage()`. The receipts mark these values unavailable. Neither successful responses nor those zero values prove an isolate peak below 128 MiB.
- Controller wall time includes local dispatch and full response body reading. API time is measured inside workerd and can have coarser clock behavior. Instrumentation adds wrappers and timing operations. It records successful binding returns and cannot count hidden runtime attempts.
- The database wrapper implements `first()` with native `all()` and selects row zero so that it can collect D1 metadata. All covered lookup predicates select one row; the statements and results match the application path, with small wrapper/conversion overhead.
- Only 104 of 12,300 images were uploaded. These small synthetic files do not establish throughput for real screenshot sizes. The complete manifest and ticket response use the requested 12,300-image scale.
- Renewal was requested during the probe; it did not wait 600 seconds for expiration or run the CLI's proactive clock branch. The separate CLI regression covers that branch with a simulated clock. This native probe proves fresh capability/ticket issuance, pending-image selection, and a successful upload with renewed credentials.
- This uses fixed-plan mode and one shard. Candidate discovery, full workflow matrix checks, OIDC, sealing, and a full 40,000-capture run are outside scope.
- Both local Worker configurations specify 30,000 ms CPU and 1,000 subrequests. Successful local execution does not prove that local or hosted quota enforcement applied those settings. The observed wall times are independently below 30 seconds.
- The public workerd binding sends one request for a D1 batch, not one per contained SQL statement. The [binding implementation](https://github.com/cloudflare/workerd/blob/main/src/cloudflare/internal/d1-api.ts) and [subrequest accounting](https://github.com/cloudflare/workerd/blob/main/src/workerd/io/io-context.c%2B%2B) support this distinction. The [D1 limits page](https://developers.cloudflare.com/d1/platform/limits/) and the newer [Workers limits page](https://developers.cloudflare.com/workers/platform/limits/#subrequests) currently describe different paid limits. This run does not establish an account's deployed quota or rule out private backend limits.

## Reproduction

The [portable harness](../../../tooling/evidence/declaration-scale/) includes the exact tested source and Worker bundles. To prepare an empty working directory, link the repository’s already installed pinned dependencies, then run the local probe:

```sh
python3 tooling/evidence/declaration-scale/prepare.py --repository "$PWD" --output /tmp/ariviso-declaration-replay
cd /tmp/ariviso-declaration-replay
node build.mjs
node run.mjs
```

The harness creates fresh temporary native storage for each run and removes that storage after it disposes the runtime. [measurements.json.gz](./measurements.json.gz) contains the recorded full receipts; decompress it to inspect every native query result summary. Source hashes identify the exact tested snapshot, before later root formatting.

`build.mjs` performs Wrangler dry runs only. It does not deploy. The frozen `source` tree uses workspace dependency links to the already installed pinned packages. A different machine must install/link those same dependencies before running it. The handoff contains the exact frozen source archive and bundled Worker gzip files so a changed repository checkout cannot be mistaken for the recorded source. Runtime-generated local IDs can change allocation order and physical database bytes across reruns; protocol fixture digests remain stable.

Formatting and lint passed for the four harness modules. All runtime assertions passed. There was no product-source change to integrate.

An independent reviewer checked all phase sums, the final upload/retained-object assertions, all 191 source hashes, and the bundled source-map contents. No findings were reported. The reviewed receipt SHA-256 is `362577dfa4443ecc4d411c0502007a8cf069ba7d8885adc2a9a4312bc461fb65`.

The portable preparation script was tested in a second empty directory. Its local dry run reproduced both recorded Worker bundle SHA-256 hashes exactly. It did not deploy or repeat the native measurements.
