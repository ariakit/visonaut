# visonaut

This guide describes CLI `visonaut@0.5.3`. Submit verified visual captures from a GitHub Actions workflow and inspect review status. The [current system guide](../../docs/current-contract.md) owns the supersession map and deployment limits.

```sh
visonaut submit --shard linux --shard safari
visonaut submit --no-visual
visonaut status --run <service-run-id> --json
```

`submit --shard` verifies the current signed Submit job and starts the Visonaut App check before artifact downloads and image staging. A separate `begin` command is optional. Run `visonaut begin --run "$GITHUB_RUN_ID"` to start the check earlier in the trusted job. Neither command approves a review.

Run `submit --no-visual` in the native CI Plan job only when its successful calculator says visual capture is unnecessary. This mode sends that false result with the Plan job's signed identity. It accepts an optional `--server` and cannot be combined with capture arguments. It requires the service origin, GitHub run ID, attempt, tested commit, and GitHub Actions OIDC. It needs no capture files or GitHub artifact token.

`submit --shard` is the only capture entry point. Each required shard must be unique. The CLI checks the complete GitHub job inventory, requires each visual job to succeed, and downloads its exact ordinary capture artifact. The artifact name is `visonaut-capture-<run-id>-<source-attempt>-<shard-key>`. A visual job that GitHub did not rerun can keep its proven successful source execution at the same tested commit. A rerun job needs fresh evidence. A missing or expired artifact requires a full visual rerun. D04/W10 selects a measured full-rerun trial only; verified partial and Submit-only reruns remain supported until a later explicit decision.

Download and ZIP extraction enforce encoded byte, expanded byte, entry count, path, and per-file limits before extracting candidate files. No external archive tool is required.

Each capture artifact contains `manifest.json`, `environment.json`, and digest-named image files. Submit checks their hashes, sizes, test inventory, rendering profiles, repository, tested commit, fixed digest, and source attempt. It forms a fresh combined manifest, records every verified source, and submits only from the signed trusted job. Candidate code cannot choose its upload authority.

Submit uses local comparison after these checks. The service pins the accepted reference for the complete capture manifest. The CLI compares each capture with that reference using the consumer's recorded screenshot settings. The pixel threshold defaults to `0.2`. An absolute pixel limit and a ratio limit both apply when both are set. A dimension change always requires review. With equal dimensions, a rendering-profile change needs no review when the comparator finds zero changed pixels. A profile change with nonzero changed pixels still requires review even when the pixel caps would allow them. These local consumer settings are separate from the legacy Worker's 0.05% policy.

The final manifest keeps every observed capture and its original digest. Submit uploads only new or changed originals and changed masks. A tolerated image keeps its observed metadata, but its bytes are not uploaded. For example, a capture with `comparison: { threshold: 0.2, maxDiffPixels: 2 }` can remain unchanged when the comparator finds two different pixels.

Local comparison requires PNG captures and PNG references. It checks each candidate before it requests image staging credentials. The limits are 2 MiB per encoded image, 2.1 million pixels, and 8192 pixels per dimension. WebP is supported by the legacy upload protocol, but local Submit fails clearly for WebP; it does not switch upload modes. Use PNG captures and an accepted PNG reference. Main submissions retain current-baseline guards and can require another Submit after the reference changes. A valid PR submission keeps its verified immutable reference when main alone advances; preserve the [approved PR-baseline rule](../../docs/current-contract.md#approved-pr-baseline-independence).

The capture workflow supplies `GH_TOKEN`, GitHub Actions OIDC, `VISONAUT_SERVER`, `VISONAUT_CAPTURE_JOB_NAME`, and `VISONAUT_SUBMIT_JOB_NAME`. Set `VISONAUT_CAPTURE_JOB_NAME` to a complete name template with one `{shard}` slot, such as `App / Visual Capture ({shard})`. Submit binds the `linux` shard to exactly `App / Visual Capture (linux)`. Set `VISONAUT_SUBMIT_JOB_NAME` to the exact Submit name, such as `App / Visual Submit`. GitHub supplies repository, run, attempt, and tested-commit fields. `RUNNER_TEMP` holds isolated downloaded and combined files. `GITHUB_OUTPUT` receives the signed discovery receipt name and path. Upload that receipt as an ordinary one-day artifact.

The CLI reads neither `VISONAUT_PACKAGE_SHA256` nor `VISONAUT_WORKFLOW_SOURCE_SHA`, and a set value changes nothing. Submit sends one fixed digest, the SHA-256 of the empty text, in `run.planDigest` and in `discovery.executorDigest`. The service compares neither field with a setting.

The native CI workflow owns the successful Plan result and the no-visual report. The App workflow owns the capture jobs, required shard set, Submit commands, and receipt upload. The server verifies signed identity and REST evidence independently.

When the service is at its limit of active runs, `submit --shard` waits and asks the service for a run again, before it stages any image. Each try uses a new GitHub OIDC token. Before each wait, the CLI prints a line on standard error, such as `Visonaut is at its capacity limit (try 1 of 20)`. Each wait is 30 seconds. After 20 tries the CLI fails with exit code `1`, and the job can run again. The 19 waits take 9 minutes 30 seconds, and the time of the requests comes on top. The answers `database_size_exceeded` and `capture_limit_exceeded` need a person, so the CLI does not wait for them.

`status` requires `VISONAUT_TOKEN` with a valid maintainer session. The token has the form `<session token>.<signature>`, which is the URL-decoded value of the session cookie. Capture capabilities cannot read private review state. Exit codes are `0` for command success, `1` for operation failure, `2` for invalid arguments, `3` for a run that has not passed, and `4` for authentication or trust failure. A successful submission is not visual approval.

The old `pack`, `upload`, `upload --bundle`, `submit --bundle`, `submit --dir`, and `submit --run` commands are removed. Transfer encryption and key exchange are removed. The CLI no longer depends on the Playwright adapter or its exact peer runtime.
