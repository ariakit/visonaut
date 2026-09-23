# Frozen large v3 archive and backup measurements

The September 22, 2026 receipts show a completed archive and completed cold and warm backups for the frozen 35,820-capture fixture. They do not show a completed large restore, sustained capacity, current-source performance, or launch readiness. E07 and E08 remain open.

The fixture has two runs and 71,640 capture records before archive compaction. The candidate inherits original ownership from the baseline. It has 359 deliberately changed and reviewed captures. Repeated historical image bytes, inherited originals, and a fixed baseline decision history are test inputs. They do not establish future capture sizes, an observed change rate, or a monthly workload.

## Recorded results

| Measurement                                             |                                        Result |
| ------------------------------------------------------- | --------------------------------------------: |
| Archive controller interval                             |                             2,050.323 seconds |
| Archive pages                                           |                                         3,408 |
| Archive root and page bytes                             |                                   299,995,133 |
| Archive application D1 reads                            |                                   421,489,106 |
| Archive D1 writes, including returned index units       |                                       141,749 |
| Cold backup interval, including failure and restart gap |                5,772.659 seconds (96m12.659s) |
| Warm backup interval                                    |                               115.555 seconds |
| Backup object inventory, both phases                    | 75,195 entries, 2,378,004,765 bytes, 7 groups |
| Cold SQL snapshot, separate from object inventory       |                             204,623,590 bytes |
| Warm SQL snapshot, separate from object inventory       |                             204,630,431 bytes |

The cold interval starts with the first controller attempt and ends with the successful command exit. It retains the failed command, retry work, and restart gap. The warm phase reuses the same seven immutable groups. It uses a logical clock offset of one day on the same physical test day. It does not prove unattended scheduling or a maximum recovery-point age.

The [frozen numeric bundle](../../../tooling/evidence/v3-large-numeric/README.md) retains the exact archive report, backup report, and backup analysis. Its wrapper extracts the original calculation details for inspection. The archive required 90.573 times the application D1 reads of the small fixture for ten times the captures. That observation belongs to the frozen query and packing rules.

## Operation accounting and cost limits

| Recorded application unit |    Cold | Warm |
| ------------------------- | ------: | ---: |
| R2 Class A calls          |  75,283 |    3 |
| R2 Class B calls          | 229,394 |    3 |
| D1 rows read              | 186,436 |  220 |
| D1 rows written           |   2,940 |   76 |

These counts remove only identified diagnostic marker/staging calls and endpoint inspection queries. All failed work remains. They are returned API receipts, not provider billing meters. Multipart staging, final manifest inspection, controller polling, and other work outside the event ledger remain separate. Handler wall time and SQL time are not Worker CPU.

The cadence calculation in the frozen bundle compares 30 and 60 completed SQL roots over 30 days while keeping this seven-group inventory fixed. For the large fixture, those roots contain 6,138,912,930 or 12,277,825,860 SQL bytes. The calculation uses the rates saved in the original model. It is a sensitivity calculation, not a monthly workload forecast or an incremental shared-account bill. It does not bound future copy duration, contention, or RPO.

The Worker metric receipts in the frozen bundle cover diagnostic windows with adaptive sampling. Their CPU estimates cannot be assigned to the backup code alone. Sampled memory does not establish a continuous isolate peak or safe memory margin. Platform error counts do not replace the application failure receipts.

## Source identity and open recovery work

The frozen source contains 77 files and migrations through 0012. It uses the earlier archive packing and daily backup identities. Three progress-record changes distinguish it from the [small drill](../v3-small/README.md). The exact base, progress source, and Worker bundle identities remain in the package. Later packing, retention, migration, and 12-hour schedule changes are outside this measurement.

This bundle contains no complete large restore interval or capacity result. The separately reported four-way and sixteen-way restore trials were not complete when this record was prepared. The eight-way trial had an unexplained HTTP 500 and resumed on the same prefix; it is not a clean capacity pass. No partial copy duration is a full RTO. Completion requires the remaining copy, verification, sanitation, rotation, and recovery checks with their full elapsed time.

## Local verification and retained files

The [numeric package](../../../tooling/evidence/v3-large-numeric/README.md) contains 65 files, including 58 original artifacts. All 65 files are preserved unchanged inside one deterministic archive. The package manifest SHA-256 is `768e0a52750c20159bea94df9009eba93af4962abb58359b502e62f4a884a172`. The original portable verifier SHA-256 is `4a94dfb7eff588f76bb4165cddda37d06977448c3a696260f67ecfe7be72c3f2`.

The readable wrapper first verifies and extracts the archive. It then runs the exact original verifier, which uses 18 exact files from the committed small drill. It reconstructs both 77-file source inventories and the filtered event receipts, then recalculates the archive, backup, cadence, and sampled-metric totals. An independent local curation run passed. [Curation checks](./CURATION.json) record the scope. These checks do not constitute a new hosted run or the final implementation review.

Run from the repository root with a new output path outside the repository:

```sh
python3 -B tooling/evidence/v3-large-numeric/verify.py \
  --repository . \
  --out /private/tmp/ariviso-large-numeric-check
```

The package omits the four SQL export bodies. Their recorded sizes and digests agree across the receipts, but this local check cannot rehash the omitted bytes. The private image corpus, live credentials, fresh resources, runtime dependencies, and some historical cost-model bodies are also omitted. The retained original scripts and reports are inside the archive and have historical paths and links. Use the portable verifier for local checks; those original commands are provenance, not portable hosted replay instructions.
