# Frozen large v3 numeric evidence

The [archive](./frozen-evidence.tar.gz) is the canonical copy of all 65 files from the supplied numeric handoff. No original file was formatted or changed. The archive includes 58 original artifacts, the original manifests and reports, and the exact original portable verifier. [Archive identity](./INPUTS.json) records its byte count and SHA-256.

The archive preserves the original package manifest SHA-256 `768e0a52750c20159bea94df9009eba93af4962abb58359b502e62f4a884a172` and original verifier SHA-256 `4a94dfb7eff588f76bb4165cddda37d06977448c3a696260f67ecfe7be72c3f2`. The readable `verify.py` beside this file is the new extraction wrapper. Its bytes differ from the original verifier by design.

Run from the repository root with Python 3:

```sh
python3 -B tooling/evidence/v3-large-numeric/verify.py \
  --repository . \
  --out /private/tmp/ariviso-large-numeric-check
```

The output directory must be new and outside the repository. Before it creates that directory, the wrapper checks the archive hash, exact file count and total size, safe relative paths, regular-file types, unique names, original package manifest, all 65 file identities, and original verifier identity. It refuses links and special entries. It writes the unchanged package under `frozen-package` and runs the hash-verified original verifier in isolated Python mode. No service call, runtime dependency installation, deployment, or hosted replay occurs.

The original verifier writes its reconstructed sources, event receipts, calculations, and `VERIFICATION.json` under `numeric-check`. It uses 18 exact files from the existing small-drill evidence to reconstruct the two 77-file frozen source inventories. `PREPARATION.json` records the wrapper's identities and output paths.

To inspect an original report after verification, open these paths under the output directory:

```text
frozen-package/originals/cost-model/large-archive/REPORT.md
frozen-package/originals/cost-model/large-backup/completed-01/REPORT.md
frozen-package/originals/cost-model/large-backup/completed-01/analysis.json
frozen-package/originals/cost-model/cadence-sensitivity/projection.json
frozen-package/originals/cost-model/large-backup/metrics-01/SUMMARY.json
```

Those files retain historical paths, commands, formatting, and review scope. Their original commands are provenance, not portable hosted replay instructions. Use the wrapper above for the local check. The [evidence summary](../../../docs/evidence/v3-large-numeric/README.md) states the measurement and recovery limits.

The four backup SQL bodies, private image corpus, live credentials, fresh resources, runtime dependencies, and some historical cost-model bodies remain omitted. The saved SQL identities agree across the retained receipts, but the local check cannot rehash omitted SQL bytes. The frozen drill uses migrations through 0012 and earlier packing and daily backup identities. A successful local check does not establish final-source performance, large RTO, sustained capacity, or launch readiness.

Archive construction uses sorted file paths, regular files with mode 0644, zero owner IDs and timestamps, and gzip timestamp zero. Canonical historical code is inside the archive. No formatter or linter exception was added.
