# Public CLI 0.3.4 release audit

On September 27, 2026, the public npm registry served [`visonaut@0.3.4`](https://www.npmjs.com/package/visonaut/v/0.3.4), the CLI installed by the [Ariakit `main` Submit](https://github.com/ariakit/ariakit/actions/runs/36315354095). Ariakit also installs [`@visonaut/playwright@0.3.1`](https://www.npmjs.com/package/@visonaut/playwright/v/0.3.1), which has a separate [September 25 package audit](./current-release-20260925.md).

| Registry tarball     |  Bytes | Files | SHA-256                                                            |
| -------------------- | -----: | ----: | ------------------------------------------------------------------ |
| `visonaut-0.3.4.tgz` | 20,160 |     8 | `9c5d8f702400b89e73b4de312e4d4ecabf09fd5a85903ff5785abb938908b8d7` |

A fresh `npm pack` download matched the registry's SHA-512 integrity value, `sha512-2+BVVhMjVNX+KnjY3/Hb0BJFI5PE2Gx/BL+CmQl/gRLeS45NgAXgQ2HYaAU5Pq0wKNs/V4nLrJ6iObHNK7/kHw==`. The repository's `auditTarball` packed-file allowlist accepted all eight files. The published manifest depends on exact `@visonaut/playwright@0.3.1` and names this repository's `packages/cli` directory.

An isolated consumer installed the public CLI with Node 24.18.0 and pnpm 12.3.0. It used an empty npm user configuration, no package token, a fresh pnpm store, and disabled scripts. The install downloaded six packages and reused none. `pnpm exec visonaut --help` exposed `pack`, `upload`, `submit`, and `status`. Without `VISONAUT_TOKEN`, status returned exit 4 before network use. Against a loopback-only status fixture and synthetic token, `passed` returned exit 0 and `needs-review` returned exit 3. The fixture made two authenticated requests and no external request.

`npm audit signatures` reported no invalid or missing attestations or signatures in this clean install. It verified the CLI's SLSA provenance subject against the downloaded tarball's SHA-512, `dbe05556132354d5fe2a78d8dff1dbd012452393c4d86c7f04bf8299097f8112de4b8e4d8005e04361d86805393ead3028db3f5789cbac9ea239b1cd2bbfe41f`. The attestation names [`8d94641`](https://github.com/ariakit/visonaut/commit/8d94641e449e13baae624ac2b11f8708eeb4a08b) on `refs/heads/main` in `https://github.com/ariakit/visonaut`, `.github/workflows/release.yml`, and [release run 36294284646](https://github.com/ariakit/visonaut/actions/runs/36294284646/attempts/1).

This audit covers the published CLI bytes, packed files, provenance, clean installation, and local status behavior. The [Ariakit `main` run](https://visonaut.com/runs/a9b2f077-915f-4877-9e0d-0ca922919417) separately proves a hosted Submit with CLI 0.3.4 and adapter 0.3.1. The local fixture did not contact the deployed Visonaut API or use a production token. The [September 25 audit](./current-release-20260925.md) covers the adapter's package bytes, declarations, and consumer imports; it does not audit CLI 0.3.4.
