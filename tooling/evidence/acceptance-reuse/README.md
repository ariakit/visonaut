# Frozen acceptance-reuse receipts

The canonical [archive](./frozen-evidence.tar.gz) contains the unchanged hosted receipts, first-iteration limitation, complete source command journal, cleanup receipt, source/deployment provenance, and independently collected GitHub workflow/job/check responses. [The input record](./INPUTS.json) identifies its bytes and hash. The [evidence summary](../../../docs/evidence/acceptance-reuse/README.md) states the scope.

Run from the repository root with Python 3:

```sh
python3 -B tooling/evidence/acceptance-reuse/verify.py \
  --out /private/tmp/ariviso-acceptance-reuse-check
```

The destination must be new and outside the repository. Before creating it, the verifier checks the pinned archive hash, file count and size, safe relative names, regular-file types, unique paths, and every original file hash. It refuses links and special entries. It then checks the saved workflow, job, image, decision, status, journal, cleanup, and deployment relations.

Output contains `recorded/receipts`, `recorded/github`, `recorded/provenance`, and `VERIFICATION.json`. For example:

```text
recorded/receipts/first-observation-limit.json
recorded/receipts/source-command-journal.json
recorded/receipts/second-rejection-check.json
recorded/receipts/second-undo-check.json
recorded/receipts/cleanup-verification.json
```

The original collection scripts are provenance only. They retain historical paths and require credentials to call remote services. The portable verifier never executes them. It needs no token, dependency installation, reachable Git object, or network connection.

The commit object permits a local commit-to-tree hash check. The build manifest preserves 43 artifact digests, including a configuration-file digest, but the artifact bodies and all credential files are omitted. Deployment logs record the version rollout; constant labels in the D1 inspector do not independently prove deployment state. No local verification result rehashes an omitted runtime bundle or proves OAuth, a complete E03/E06 gate, or launch readiness.

Archive metadata uses sorted paths, regular files with mode 0644, zero owner IDs and timestamps, and gzip timestamp zero. Original historical bytes are not reformatted. The readable wrapper and documentation use the repository's normal checks.
