# Frozen repeated-capture evidence

The [archive](./frozen-evidence.tar.gz) preserves all 27 original aggregate reports, receipts, and analysis scripts plus their original `HASHES.json`. All 28 files are byte-for-byte unchanged. The archive is the canonical historical record. [INPUTS.json](./INPUTS.json) records its identity, original byte count, and omitted inputs. Historical JavaScript and JSON remain inside the archive; no formatter or linter exception was added.

Run from the repository root with Python 3.9 or later:

```sh
python3 -B tooling/evidence/ariakit-capture-measurement/verify.py \
  --out /private/tmp/ariviso-capture-evidence-check
```

The output directory must be new and outside the repository. Before creating it, the wrapper checks the archive's pinned SHA-256 and size, exact member count and total bytes, canonical safe relative paths, regular-file types, unique names, original hash-manifest identity, and every original file hash. It rejects links and special entries. It then checks saved run, source, browser, pass, attempt, inventory, validation, and comparison counts for consistency. It verifies recorded means from their totals and counts.

The wrapper extracts only the exact verified files under `frozen-package` and writes `VERIFICATION.json` beside them. The output explicitly sets `privateImagesRevalidated`, `sourceAndCodecBodiesRevalidated`, `recordedQuantilesRecalculated`, `executedHistoricalScripts`, and `hostedReplay` to `false`. No network request, package installation, historical script execution, or service call is made.

Useful preserved files under the output directory are:

```text
frozen-package/README.md
frozen-package/SCOPE.md
frozen-package/summary.json
frozen-package/workload.json
frozen-package/scope.json
frozen-package/firefox/attempt-coverage.json
frozen-package/independent-audit/receipt-full-matrix.json
```

The historical independent audit joined every capture marker with its original PNG, checked last-successful retry selection, recalculated profile digests, and ran the recorded service validator and WASM comparator. Its source and receipt remain in the archive. It required private evidence and runtime files omitted here. The new wrapper verifies that receipt's recorded identities and totals; it does not repeat that audit. Its result is local receipt consistency, not revalidation of omitted image bytes or source and codec bodies. Recorded percentiles and individual digest deduplication cannot be recalculated without those inputs.

The omitted inputs are raw screenshots, Playwright blobs, encrypted artifacts, authenticated raw archives, the private key, comparator source bodies, codec binaries, dependencies, and the original upstream test inventory. Historical paths and commands are provenance, not portable replay instructions. The [public report](../../../docs/evidence/ariakit-capture-measurement/README.md) and [scope report](../../../docs/evidence/ariakit-capture-measurement/SCOPE.md) state what the hosted capture run and separate local analysis establish.

Run the stdlib regression checks with `python3 -B tooling/evidence/ariakit-capture-measurement/test_verify.py`. They exercise the public command, exact extracted bytes, refused output paths, archive mutations, and inconsistent saved counts. [Curation results](../../../docs/evidence/ariakit-capture-measurement/CURATION.json) record the local check and its limits.

The archive uses sorted regular-file paths, mode 0644, zero owner IDs and timestamps, USTAR, and gzip timestamp zero. Repacking changes the archive identity and requires an explicit evidence update even when the file bytes remain equal.
