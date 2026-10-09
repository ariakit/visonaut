# Visonaut client package check

On September 23, 2026, [CI run 35820075166](https://github.com/ariakit/visonaut/actions/runs/35820075166) passed source checks, the native Container server tests and Docker image build, release guards, and the public package audit. Its pull-request merge-source commit was `0319e6adb8cdb5c1673d1ead98cbf0e4c4292a4b`; the reviewed branch commit was `b75b4719e7dc8129cc0bd3d26e9c19cbb58c211e`. The artifact `public-packages-0319e6adb8cdb5c1673d1ead98cbf0e4c4292a4b` contained exactly the manifest and two tarballs. The repository's `packages.mjs verify` command accepted the artifact with that exact source SHA, byte lengths, SHA-256 values, npm integrity values, and packed-file allowlist.

| Tarball                         |  Bytes | SHA-256                                                            |
| ------------------------------- | -----: | ------------------------------------------------------------------ |
| `visonaut-0.1.0.tgz`            | 14,509 | `3d4e9c5f84bf401ddd8fd58b934b3cac8d5a212faf34bb14dd74cea02a532054` |
| `visonaut-playwright-0.1.0.tgz` | 16,094 | `c8a29f378176afc70d4387a46034145ce172740fe775740391ce0a69cce96149` |

An isolated consumer installed these exact tarballs with Node 24.18.0, pnpm 12.5.1, Playwright 1.63.0, TypeScript 6.0.2, and Node types 24.13.6. Install scripts were disabled. `pnpm exec visonaut --help` returned exit 0 and exposed only upload, finalize, and status. The installed adapter and reporter ESM entry points imported. A prepared-page `visual(page, { item, variant })` fixture type-checked under both strict NodeNext and Bundler resolution. The binary also returned exit 4 for status without a maintainer token, before making a request.

A loopback-only status fixture sent four requests with a synthetic bearer value. `pnpm exec visonaut status --json` returned exit 0 for `passed`, exit 3 for `needs-review`, exit 4 for a 403, and exit 1 for an invalid protocol state. Each request used `/v1/runs/local-run`; none contacted the deployed service. The earlier [frozen package report](./REPORT.md) records a more extensive consumer and browser fixture for the predecessor package names. Its source and hashes remain historical; it is not evidence that these Visonaut tarballs were published.

This verifies the stated CI artifact and its clean consumer, not the later Playwright release tarball. Both first versions were published after this record. The [registry release audit](./registry-release.md) verifies the public tarballs against current source; trusted-publisher setup remains a separate release-control check.
