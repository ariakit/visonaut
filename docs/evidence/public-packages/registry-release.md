# Public registry release audit

On September 23, 2026, the public npm registry served [`visonaut@0.1.0`](https://www.npmjs.com/package/visonaut/v/0.1.0) and [`@visonaut/playwright@0.1.0`](https://www.npmjs.com/package/@visonaut/playwright/v/0.1.0). The registry tarballs were downloaded with `npm pack` and audited with the repository's `auditTarball` function. The audit accepted only the CLI's eight intended files and the adapter's eighteen intended files, including its ten trusted CI helpers. It rejected workspace runtime dependencies and unexpected packed paths by construction.

| Registry tarball                |  Bytes | SHA-256                                                            |
| ------------------------------- | -----: | ------------------------------------------------------------------ |
| `visonaut-0.1.0.tgz`            | 14,509 | `3d4e9c5f84bf401ddd8fd58b934b3cac8d5a212faf34bb14dd74cea02a532054` |
| `visonaut-playwright-0.1.0.tgz` | 25,171 | `c89d07bf0cafce24b63ae1039aece8dcf9b55a9b4a38f5320b03d7d6c95bb465` |

An isolated checkout of current main at [`beabb92`](https://github.com/ariakit/visonaut/commit/beabb924dba47ad0ba5b2551283b3d9e7c71d0ed) installed the frozen lockfile and built both packages with Node 24.18.0 and pnpm 12.5.1. `packages.mjs pack` created audited tarballs whose SHA-256 values matched the two registry downloads exactly. The earlier [CI artifact](./visonaut-ci.md) contains the same CLI tarball but an older, smaller adapter tarball. Trusted capture transfer helpers were added to the adapter before its first npm publication, so the older adapter artifact is not the published file.

A separate consumer, outside the workspace, installed the two public registry versions with `@playwright/test@1.63.0`, TypeScript 6.0.2, and Node types 24.13.6. Install scripts were disabled; the user npm configuration was empty; token environment variables were removed; and the isolated pnpm store downloaded ten packages with none reused. `pnpm exec visonaut --help` exposed upload, finalize, and status only. The adapter, reporter, and CI ESM exports imported. A prepared `visual(page, { item, variant })` call type-checked under strict NodeNext and Bundler resolution. Status without a maintainer token returned exit 4 before network use. A loopback-only fixture sent four synthetic authenticated requests through the installed binary: passed returned exit 0, needs-review exit 3, 403 exit 4, and invalid protocol state exit 1. No deployed Visonaut API was called by that fixture.

The exact-byte match verifies that the installed first versions correspond to the recorded current package source. It does not prove npm trusted-publisher configuration or a full Ariakit capture cycle. Those checks remain open before the required-check cutover. No `@visonaut/cli` alias was published or selected.

## Historical 0.3.0 registry check

On September 25, 2026, the public registry served [`visonaut@0.3.0`](https://www.npmjs.com/package/visonaut/v/0.3.0) and [`@visonaut/playwright@0.3.0`](https://www.npmjs.com/package/@visonaut/playwright/v/0.3.0). Fresh `npm pack` downloads matched each version's registry SHA-512 integrity, byte count, and the repository's `auditTarball` packed-file allowlist.

| Registry tarball                |  Bytes | Files | SHA-256                                                            |
| ------------------------------- | -----: | ----: | ------------------------------------------------------------------ |
| `visonaut-0.3.0.tgz`            | 16,266 |     8 | `18cc35a0f1198b1e77ed18d844941cdf0e9acc12f20b0d98b54e406a0f11105b` |
| `visonaut-playwright-0.3.0.tgz` | 27,186 |    25 | `bab64dabc7998022d860e778a85dccba67d2fb30ad6f5496209ce8ec4f734984` |

An isolated consumer installed the exact public versions with install scripts disabled, Node 24.18.0, pnpm 12.5.1, Playwright 1.63.0, and TypeScript 6.0.2. The adapter, reporter, and CLI ESM exports imported. A prepared `visual(page, { item, variant })` call type-checked under strict NodeNext and Bundler resolution and captured a local Chromium page. `pnpm exec visonaut --help` passed. Without `VISONAUT_TOKEN`, status returned exit 4. A loopback-only status fixture used a synthetic bearer token and returned the expected exits for passed (0), needs-review (3), permission denial (4), and invalid protocol state (1). It did not contact the deployed service.

`npm audit signatures` with npm 12.0.1 verified registry signatures for all six installed packages, with zero missing or invalid signatures. Three Playwright packages had verified provenance attestations; neither Visonaut package did. The [0.3.0 release workflow](https://github.com/ariakit/visonaut/actions/runs/36046849182) explicitly disabled provenance, a setting retained from when this repository was private. Both packages now have trusted publishers and the repository is public. The release workflow fix requests provenance for the next immutable version; its actual attestation remains to be checked after publication.

The [current 0.3.2 CLI and 0.3.1 adapter audit](./current-release-20260925.md) verifies the later public tarballs, clean consumer, and provenance. The 0.3.0 results above remain historical.
