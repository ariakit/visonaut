# Current public client release audit

On September 25, 2026, the public npm registry served [`visonaut@0.3.2`](https://www.npmjs.com/package/visonaut/v/0.3.2) and [`@visonaut/playwright@0.3.1`](https://www.npmjs.com/package/@visonaut/playwright/v/0.3.1). These are the exact versions installed by [Ariakit PR #7635](https://github.com/ariakit/ariakit/pull/7635). Fresh `npm pack` downloads matched their registry SHA-512 integrity values and passed the repository's `auditTarball` packed-file allowlist.

| Registry tarball                |  Bytes | Files | SHA-256                                                            |
| ------------------------------- | -----: | ----: | ------------------------------------------------------------------ |
| `visonaut-0.3.2.tgz`            | 18,771 |     8 | `f272fbf982285d262e543adb891c0a525c8eae346ae560d4b6a6a5c48d0a1eb6` |
| `visonaut-playwright-0.3.1.tgz` | 27,226 |    25 | `8c21bbd9df89e5996a1f6ca8c87ed5d755b00c5ab0769bfcd31848f01b0ab68f` |

An isolated consumer installed these public versions with Node 24.18.0, pnpm 12.5.1, Playwright 1.63.0, TypeScript 6.0.2, and Node types 24.13.6. The install used an empty npm user configuration, no token, a fresh pnpm store, and disabled scripts. It downloaded ten packages and reused none. The installed `visonaut`, `@visonaut/playwright`, `/reporter`, and `/ci` ESM exports imported. A prepared `visual(page, { item, variant })` fixture type-checked under strict NodeNext and Bundler resolution. `pnpm exec visonaut --help` exposed `pack`, `upload`, `submit`, and `status`. Status without a token returned exit 4 before network use.

The installed CLI also reached a loopback-only status server with a synthetic bearer token. `passed` returned exit 0, `needs-review` exit 3, permission denial exit 4, and invalid protocol state exit 1. The fixture did not contact a deployed Visonaut API. The [hosted Ariakit run](https://visonaut.com/runs/94149fff-af8d-4f24-b11f-232e15268970) separately exercised the published packages over 1,058 variants and ended with a passing Visonaut check after three changed images were reviewed.

`npm audit signatures` found no missing or invalid signatures or attestations in the clean consumer. Both Visonaut packages have verified npm publish attestations and SLSA provenance. The provenance names `https://github.com/ariakit/visonaut`, `.github/workflows/release.yml`, and `refs/heads/main`; each attested SHA-512 subject equals the downloaded tarball's SHA-512. The tarballs' SHA-512 hex values are `bbacb77af98dd0716b914d7356161c26d8504e33a393b24a81801d17a250c87b476cd44f889392b179e76286fe09bc190d359ea8b0d9b122dd48bfe9e4b366b7` for the CLI and `c9b0fea7010a4fe31e7a229200b499887a52140c9a6efa824dbb10c6fceb0f63abffcf4562bb1efb33e3dd5cdaf480d2479c906fbb16034be88d1c71007fc2df` for the adapter.

This audit covers the current public package bytes, installability, declarations, binary, provenance, and a real hosted capture. It does not close the service runtime, security, recovery, cost, or Ariakit required-check cutover gates. No `@visonaut/cli` alias was published or selected.
