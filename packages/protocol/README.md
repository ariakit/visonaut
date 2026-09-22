# Internal Ariviso protocol

This package is private. The public clients bundle its runtime and declaration types. It contains no server credentials or server authorization code.

Manifest `schemaVersion` is `1.0`. A server accepts compatible `1.x` additions and preserves unknown optional fields. It rejects another major version with `UNSUPPORTED_SCHEMA`. Unknown fields remain part of the canonical payload digest.

```ts
const manifest = parseManifest(JSON.parse(input));
await validateManifestProfiles(manifest);
await validateShardAgainstPlan(manifest, trustedMainPlan);
const manifestDigest = await digestJson(manifest);
```

`parseManifest` validates required fields, explicit safe keys, increasing ordinals, unique item/variant identities, successful selected test attempts, supported image types, referenced profiles, profile/variant agreement, and safe local image paths. Byte digest and image decoding checks still belong at the trusted service boundary. `validateShardAgainstPlan` requires the exact trusted test and capture order, the repository ID, the plan digest, and allowed environment profiles. A client field such as `coverage: "full"` has no authority.

The plan lists all required shards, tests, captures, and accepted environment profile digests. Read it only from trusted main configuration. A workflow, ref, job name, attempt, and tested commit must also be verified with GitHub. Effective clip geometry stays in the full capture profile digest used for acceptance. `digestEnvironmentProfile` excludes only `captureOptions.clip`, so changed content geometry does not require a trusted-plan rollout. Workflow shard inheritance still compares the complete capture profiles. This package cannot prove GitHub provenance, inherit shards, seal a run, or grant acceptance.

`digestJson` computes SHA-256 over UTF-8 canonical JSON. Object keys use UTF-16 code-unit order; array order is preserved. Only finite JSON values are accepted. `identityKey` encodes the pair of explicit keys without using display names.

## HTTP version 1

All JSON requests and responses use `Content-Type: application/json`. Binary uploads use the declared image media type. IDs and ticket tokens are encoded as single URL path components. Redirects are not part of this protocol.

| Method | Path                       | Request              | Response               | Authority                                |
| ------ | -------------------------- | -------------------- | ---------------------- | ---------------------------------------- |
| POST   | `/v1/runs`                 | `ReserveRunRequest`  | `ReserveRunResponse`   | GitHub OIDC bearer                       |
| POST   | `/v1/runs/:id/shards/:key` | `Manifest`           | `DeclareShardResponse` | Short-lived shard capability             |
| PUT    | `/v1/uploads/:ticket`      | Original image bytes | Successful 2xx         | Same shard capability and bounded ticket |
| POST   | `/v1/runs/:id/finalize`    | `FinalizeRequest`    | `RunStatus`            | Same shard capability                    |
| GET    | `/v1/runs/:id`             | None                 | `RunStatus`            | Separate private read authorization      |

An upload capability cannot read private run status or change a review decision. A reserve response supplies its expiration. A shard declaration returns a canonical manifest digest and upload tickets bound to image digests and maximum bytes. Replaying the same manifest is harmless; a changed manifest under the same shard identity must return a conflict. The service computes image digests from received bytes. It must not open a submitted local image path.

Finalization validates one shard and may leave the full run uploading. Only complete trusted evidence permits sealing. The client must not interpret an upload or finalization response as visual approval. Structured errors use `ProtocolErrorBody` with a stable code and a private diagnostic message.

## Trusted candidate discovery

A trusted plan can set `discovery: { executorDigest }`. In this mode, each fixed shard has a `collection` configuration instead of static `tests`. The collection fixes the project, repository-relative test directory, file patterns, grep patterns, shard allocation, and repeat count. The immutable trusted-main executor injects this configuration and reporter. Candidate code cannot select another reporter, configuration, command-line filter, project, or shard. All declared jobs remain required.

The trusted reporter freezes the complete collected test inventory before execution. Every collected test must have a final successful attempt. Every started capture must complete, even if a test catches its error. Successful calls determine candidate item/variant identities. Added, removed, and renamed calls or tests can therefore change the candidate without a main-plan rollout. A test or capture that fails, skips, or is missing cannot become a removal.

`validateShardDeclaration` permits quarantine staging. It does not authorize sealing, removals, or success. `validateShardAgainstPlan` additionally requires `VerifiedDiscoveryEvidence` from the server's GitHub verifier. The evidence binds the exact run, attempt, tested SHA, job, trusted executor, successful job conclusion, and canonical manifest digest. Do not construct this evidence from an uploaded JSON object.

The reporter writes `receipt.json` next to its manifest. The immutable workflow uploads this receipt as one GitHub artifact using the generated `artifactName`, with overwrite disabled and missing-file/conflict failures enabled. The artifact name is `ariviso-discovery-<attempt>-<jobId>-<encodedShardKey>-<manifestDigest>`. `discoveryArtifactPrefix` and `createDiscoveryReceipt` provide this spelling. After the exact job succeeds, the server independently lists its run artifacts and requires exactly one nonexpired matching receipt. The digest from GitHub artifact metadata must match the ingested manifest. A modified subset cannot reuse the original receipt.

This boundary depends on the pinned reusable workflow, trusted configuration and reporter injection, fixed artifact step, and GitHub job verification. Candidate code still supplies screenshot content. GitHub identity and receipt evidence do not prove screenshot truth. Keep capability and artifact credentials outside the candidate process where possible. The service never executes candidate manifests or installs candidate packages.
