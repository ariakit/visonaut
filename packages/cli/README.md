# visonaut

Submit verified visual captures from a pinned GitHub Actions workflow and inspect review status.

```sh
visonaut submit --shard linux --shard safari
visonaut submit --no-visual
visonaut status --run <service-run-id> --json
```

`submit --shard` verifies the current signed Submit job and starts the Visonaut App check before artifact downloads and image staging. A separate `begin` command is optional. Run `visonaut begin --run "$GITHUB_RUN_ID"` to start the check earlier in the trusted job. Neither command approves a review.

Run `submit --no-visual` in the native CI Plan job only when its successful calculator says visual capture is unnecessary. This mode sends that false result with the Plan job's signed identity. It accepts an optional `--server` and cannot be combined with capture arguments. It requires the service origin, GitHub run ID, attempt, tested commit, and GitHub Actions OIDC. It needs no capture files, capture package digest, workflow source pin, or GitHub artifact token.

`submit --shard` is the only capture entry point. Each required shard must be unique. The CLI checks the complete GitHub job inventory, requires each visual job to succeed, and downloads its exact ordinary capture artifact. The artifact name is `visonaut-capture-<run-id>-<source-attempt>-<shard-key>`. A visual job that GitHub did not rerun can keep its proven successful source execution at the same tested commit. A rerun job needs fresh evidence. A missing or expired artifact requires a full visual rerun.

Download and ZIP extraction enforce encoded byte, expanded byte, entry count, path, and per-file limits before extracting candidate files. No external archive tool is required.

Each capture artifact contains `manifest.json`, `environment.json`, and digest-named image files. Submit checks their hashes, sizes, test inventory, rendering profiles, repository, tested commit, package digest, and source attempt. It forms a fresh combined manifest, records every verified source, and submits only from the signed trusted job. Candidate code cannot choose its upload authority.

Submit uses local comparison after these checks. The service pins the accepted reference for the complete capture manifest. The CLI compares each capture with that reference using the consumer's recorded screenshot settings. The pixel threshold defaults to `0.2`. An absolute pixel limit and a ratio limit both apply when both are set. A dimension or rendering profile change always requires review.

The final manifest keeps every observed capture and its original digest. Submit uploads only new or changed originals and changed masks. A tolerated image keeps its observed metadata, but its bytes are not uploaded. For example, a capture with `comparison: { threshold: 0.2, maxDiffPixels: 2 }` can remain unchanged when the comparator finds two different pixels.

Local comparison requires PNG captures and PNG references. It checks each candidate before it requests image staging credentials. The limits are 2 MiB per encoded image, 2.1 million pixels, and 8192 pixels per dimension. WebP is supported by the legacy upload protocol, but local Submit fails clearly for WebP; it does not switch upload modes. Use PNG captures and an accepted PNG reference. If the accepted reference changes during Submit, rerun Submit to compare against the new reference.

The pinned capture workflow supplies `GH_TOKEN`, GitHub Actions OIDC, `VISONAUT_SERVER`, `VISONAUT_PACKAGE_SHA256`, `VISONAUT_WORKFLOW_SOURCE_SHA`, `VISONAUT_CAPTURE_JOB_NAME`, and `VISONAUT_SUBMIT_JOB_NAME`. Set `VISONAUT_CAPTURE_JOB_NAME` to a complete name template with one `{shard}` slot, such as `App / Visual Capture ({shard})`. Submit binds the `linux` shard to exactly `App / Visual Capture (linux)`. Set `VISONAUT_SUBMIT_JOB_NAME` to the exact Submit name, such as `App / Visual Submit`. GitHub supplies repository, run, attempt, and tested-commit fields. `RUNNER_TEMP` holds isolated downloaded and combined files. `GITHUB_OUTPUT` receives the signed discovery receipt name and path. Upload that receipt as an ordinary one-day artifact.

The native CI workflow owns the successful Plan result and the no-visual report. The App workflow owns the capture jobs, required shard set, Submit commands, package pin, and receipt upload. The service pins both exact Git blobs. The server verifies signed identity and REST evidence independently.

`status` requires `VISONAUT_TOKEN` with a valid maintainer session. Capture capabilities cannot read private review state. Exit codes are `0` for command success, `1` for operation failure, `2` for invalid arguments, `3` for a run that has not passed, and `4` for authentication or trust failure. A successful submission is not visual approval.

The old `pack`, `upload`, `upload --bundle`, `submit --bundle`, `submit --dir`, and `submit --run` commands are removed. Transfer encryption and key exchange are removed. The CLI no longer depends on the Playwright adapter or its exact peer runtime.
