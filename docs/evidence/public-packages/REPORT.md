# Public-package verification

The frozen working-tree packages passed this local verification on September 22, 2026. This is package evidence only. No package was published, no credentials were read, and no repository file was changed. The remaining launch gates still apply.

The corrected source snapshot contains 43 files. Every remaining SHA-256 value matched the original before/after snapshots and was checked again against the root working tree during this documentation pass. The source-map digest is `adb6ac9b7cfed5b08ed91e38f341c37ab018f3fc9e254c53cc450f6346249383`. The [manifest](./manifest.json) contains the file map, runtime hashes, tool versions, and result-record hashes. Its base commit is context only; the package source was uncommitted.

The original 44-file map incorrectly included ignored output `packages/playwright/test-results/.last-run.json`. This record removes that output from the source identity map and recalculates the count and digest. Source inputs and tarball bytes did not change, so the completed tests were not rerun. The manifest preserves the original digest and all original result-record hashes, including the original source snapshots.

## Exact tarballs

| Package                     | File                           | Bytes  | SHA-256                                                            |
| --------------------------- | ------------------------------ | ------ | ------------------------------------------------------------------ |
| `ariviso@0.1.0`             | `ariviso-0.1.0.tgz`            | 14,497 | `fe1ebe3218280f29aac903b1c51c3ce4145d8519605ef0e5a4b8eef1e3d6be9e` |
| `@ariviso/playwright@0.1.0` | `ariviso-playwright-0.1.0.tgz` | 16,092 | `87b4489bb643404a0b761237aac37e4ef35342bcd0fcb67729c4c5c11075734d` |

The [checksum file](./SHA256SUMS) and [package audit](./package-audit.json) also record exact hashes; the audit includes npm SHA-512 integrity and every packed file. Tarballs, scripts, and raw logs remain outside the repository in the local bundle named `ariviso-release-verification-r3`. The checksum paths identify files in that bundle, not files in this directory. These are local verification artifacts. The [release workflow](../../../.github/workflows/README.md#npm-publication) must build, audit, and bind its final tarballs to the eventual release commit after the readiness gates pass.

## Build and packed contents

Both packages were rebuilt in the isolated source copy with Node 24.18.0 and tsup 8.5.1. All ten final build-output files matched the root `dist` files byte-for-byte when the checks completed. npm 12.0.1 dry-run packing and the release script's exported `auditTarball` function passed for both final tarballs. Actual archive paths match the dry-run lists.

Each tarball contains eight regular files. The CLI contains `LICENSE`, `README.md`, `package.json`, `dist/bin.js`, `dist/bin.d.ts`, `dist/index.js`, `dist/index.d.ts`, and its bundled JavaScript chunk. The adapter contains `LICENSE`, `README.md`, `package.json`, `dist/index.js`, `dist/index.d.ts`, `dist/reporter.js`, `dist/reporter.d.ts`, and its shared declaration chunk. The CLI binary has its Node shebang and executable mode.

No source, test, map, server, credential, or local absolute-path file is packed. Internal protocol imports are bundled. The CLI has no runtime dependencies. The adapter has `pngjs: ^7.0.0` and the exact `@playwright/test: 1.63.0` peer. pnpm rewrote the development-only workspace protocol range to `0.1.0`; it is not installed as a consumer runtime dependency.

## Clean consumer results

A new pnpm 12.5.1 consumer installed the exact two tarballs, Playwright 1.63.0, TypeScript 6.0.2, and Node types 24.13.6. It downloaded ten packages into a new temporary store and reused none. Install scripts were disabled. The child environment contained no inherited credentials and used empty user and global npm configuration files. The installed packages resolve inside the consumer directory, with no workspace protocol package available.

All eleven [consumer checks](./consumer-checks.json) passed. The curated receipt replaces the machine-specific consumer directory prefix with `<consumer>/`; its command arguments, exit codes, and other output are unchanged. The original receipt hash remains in the manifest.

The checks covered:

- ESM import and Node 24 `require` for `ariviso`, `@ariviso/playwright`, and `@ariviso/playwright/reporter`.
- The same imports with the `source` condition, resolving to packed `dist` files.
- Strict TypeScript 6.0.2 declaration checks under both NodeNext and Bundler resolution, with explicit Node types and no `skipLibCheck`.
- `pnpm exec ariviso --help`, with exit 0, and an unsupported command, with exit 2.
- Status without credentials, with exit 4 and no request.
- `pnpm exec ariviso status` against a loopback-only synthetic fixture: passed text with exit 0, needs-review JSON with exit 3, a forbidden response with exit 4, and an invalid protocol state with exit 1.

For example, the successful local status probe printed `Run local-run: passed` and `Shards: 2/2`. The fixture checked a synthetic bearer value; it did not authenticate to any deployed service. Four GET requests reached the fixture. No hosted upload, finalize, status, or OAuth flow was tested.

The installed adapter and reporter also ran in Chrome 154.0.8037.44. A local test captured blue, intentionally failed, retried with green, and passed. Playwright reports one flaky test by design. The reporter's final manifest contains exactly one successful retry at index 1. Its 32 × 32 PNG has only RGBA `[0, 128, 0, 255]` pixels, and its SHA-256 and byte count match the manifest. The [capture validation](./installed-capture-validation.json) records that result. The synthetic provenance digests are fixture values.

All four release-script guard tests passed, including package allowlists, commit/hash binding, launch authorization, and partial-publication integrity checks. Those tests use local fixtures; no publication command ran.

## Harness notes and limits

The first isolated build followed the root protocol dependency link, which added absolute path comments. The link was redirected to the copied protocol source before final build and packing. The final output matched root exactly when the checks completed. The first consumer type command omitted explicit Node types; the final checks use the required TypeScript 6 consumer setting `--types node`. No package source change was needed. npm warned about the pnpm-only manager-version setting in the dry-run environment; both packing probes and all guard tests returned success.

Only the stated pinned toolchain was checked. This record does not establish npm scope control, trusted-publisher configuration, release readiness, broader runtime support, or the remaining integration, recovery, security, and launch gates.
