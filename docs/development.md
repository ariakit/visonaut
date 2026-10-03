# Development and verification

Use the [current system guide](current-contract.md) for requirements, selected targets, and evidence limits. Use the Node.js and pnpm versions in `package.json`. Install the locked dependencies with `pnpm install --frozen-lockfile`. `pnpm check` retains the local lint, type, build, unit, and browser checks. Google Chrome is needed by the browser fixture. These checks do not deploy resources or publish packages.

## Check scope

| Command                      | Scope                                                                   | Additional requirements                                                |
| ---------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `pnpm check`                 | Lint, types, build, unit tests, and the existing review browser fixture | Google Chrome and local Worker test runtime                            |
| `pnpm test`                  | Unit, SQLite, and native D1/R2 fixture tests                            | Local loopback access for Miniflare                                    |
| `pnpm test:browser`          | Review interactions and client route fixtures                           | Google Chrome                                                          |
| `pnpm test:release-guards`   | Private changelog, deployment guard, and audit helper tests             | Node only; no cloud login                                              |
| `pnpm check:packages`        | Built public package contents and installation smoke checks             | Run `pnpm build` first                                                 |
| `pnpm test:container`        | On-demand diagnostic comparison Container tests                         | Install `apps/compare/container` dependencies for the current platform |
| `pnpm check:container-image` | On-demand pinned diagnostic Container image build                       | Docker with Linux amd64 support                                        |

CI calls the same named commands. Its Gate remains fail-closed for every required job. Diagnostic Container checks remain available on demand; C04 removes their infrastructure from the normal production path. Read the [CI guide](../.github/workflows/README.md) for the current job set and deployment rules.

## Browser server ownership

Each browser run starts its own fixture server with `reuseExistingServer: false`. The optional `VISONAUT_TEST_PORT` must resolve to an integer from 1 to 65535; invalid input fails before server startup. It defaults to `4179` and is shared by Vite, the readiness URL, and Playwright's `baseURL`. Vite keeps `strictPort: true`, so a busy port fails instead of selecting another port. The suite never reuses the server that occupies that port. Do not stop another developer's process.

Run concurrent checkouts with distinct ports. Run each command from its checkout root:

```sh
# First checkout
VISONAUT_TEST_PORT=4392 pnpm test:browser
# Second checkout
VISONAUT_TEST_PORT=4393 pnpm test:browser
```

The same setting applies to `pnpm check`. A result from another worktree is not application evidence. Use the [W02 checks](https://github.com/ariakit/visonaut/issues/204#w02) to verify separate source roots and controlled busy-port failure without adding a permanent browser project or source-identity endpoint.

## Database fixtures

Ordinary database tests read every sorted numbered migration from `apps/web/migrations`. Keep all applied files, including both `0030_*` files, as history. The zero-pixel correction must not be renamed, broadened, or rerun as cleanup. SQLite fixtures execute the source files. Native D1 fixtures use the same reader and apply each complete statement. Do not add another hand-maintained migration list or current-schema copy.

```ts
import { applyTestMigrations, readTestMigrations } from "../../../tooling/test-migrations.js";

await applyTestMigrations(database);
// A migration regression must state its old starting version.
for (const migration of readTestMigrations({ through: "0013_promotion_scans" })) {
  sqlite.exec(migration.sql);
}
```

The brand migration test starts at `0013_promotion_scans`, inserts old-brand rows, and applies `0014_visonaut_brand`. The Worker handler fixture in `runtime.test.ts` is deliberately partial: it tests handler routing with a mocked app renderer and capacity rows. The isolated security fixture also uses `applyTestMigrations` with the complete auth-D1 schema. It exercises the same Better Auth tables and current repository migrations.

## Built-app check

After framework, route, build, or deployment changes, build and serve the actual app with local bindings. Use an isolated local fixture. Do not use production credentials or production data. D12 retains this on-demand manual check under Q04. Do not add a second permanent browser project.

1. Record the source commit, working diff hash, Node, pnpm, browser, build command, local URL, and data fixture.
2. Open the review route directly. Check the actual document, loaded script and style assets, sign-in-required state, and first image.
3. Reload the route. Navigate away and back. Check client navigation, browser Back, and the URL-selected item and variant.
4. Save a fixture decision. Check sending, server queue admission, saved confirmation, and next-image progress. Reload to check stored state. Save another fixture decision, then verify Undo in that review session; reload clears the local Undo stack. Use synthetic local data and the complete numbered migrations.
5. Record missing assets, failed requests, page errors, viewport, and the result of each step. Keep screenshots and raw browser output beside the record when needed.

A passing interaction fixture does not prove the built Worker startup, deployed OAuth, or production storage behavior. Preview fixtures have no GitHub login under O11. A focused production auth smoke check and local auth tests remain separate checks.

## Scope of the selected cleanup

D10 keeps the copied Ariakit component set, notices, and historical prototype imports. D17 keeps the package and framework boundaries and CLI independence from the Playwright peer runtime. D11/W10 measures setup and build consumers before removing only proved redundant CI work. A file move or smaller source count proves no speed, bundle, or cost improvement.

## Performance checks

Use the [current review-scale fixture](../apps/web/tooling/review-scale/README.md) for model and rendering work. Use its on-demand local harness for a built Worker with ephemeral D1/R2 and a valid local session. The harness calls the real review save and Undo endpoints. Use the separate route runner for another isolated writable PR fixture. Measure `open run → first image` and `save → next image` on cold and warm paths. Record raw samples and resource `encodedBodySize` values, not only elapsed averages.

Keep the source commit, source file hashes, working diff hash, build output hashes and byte sizes, CPU and network profile, viewport, browser, server origin, sample counts, and cache state. Include a slower CPU and a defined network profile. Report localhost timing as a proxy for that environment. It is not a Core Web Vitals result, a production speed claim, or a performance budget.

The [historical scale evidence](evidence/review-scale/README.md) remains a dated record. Do not replace old measurements with new values or infer a budget from a developer laptop. Keep new before/after records under one ignored artifact directory while testing, then publish selected evidence only with the implementation review.
