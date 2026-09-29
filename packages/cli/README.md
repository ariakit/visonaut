# visonaut

Submit verified visual captures from a pinned GitHub Actions workflow and inspect review status.

```sh
visonaut begin --run "$GITHUB_RUN_ID"
visonaut submit --shard linux --shard safari
visonaut status --run <service-run-id> --json
```

`submit` calls `begin` before any artifact download. The `begin` command verifies the current signed Submit job and starts the Visonaut App check before downloads and image staging. It does not approve a review.

`submit --shard` is the only capture entry point. Each required shard must be unique. The CLI checks the complete GitHub job inventory, requires each visual job to succeed, and downloads its exact ordinary capture artifact. The artifact name is `visonaut-capture-<run-id>-<source-attempt>-<shard-key>`. A visual job that GitHub did not rerun can keep its proven successful source execution at the same tested commit. A rerun job needs fresh evidence. A missing or expired artifact requires a full visual rerun.

Download and ZIP extraction enforce encoded byte, expanded byte, entry count, path, and per-file limits before extracting candidate files. No external archive tool is required.

Each capture artifact contains `manifest.json`, `environment.json`, and digest-named image files. Submit checks their hashes, sizes, test inventory, rendering profiles, repository, tested commit, package digest, and source attempt. It forms a fresh combined manifest, records every verified source, uploads private service data, and submits only from the signed trusted job. Candidate code cannot choose its upload authority.

The pinned workflow supplies `GH_TOKEN`, GitHub Actions OIDC, `VISONAUT_SERVER`, `VISONAUT_PACKAGE_SHA256`, `VISONAUT_WORKFLOW_SOURCE_SHA`, `VISONAUT_CAPTURE_JOB_PREFIX`, and `VISONAUT_SUBMIT_JOB_NAME`. GitHub supplies repository, run, attempt, and tested-commit fields. `RUNNER_TEMP` holds isolated downloaded and combined files. `GITHUB_OUTPUT` receives the signed discovery receipt name and path. Upload that receipt as an ordinary one-day artifact.

The small visual workflow owns the required shard set, commands, package pin, and receipt upload. The service pins its exact Git blob. Unrelated build and deployment workflow changes do not alter that pin. The server verifies signed identity and REST evidence independently.

`status` requires `VISONAUT_TOKEN` with a valid maintainer session. Capture capabilities cannot read private review state. Exit codes are `0` for command success, `1` for operation failure, `2` for invalid arguments, `3` for a run that has not passed, and `4` for authentication or trust failure. A successful submission is not visual approval.

The old `pack`, `upload`, `upload --bundle`, `submit --bundle`, `submit --dir`, and `submit --run` commands are removed. Transfer encryption and key exchange are removed. The CLI no longer depends on the Playwright adapter or its exact peer runtime.
