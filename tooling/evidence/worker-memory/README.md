# Frozen Worker memory receipts

The [archive](./frozen-evidence.tar.gz) contains 15 unchanged selected originals from the local process and inspector diagnostics. It includes the raw HTTP receipts, six-row summary, calibrations, reports, source identities, original hash manifests, and collection scripts. [Archive identity](./INPUTS.json) records its byte count and SHA-256.

Run from the repository root with Python 3:

```sh
python3 -B tooling/evidence/worker-memory/verify.py \
  --out /private/tmp/ariviso-worker-memory-check
```

The output directory must be new and outside the repository. Before it creates the directory, the wrapper checks the archive hash, exact file count and total size, safe relative paths, regular-file types, unique names, and the selected originals against their historical manifests. It refuses links and special entries. It then recalculates all six process-summary rows, verifies all 234 saved response results, and checks the kernel and inspector calibrations. It does not execute the archived collection scripts or start a runtime.

The wrapper writes unchanged originals under `recorded/process` and `recorded/inspector`, plus `VERIFICATION.json`. For example:

```text
recorded/process/REPORT.md
recorded/process/http-measurements.json
recorded/process/http-summary.json
recorded/process/source-manifest.json
recorded/process/calibration-measurements.json
recorded/inspector/inspector-capabilities.json
```

The original process manifest lists omitted runtime, image, Worker, WASM, and duplicate-log bodies as well as the selected files. It is preserved for provenance; the selected archive is not a complete runtime replay package. Historical script paths and commands remain unchanged.

The [evidence summary](../../../docs/evidence/worker-memory/README.md) states the scope. Process RSS is not hosted isolate peak, and the inspector counter omitted the tested WASM memory. No result certifies hosted isolate memory below 128 MiB. E01 and the pending Container permission remain open.

Archive construction uses sorted file paths, regular files with mode 0644, zero owner IDs and timestamps, and gzip timestamp zero. Canonical historical code is inside the archive. No formatter or linter exception was added.
