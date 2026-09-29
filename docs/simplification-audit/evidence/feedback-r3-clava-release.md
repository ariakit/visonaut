# Clava release comparison for Visonaut O09 (2026-09-29)

Current public `ariakit/clava` `main` was checked at commit `541394de6b75a6420757fdab8a5ca708a18e8e3b` (2026-09-28).

## Observed workflow

- [Release workflow, lines 3–15](https://github.com/ariakit/clava/blob/541394de6b75a6420757fdab8a5ca708a18e8e3b/.github/workflows/release.yml#L3-L15): runs on each `main` push, on GitHub-hosted Ubuntu, with `id-token: write` and `contents: read`.
- [Release workflow, lines 26–39](https://github.com/ariakit/clava/blob/541394de6b75a6420757fdab8a5ca708a18e8e3b/.github/workflows/release.yml#L26-L39): checks out the triggering commit, installs dependencies, then `pnpm build`.
- [Release workflow, lines 49–58](https://github.com/ariakit/clava/blob/541394de6b75a6420757fdab8a5ca708a18e8e3b/.github/workflows/release.yml#L49-L58): `changesets/action` creates a version PR or runs `pnpm release`; `NPM_TOKEN` is set to an empty string. [Root scripts, lines 24–26](https://github.com/ariakit/clava/blob/541394de6b75a6420757fdab8a5ca708a18e8e3b/package.json#L24-L26) define version as `changeset version` and release as `changeset publish`.
- [CI workflow, lines 13–75](https://github.com/ariakit/clava/blob/541394de6b75a6420757fdab8a5ca708a18e8e3b/.github/workflows/ci.yml#L13-L75): lint/type check, test, and build are separate jobs. The release job itself builds but does not rerun tests or smoke-test a package tarball.
- [Release run 35412470330](https://github.com/ariakit/clava/actions/runs/35412470330) on the `Publish (#537)` commit succeeded. Its log records `NPM_TOKEN:` empty, `clava@0.7.0` selected, and `Successfully published: clava@0.7.0`. The public registry dates 0.7.0 to 2026-09-19T01:24:38Z. This shows the configured release path worked; it does not expose npm's trusted-publisher account configuration.

## OIDC and archive boundary

[npm trusted-publisher documentation](https://docs.npmjs.com/trusted-publishers/) requires `id-token: write`, a matching npm package/workflow trust rule, a supported publisher client, and a GitHub-hosted runner. The workflow meets the visible GitHub conditions and supplies no npm token. npm documentation says trusted publishing can generate provenance automatically for a public package in a public GitHub repository when the client supports that behavior. However, Clava's job invokes Changesets with pnpm; do not infer an observed provenance attestation from npm CLI documentation alone. `npm view clava@0.7.0 dist --json` on 2026-09-29 showed no `dist.attestations` field. I did not inspect the npm package's private trusted-publisher settings or independently verify a Sigstore bundle.

Clava does **not** prove exact archive identity. Its release workflow has no `changeset pack`, saved `.tgz`, checksum comparison, or `changeset publish --from-pack-dir`. In the installed Changesets 3.0.3 source, plain publish uses a null tarball path (`node_modules/@changesets/cli/dist/publish.mjs`, lines 26–35, 45–70) and invokes `pnpm publish` from each package directory (`getPublishPlan.mjs`, lines 337–355). `--from-pack-dir` is the separate exact-archive mode. Thus the Clava pattern is **build checked source, then pack and publish from source**. OIDC answers who may publish and ties the run to a workflow; it does not make the published tarball byte-for-byte identical to one checked earlier.

## Design implication

Visonaut O09's selected `source` option is consistent with Clava's simpler workflow. A precise label is “Run `changeset publish` from the verified checkout”; state that publication creates the tarball during publish. Do not say “publish the exact verified archive” or “OIDC proves archive equality.” Preserve an explicit smoke test or package-content check in the Visonaut release job if its earlier release decision requires one. The user's uncertainty note asks for this comparison but does not supply a different option selection.
