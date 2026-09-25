# visonaut

The Visonaut CLI stages a capture shard, submits a trusted GitHub workflow run, and reads the run's status. It does not control pages or grant visual approval. Use `@visonaut/playwright` to capture prepared pages.

```sh
pnpm add -D visonaut @visonaut/playwright
# In the OIDC-free visual job:
pnpm exec visonaut pack --dir visonaut --output visonaut.enc
# In a separate signed upload job:
pnpm exec visonaut upload --bundle visonaut.enc
# After every upload job succeeds:
pnpm exec visonaut submit --run "$GITHUB_RUN_ID"
```

Set `VISONAUT_SERVER` to the service origin. You can also pass `--server https://your-service.example`. The origin must use HTTPS. Local development can use HTTP on `localhost`, `127.0.0.1`, or `::1`. Redirects are refused. The CLI sends all image bytes through the service.

## GitHub Actions uploads

Packing needs no GitHub OIDC permission. Upload and submit require GitHub Actions OIDC. Give only trusted upload and submit jobs `id-token: write`; run candidate tests in separate render jobs without OIDC. Upload requests the service origin as its audience. Submit requests the service origin followed by `/submit`. The service verifies the pinned workflow, job, run, attempt, and tested commit before it accepts either operation.

```yaml
jobs:
  visual:
    permissions:
      contents: read
    steps:
      # Run the visual tests and produce the reporter's capture directory.
      - run: pnpm exec visonaut pack --dir visonaut --output visonaut.enc
      # Upload the encrypted file as a short-lived Actions artifact.
  upload:
    needs: visual
    permissions:
      actions: read
      id-token: write
    steps:
      # Download the encrypted artifact from the visual job.
      - run: pnpm exec visonaut upload --bundle visonaut.enc
  submit:
    needs: upload
    permissions:
      contents: read
      id-token: write
    steps:
      - run: pnpm exec visonaut submit --run "$GITHUB_RUN_ID"
```

Set `VISONAUT_SERVER` in the visual and trusted jobs. The example shows the dependency, not a complete workflow. The pinned workflow owns the capture matrix and job names. `pack` requires the reporter's `manifest.json`, measured `environment.json`, and images in the same directory. `upload --bundle` decrypts and validates that artifact in the signed job before staging it. The plain `upload --dir` form reads `manifest.json` inside the capture directory (`visonaut` by default). Image paths must stay inside the directory and cannot contain symbolic links. Each image must match its declared byte count and SHA-256 digest. The service checks the actual format and decoded content again. A client manifest cannot prove that a run is complete.

`submit --run` takes the numeric GitHub workflow run ID from the final pinned job. It records submission intent and returns before the service verifies that the signed submit job and every pinned capture job succeeded and staged a valid bundle. The surrounding CI workflow may still be running while Gate waits for Visonaut review. For a pinned one-upload-job workflow, `submit --dir` uploads and submits from that one trusted job. The service refuses this form from a submit-only job in a multi-job workflow. A successful upload or submit does not grant visual approval. Neither command waits for a person.

To retry an interrupted upload, use the same manifest. The service accepts identical shard replays and can omit tickets for images it already has. Changed files, conflicting shard data, or a superseded attempt fail. For image uploads and status reads, the CLI retries an explicit temporary `503` response with a valid `Retry-After` header up to five total attempts within one 30-second deadline. It resends the same validated image bytes. It does not retry authentication failures, invalid images, conflicts, network failures, or other commands.

During a long upload, the CLI obtains a fresh capability and repeats the same declaration before fewer than 45 seconds remain on the current capability. The service returns fresh tickets for images that are still incomplete. Renewal must keep the same run and manifest, and successful uploads must occur between renewals. Completed images are counted once. A failed renewal stops the command; use the same upload command to resume.

## Private status

Status requires `VISONAUT_TOKEN`, a current Better Auth maintainer session token. The service checks current repository access. An upload capability or GitHub OIDC token cannot read private status. Set the token through your environment or secret manager; do not put it in a command argument.

```sh
# VISONAUT_SERVER and VISONAUT_TOKEN are already set in the environment.
pnpm exec visonaut status --run run-id
pnpm exec visonaut status --run run-id --json
# Set VISONAUT_RUN to omit --run.
pnpm exec visonaut status
```

Text status output reports the state, shard progress, errors, and review URL. Status JSON contains `schemaVersion`, `runId`, `state`, `reviewUrl`, `completedShards`, `expectedShards`, and `errors`. Upload JSON reports the staged shard, its manifest digest and image count, and `visualApproval: false`. Submit JSON reports `state: "submitted"`, the internal run ID, submission time, and `visualApproval: false`. With `--json`, errors are JSON on stderr; successful command output is on stdout.

| Exit code | Meaning                                                                                |
| --------- | -------------------------------------------------------------------------------------- |
| 0         | Upload/submit completed, status is `passed`, or help was shown.                        |
| 1         | Local data, protocol, network, or service operation failed.                            |
| 2         | Arguments or service origin are invalid.                                               |
| 3         | Status was read, but the run is not `passed`. This includes pending and failed states. |
| 4         | Credentials are missing, invalid, expired, or lack permission.                         |

`pack`, `upload`, `submit`, and `status` are supported. Use `--help` for exact flags. Recompare and export are web app operations.

## Supported environment and defensive limits

Release validation uses Node.js 24.18.0, pnpm 12.5.1, TypeScript 6.0.2, and Playwright 1.63.0. Broader runtime support is not claimed. The package bundles its protocol code and depends on the matching `@visonaut/playwright` package for encrypted workflow transfers. It contains no server code or credentials.

The CLI limits manifests to 8 MiB, individual encoded images to 20 MiB, total encoded images per shard to 1 GiB, and each request to 30 seconds. JSON responses have a 2 MiB limit, except successful shard declarations. Their limit is 8 KiB plus 4,352 bytes per unique image in the validated local shard: a ticket can contain up to 4,096 ASCII characters, with room for its digest, byte count, and JSON syntax. Repeated images do not increase this limit. Both the declared content length and the bytes actually read must fit. The CLI also rejects excess, duplicate, or unknown image tickets before it uploads an image.

These are defensive transport bounds, not measured performance or cost budgets. The service can enforce lower limits. Files are read one at a time. Unknown major protocol versions are refused; compatible optional fields remain part of the manifest digest.

The OIDC request method follows [GitHub's OIDC reference](https://docs.github.com/en/actions/reference/security/oidc). Credentials remain in memory. The CLI does not write tokens to disk or print them in output.
