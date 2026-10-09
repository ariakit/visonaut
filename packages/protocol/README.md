# Internal Visonaut protocol

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

## Capture pages

The capture pages are a second request form of HTTP version 1. They stand beside the `Manifest` requests above. A client selects them with `comparisonMode: "local-pages-v1"` (`CAPTURE_PAGES_MODE`) in the reserve call. This form has no limit for the capture count of a run: each bound is a bound of one row, of one page, or a value that the reader gives.

### Row, page, and index

A capture page (`CapturePage`) has at most 2,000 rows (`CAPTURE_PAGE_ROWS`) and four shared lists: `variants`, `profiles`, `tests`, and `comparisons`. Its canonical JSON text has at most 4 MiB (`CAPTURE_PAGE_MAX_BYTES`). `parseCapturePage` checks each field bound and each rule below. `capturePageBytes` returns the canonical bytes and refuses a page above the byte bound. A reader bounds the body with the same constant before it parses the text.

- The rows are in the order of the item key and then the variant key, and each row is after the row before it. So no page has one capture two times. The order is the code unit order of the keys. A key holds ASCII characters only, so this is also the byte order. `compareCaptureIdentity` is the comparison.
- Each page of a run but the last one has exactly 2,000 rows. A reader of one page cannot check this rule. The reader of all pages of a run checks it.
- Each shared list has the order of first use by the rows. Each entry is used by a row, and no entry is in a list two times. Two entries of `variants` can have one key and two contents, as in a manifest. So the same captures always give the same page bytes and the same digest.
- All images are PNG. One image digest has one size in a page.

A row (`CaptureRow`) is an array of 12 positions. It has no field names, because a name in each row is a repeated value.

```ts
const page = parseCapturePage(JSON.parse(text));
for (const row of page.rows) {
  const capture = await captureRowView(page, row);
  capture.itemKey; // "dialog/open"
  capture.variant.key; // "react-light"
  capture.profileDigest; // the digest of the complete profile, with the clip rectangle
}
```

Read a row with `captureRowView`, and do not index a row by number. A new position of a row needs a new minor schema version, and `parseCapturePage` refuses a row that does not have 12 positions.

A row holds the clip rectangle of its capture, and the profile in `profiles` then has no `captureOptions.clip`. A `clip` value that is not exactly the four numbers `x`, `y`, `width`, and `height` stays in the profile, and the row has `null`. The validator refuses the other forms, so one capture has one row form. Captures that differ only in the rectangle then share one profile. `captureRowProfile` splits a profile, and `captureRowView` puts the rectangle back, so `profileDigest` is the digest that the capture job computed.

The result of a row (`CaptureRowResult`) has three forms:

| Value     | Meaning                                                                                                                                                                                      |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0`       | The capture has the bytes of its reference.                                                                                                                                                  |
| `1`       | The capture is new. It has no reference.                                                                                                                                                     |
| An object | The Submit job compared the pixels. The object has the reference digest, the outcome, the changed pixels, the ratio, the size flag, and a mask for a changed capture with pixel differences. |

`capturePageUploads` returns the images of a page that need bytes: each new or changed capture, and each mask.

The page index (`CapturePageIndex`) lists the pages of one run in their order. Each entry has the page digest and the identity of the last row of the page. The index also names the Submit job, the capture jobs (`sources`), the comparison engine, and the reference. It holds no count of the captures. Its two lists grow with the run, so `parseCapturePageIndex` takes their bounds from the caller, and the protocol has no constant for them. A reader also bounds the bytes of the index body with a value of its own, before it parses the text. As in a manifest, an unknown field of a page or of the index stays and is a part of the digest.

```ts
const index = parseCapturePageIndex(JSON.parse(text), { maximumPages: 10, maximumSources: 16 });
const manifestDigest = await capturePagesDigest(index);
```

The page digest is `digestJson(page)`: SHA-256 of the canonical JSON bytes of the parsed page. A client sends exactly these bytes as the request body (`capturePageBytes`). A service computes the digest from the parsed page and not from the body, so a body with another key order or another number form has the same digest. A service that stores a page stores `capturePageBytes(page)`, and one hash of the stored bytes then gives the digest. The manifest digest of a run is `capturePagesDigest(index)`, the SHA-256 of the canonical JSON of the index. The index holds each page digest in the order of the pages, so the manifest digest is a digest of the page digests.

### Requests

| Method | Path                                           | Request                  | Response               |
| ------ | ---------------------------------------------- | ------------------------ | ---------------------- |
| POST   | `/v1/runs`                                     | `ReservePagesRequest`    | `ReservePagesResponse` |
| GET    | `/v1/runs/:id/reference/:digest/pages/:number` | None                     | `CapturePage`          |
| GET    | `/v1/runs/:id/reference/images/:digest`        | None                     | PNG bytes              |
| POST   | `/v1/runs/:id/pages`                           | `CapturePage`            | `DeclarePageResponse`  |
| POST   | `/v1/runs/:id/reuse`                           | `ReusePageImagesRequest` | `ReuseImagesResponse`  |
| PUT    | `/v1/uploads/:ticket`                          | PNG bytes                | Successful 2xx         |
| POST   | `/v1/runs/:id/index`                           | `CapturePageIndex`       | `StagedPagesResponse`  |

The reserve response has the reference of the run (`CaptureReference`). Its `digest` is an opaque identity of the reference inventory. The service gives it, and it has the form of a digest. A client only compares it for equality, puts it into the path of a reference page, and copies it into the index. When the capability of a run is renewed and the identity is another one, the reference changed, and the client stops. A run with no reference has `digest: null` and `pages: 0`.

A reference page is a `CapturePage` with the captures of the reference in the order of the format. The page numbers are 1 to `reference.pages`, and the order continues from one page to the next. A reference page can have each row count from 1 to 2,000. A client reads the keys, the profile, and the image digest, bytes, width, and height of a reference row. It ignores the result and the test. A client gets a reference image by its digest and checks the digest of the bytes.

A client sends each page, then the images that the response asks for, then the index. The rules for a service:

- A second `POST` of the same page bytes is safe. Its response has the tickets of the images that the service still does not have. A client sends a request again after a network failure.
- A second `POST` of the same index bytes is safe and gives the same response.
- The response of the index has the manifest digest that the service computed. A client compares it with its own.
- The service finds the removed captures itself: the reference and the run have the same order. A client sends no list of removals.

The Submit job is the only job that makes pages. It merges the files of the capture jobs in the order of the format, and it refuses two captures with the same item key and variant key.

The receipt artifact of this form has the name `visonaut-discovery-<attempt>-<jobId>-<encodedShardKey>-<manifestDigest>`, with the manifest digest of the index. `createCapturePagesReceipt` gives the name and the content (`CapturePagesReceipt`). The content has eight short values and no list, so it does not grow with the run.

## Trusted candidate discovery

A trusted plan can set `discovery: { executorDigest }`. In this mode, each fixed shard has a `collection` configuration instead of static `tests`. The collection fixes the project, repository-relative test directory, file patterns, grep patterns, shard allocation, and repeat count. The workflow of the consumer repository injects this configuration and reporter. The service fixes no executor: it takes `executorDigest` from the manifest and compares it with no setting. The CLI and the adapter send `FIXED_DIGEST`, the SHA-256 of the empty text, in this field and in `run.planDigest`. So a pull request that edits the workflow can select another reporter, configuration, command-line filter, project, or shard. All declared jobs remain required.

The trusted reporter freezes the complete collected test inventory before execution. Every collected test must have a final successful attempt. Every started capture must complete, even if a test catches its error. Successful calls determine candidate item/variant identities. Added, removed, and renamed calls or tests can therefore change the candidate without a main-plan rollout. A test or capture that fails, skips, or is missing cannot become a removal.

`validateShardDeclaration` permits quarantine staging. It does not authorize sealing, removals, or success. `validateShardAgainstPlan` additionally requires `VerifiedDiscoveryEvidence` from the server's GitHub verifier. The evidence binds the exact run, attempt, tested SHA, job, the executor digest that the manifest declares, successful job conclusion, and canonical manifest digest. Do not construct this evidence from an uploaded JSON object.

The reporter writes `receipt.json` next to its manifest. The workflow uploads this receipt as one GitHub artifact using the generated `artifactName`, with overwrite disabled and missing-file/conflict failures enabled. The artifact name is `visonaut-discovery-<attempt>-<jobId>-<encodedShardKey>-<manifestDigest>`. `discoveryArtifactPrefix` and `createDiscoveryReceipt` provide this spelling. After the exact job succeeds, the server independently lists its run artifacts and requires exactly one nonexpired matching receipt. The digest from GitHub artifact metadata must match the ingested manifest. A modified subset cannot reuse the original receipt.

This boundary depends on the workflow of the consumer repository, trusted configuration and reporter injection, fixed artifact step, and GitHub job verification. The service pins no workflow file: a pull request from an account with push access can replace the Submit job, and the workflow edit is in the diff of that pull request. Candidate code still supplies screenshot content. GitHub identity and receipt evidence do not prove screenshot truth. Keep capability and artifact credentials outside the candidate process where possible. The service never executes candidate manifests or installs candidate packages.
