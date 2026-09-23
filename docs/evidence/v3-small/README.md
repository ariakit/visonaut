# Completed small v3 recovery drill

This evidence records the completed hosted drill from 2026-09-22. It proves archive, cold backup, group reuse, and inactive recovery for the frozen small fixture. It does not approve launch or establish results for the final implementation.

The fixture has two runs with 3,582 capture identities each. The candidate inherits the baseline's original image ownership. These are not two fresh upload attempts. Historical WebP bytes are repeated across distinct keys. The candidate has 3,582 completed comparison tasks and 36 synthetic changed rows, each approved through `Service.review`. The 1% change fraction is a test input, not an observed production rate. The baseline retains an all-capture decision history as a fixed stress case; do not multiply that one-time history by every daily attempt. [Fixture details](./prepared-summary.json).

## Recorded results

| Step                       | Result                                                                                       | Receipt                                                                                                                                               |
| -------------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source verification        | 7,173 objects, 200,144,034 bytes                                                             | [Source verification](./receipts/source-verified.json)                                                                                                |
| Closed-run archive         | 357 pages, 156,567-byte root                                                                 | [Archive state](./receipts/archive-summary.json), [root and page inventory](./receipts/archive-root.json)                                             |
| Cold backup                | 525.612 seconds; 7 groups, 7,540 objects, 232,185,001 bytes                                  | [Cold summary](./receipts/cold-summary.json)                                                                                                          |
| Next logical daily backup  | 22.601 seconds; the same 7 immutable groups reused                                           | [Warm summary](./receipts/warm-summary.json)                                                                                                          |
| Complete inactive recovery | 1,053.196 seconds, including the failed rotation propagation check and its successful resume | [Phase times](./receipts/phase-timings.jsonl), [recovery result](./receipts/restore-summary.json), [rotation result](./receipts/rotation-result.json) |
| Retained data              | Matching hashes and counts for all 11 checked tables and all 25 archived sections            | [Table fingerprints](./receipts/restored-fingerprints.json), [private history equivalence](./receipts/restored-history-equivalence.json)              |
| Recovery sanitation        | No foreign-key violations, sessions, retained account tokens, or active runs                 | [Recovery result](./receipts/restore-summary.json)                                                                                                    |

The complete recovery interval is 11:10:38.877 UTC through 11:28:12.073 UTC. It includes SQL import, object copying, independent database-reference checks, retained table and private history checks, sanitation, and secret rotation. The old access and ingest credentials then returned HTTP 401; a new ingest credential passed. The recovered target remained inactive. [Detailed events](./receipts/events.jsonl.gz).

The warm backup used a +86,400,000 ms logical clock offset on the same physical test day. This proves a fresh SQL export and immutable group reuse, not an unattended 24-hour scheduling interval or a maximum recovery-point age. Backup byte totals count the object inventory; SQL export sizes are separate fields in each summary.

## Source identity and limits

The drill used a frozen source copy with migrations 0001 through 0012. [Frozen implementation hashes](./receipts/frozen-implementation.json) identify 77 source files. [Build receipt](./receipts/harness-build.json) identifies the deployed Worker bundle. The exact Worker SHA-256 is `25f53e92e9d3fa10e52451ceb565cdaed0826d4ee728e8a9972672c70bb34063`.

The original controller was subsequently adapted to accept portable input paths. The portable controller hash is in [the handoff file inventory](./SOURCE-SHA256.json); it differs from the controller hash in the original build receipt. The deployed Worker is unchanged. The packed replay source preserves both identities so the recorded execution and the portable replay are not confused.

This is earlier source than the final implementation. It does not include later archive packing, paged export, migration, or runtime-bound changes. Its provisional 512 MiB SQL bound and 30-second HTTP CPU limit were sufficient for this fixture only. The separate 1.182 GB SQL workload exceeds that old SQL bound. Do not use these results as evidence for the normal 30-day retained volume, the 35,820-capture workload, full-approval bursts, final queue CPU, or final cost.

The metric receipts contain sampled isolate measurements. They do not establish a continuous hosted peak or safe memory margin. This drill does not prove a 10× recovery time target, the full Ariakit capture matrix, live GitHub authorization, or final launch readiness.

## Files retained in this private repository

All 32 original receipt files are retained under `receipts`. The large event log and two exact metric receipts use deterministic gzip; [receipt hashes](./RECEIPTS.json) identify both its stored bytes and its original uncompressed bytes. [The original handoff inventory](./SOURCE-SHA256.json) retains all 134 original file hashes.

[Curation checks](./CURATION.json) record local input verification, SQL import, link and syntax checks, and the credential scan. These checks do not constitute a new hosted drill or browser run.

The exact SQL fixture, seed-object manifest, metadata documents, and frozen replay source are retained under [the reproduction tooling](../../../tooling/evidence/v3-small/). The prepared SQL gzip is byte-for-byte unchanged. The seed manifest and two tar archives use gzip with timestamp zero. Tar entries use sorted paths, timestamp zero, mode 0644, and zero owner IDs. [Packed input hashes](../../../tooling/evidence/v3-small/INPUTS.json) identify compressed and uncompressed bytes.

The plain SQL is 25,190,422 bytes with SHA-256 `78d6063f58381cde397017f3d7c372a1ad90a79363aef3d73a061dba70357e93`. It contains one synthetic session token and three synthetic account-token fields. These four deliberately invalid diagnostic values match literals in the fixture generator. They exercise recovery sanitation and are not live credentials. The original Service transitions generated random identifiers, so a regenerated semantic fixture cannot reconstruct these exact SQL bytes. The preparation script unpacks and verifies the recorded input; it does not regenerate it. A second preparation from the committed file layout reconstructed all 134 original hashes after receipt compression.

The only fixture bytes kept outside this repository are the original images in the private read-only corpus bucket named by the frozen Wrangler template. The committed manifest preserves their keys, sizes, and hashes. A hosted replay requires authorized access to that corpus. The diagnostic wrapper permits reads for its fixed mapping and has no corpus list, write, or delete method. Browser binaries, pinned dependencies, live secrets, and new diagnostic resources are also external prerequisites.

## Prepare a replay

Preparation is local and makes no network requests. Run from the repository root with Python 3:

```sh
python3 tooling/evidence/v3-small/prepare.py /private/path/to/new-v3-small
```

The destination must not exist. The script verifies all compressed inputs, reconstructs the original handoff in `recorded`, and checks all 134 original hashes. It writes SQL and the relocated object manifest to `fixture`. It creates `replay` with the unchanged frozen executable files and placeholders for fresh writable resources. Original historical resource IDs remain only in `recorded` for provenance.

Use Node 24.18.0 and Wrangler 4.136.1 with the pinned Ariviso dependency installation. The preparation script does not install dependencies, create resources, deploy, or execute the drill. For an authorized hosted replay, create four fresh D1 databases and five fresh R2 buckets. Fill the same fresh values in `replay/wrangler.jsonc`, `replay/controller/wrangler.jsonc`, and `replay/controller/resources.json`. Keep the existing private corpus binding read-only. Never reuse a production writable binding or an old restore target.

Deploy the frozen bundle from `replay/wrangler.jsonc`. Install fresh fixture-only `DRILL_TOKEN`, `AUTH_SECRET`, and `INGEST_CAPABILITY_SECRET` secrets. Store the diagnostic bearer at `replay/controller/token` with mode 0600. Keep the D1 export-only credential on the operator machine; it is not bound to the Worker. Set all paths and the fresh endpoint explicitly:

```sh
export APPLICATION_ROOT=/path/to/ariviso
export FIXTURE_DIRECTORY=/private/path/to/new-v3-small/fixture
export EXPORT_TOKEN_FILE=/private/path/to/export-only-token
export DRILL_ENDPOINT=https://fresh-diagnostic-worker.workers.dev
cd /private/path/to/new-v3-small/replay/controller
node phases.mjs small seed verify-source archive cold warm restore rotate
```

The frozen controller has historical default paths and an endpoint. Do not rely on those defaults. Use a new empty `replay/controller/results` directory. Keep failed checkpoints for a resume; each resume verifies the root, SQL identity, import marker, and existing copies. A new replay produces new timestamps and generated identities. Retain those results separately from these recorded receipts.
