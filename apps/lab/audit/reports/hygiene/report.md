# Repository hygiene, docs, tests, and developer experience

Scope: the whole repository at commit `f83fef6` (worktree `serialized-dazzling-pixel`), read-only.
Skills loaded for the audit criteria: `ariakit-general-workflow`, `ariakit-general-code-style`, `ariakit-general-testing`. No Visonaut-specific workflow skill is installed.
All paths are relative to the repository root. Scripts and raw outputs are in `/Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/hygiene/`.

## How it works (map)

### Workspace

- pnpm workspace with `apps/*` and `packages/*` (`pnpm-workspace.yaml:1-3`). Eight workspaces: `apps/web`, `apps/compare`, `packages/{cli,playwright,protocol,compare,service,security}`.
- `apps/compare/container` is a ninth package that is outside the workspace. It uses npm and its own `package-lock.json` (`package.json:17`: `"test:container": "npm test --prefix apps/compare/container"`).
- Root scripts (`package.json:5-20`): `dev`, `build`, `typecheck`, `test`, `test:browser`, `lint`, `format`, `check`, `test:release-guards`, `test:container`, `check:container-image`, `check:packages`.
- Node `24.18.0` exact and pnpm `12.5.1` (`package.json:33-36`). No `.nvmrc`, `.npmrc`, or `.editorconfig`.

### Tooling

- Lint: oxlint with one category, `"categories": { "correctness": "error" }` (`.oxlintrc.json:9`). Format: oxfmt, `printWidth: 100` (`.oxfmtrc.jsonc:10`). Pre-commit hook: `pnpm lint` only (`lefthook.yml:3-5`).
- Types: root `tsconfig.json` is strict with `noUncheckedIndexedAccess` and `verbatimModuleSyntax`. Three of eight workspaces extend it (HYG-16).
- Unit tests: one root Vitest config. `include: ["packages/**/*.test.ts", "packages/**/*.test.mjs", "apps/**/*.test.ts"]`, `testTimeout: 15000` (`vitest.config.ts:5-8`).
- Browser tests: Playwright with Chrome against a Vite fixture server on port 4179, 3 workers (`apps/web/src/review/__tests__/playwright.config.ts:7-27`).
- CI (`.github/workflows/checks.yml`): Lint, Typecheck, Build (+ `check:packages`), Test x3 shards, Browser, Release guards, then Gate. Each job runs its own `pnpm install --frozen-lockfile`. The build runs 4 times for each CI run (Build job + 3 test shards, lines 73 and 105).

### Size of the repository (measured)

| Part        | Tracked files | Tracked bytes |
| ----------- | ------------- | ------------- |
| `docs/`     | 334           | 8.03 MB       |
| `tooling/`  | 85            | 7.23 MB       |
| `apps/`     | 311           | 3.05 MB       |
| `packages/` | 155           | 1.49 MB       |
| All         | 919           | 20.06 MB      |

- Product code (`apps` + `packages`) is 4.54 MB, which is 23% of the tracked bytes.
- Tests: 92 test files, 43,725 lines, 1,083 test cases.
- Markdown: 122 files, 132,356 words.
- History: 258 commits in 15 days (2026-09-21 to 2026-10-05). The pack is 16.16 MiB.
- No `TODO`, `FIXME`, or `HACK` markers in tracked source. Six `@ts-expect-error` comments, all in tests. No `as any` in any tracked TypeScript file.

### Local development: request walk-through for `pnpm dev`

1. `pnpm dev` runs `pnpm --filter @visonaut/web dev` (`package.json:6`), which runs `vite --host 127.0.0.1` (`apps/web/package.json:7`). Vite listens on `http://127.0.0.1:5173` by default.
2. `apps/web/vite.config.ts:9` loads the Cloudflare Vite plugin. `CLOUDFLARE_ENV` is not set, so the plugin uses the top-level Wrangler configuration. That configuration is the preview: `"VISONAUT_ENVIRONMENT": "preview"` and `"VISONAUT_ORIGIN": "https://preview.visonaut.com"` (`apps/web/wrangler.jsonc:22-25`). It has no D1, R2, service, or queue bindings (lines 31-37).
3. The browser requests `http://127.0.0.1:5173/`. The Worker handler runs (`apps/web/src/server.ts:56`).
4. `/health` returns before all checks (`server.ts:60-71`).
5. In preview mode, the handler compares the request origin with the configured origin (`server.ts:73-76`):
   ```ts
   if (env.VISONAUT_ENVIRONMENT === "preview") {
     if (url.origin !== env.VISONAUT_ORIGIN) {
       return securePrivateResponse(new Response(null, { status: 403 }));
     }
   ```
   `http://127.0.0.1:5173` is not `https://preview.visonaut.com`. The response is HTTP 403 with an empty body.
6. The fixture responses (`server.ts:77-78`, `apps/web/src/review/preview-fixtures.ts:70-113`) and the page render (`server.ts:79`) are not reached.

### Documentation reading order

`README.md:68-77` lists eight references. Their sizes: `docs/current-contract.md` 5,773 words, `docs/simplification-implementation.md` 8,175, `docs/design-verification.md` 2,277, `apps/web/src/operations/README.md` 1,957, `.github/workflows/README.md` 1,467, `docs/review-guide.md` 1,441, `docs/review-evidence-plan.md` 1,036, `docs/development.md` 1,004. Total: 23,130 words before a contributor reaches code.

## Findings

### HYG-01 · `pnpm dev` returns HTTP 403 for every page

- Kind: dx
- Severity: high. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - `apps/web/src/server.ts:73-76`: `if (url.origin !== env.VISONAUT_ORIGIN) { return securePrivateResponse(new Response(null, { status: 403 })); }`
  - `apps/web/wrangler.jsonc:25`: `"VISONAUT_ORIGIN": "https://preview.visonaut.com"`
  - `apps/web/package.json:7`: `"dev": "vite --host 127.0.0.1"`
  - `README.md:55`: "`pnpm dev` starts the public fixture demo. Preview uses synthetic review data and inline SVG images without backend bindings or credentials."
  - `.gitignore:6-8`: `.dev.vars*`, `.env*`, `!.env.example`. No `.dev.vars` example can be committed with these rules.
  - Search for a documented override: `rg "pnpm dev|\.dev\.vars|5173|wrangler dev"` in tracked files. The only `.dev.vars` hit is `docs/baseline-delta-cutover.md:33-61`, for a different tool. The only `--var VISONAUT_ORIGIN:` hits are inside evidence JSON, for example `docs/evidence/simplification-performance/iab-final-built-preview.json:7`: `wrangler dev --config apps/web/dist/server/wrangler.json --local --port 4184 --local-upstream localhost:4184 --upstream-protocol http --var VISONAUT_ORIGIN:http://localhost:4184`.
  - Measurement on the running server (it has the orchestrator's local override `VISONAUT_ORIGIN=http://127.0.0.1:4310`):
    ```text
    GET / (Host 127.0.0.1:4310): 200
    GET / (Host localhost:4310): 403
    GET / (Host 127.0.0.1:5173): 403
    GET / (Host preview.visonaut.com): 403
    GET /health (Host localhost:4310): 200
    ```
    The 403 response has `content-length: 0`.
  - History: commit `5712036` (2026-09-30, #155) added the check. Commit `0b629ce` (2026-10-04, #250) wrote the README sentence. No commit added a local override.
- What happens: The claim is correct. The request origin is compared as a full string, with scheme and port. A local dev server can never equal `https://preview.visonaut.com`. The maintainers' own recorded commands needed `--var VISONAUT_ORIGIN:...`, but that knowledge is only in evidence files. The documented way to run the app locally is `pnpm dev` (`README.md:55`). It does not work as documented.
- Impact: A new contributor gets a blank 403 page on the first run, with no message. `localhost` and `127.0.0.1` are also different origins, so an override for one host fails for the other. `server.test.ts` has no test for the preview origin check (`rg "preview|403" apps/web/src/server.test.ts` has no match).
- Recommendation: Make the default command work without a private file. One small sketch:
  ```ts
  // apps/web/src/server.ts
  function previewOrigin(url: URL, env: Env) {
    if (url.origin === env.VISONAUT_ORIGIN) return true;
    // Local Vite and Wrangler servers use a loopback host and a free port.
    return url.hostname === "127.0.0.1" || url.hostname === "localhost";
  }
  ```
  Add one test for each branch.
- Alternatives:
  1. Minimal: add `!.dev.vars.example` to `.gitignore`, commit `apps/web/.dev.vars.example` with `VISONAUT_ORIGIN=http://127.0.0.1:5173`, pin the dev port (`vite --host 127.0.0.1 --port 5173 --strictPort`), and document the copy step.
  2. Remove the origin check in preview mode. Preview has no data, cookies, or bindings (`apps/web/wrangler.jsonc:31-37`). Set `"workers_dev": false` (line 7) if the purpose of the check is to close the `workers.dev` host.
  3. Keep the code and add one README paragraph that gives the `.dev.vars` line.
- Maintainer decision needed: yes. Is the preview origin check a security control that must stay, or only a way to close the `workers.dev` host?

### HYG-02 · No documented command runs the real app locally, and `db:local` prepares a database that no command reads

- Kind: dx
- Severity: medium. Confidence: medium. Measured: no. Effort: M
- Evidence:
  - `README.md:55`: "`pnpm --filter @visonaut/web db:local` applies the production schema to local D1 only."
  - `apps/web/package.json:12`: `"db:local": "wrangler d1 migrations apply DB --local --env production"`.
  - `pnpm dev` uses the preview configuration, which has `"d1_databases": []` (`apps/web/wrangler.jsonc:31`).
  - `docs/development.md:50-60` ("Built-app check") gives five steps and no command.
  - The only runnable real-backend path is a performance harness: `apps/web/tooling/review-scale/README.md` ("`pnpm --filter @visonaut/web build`" then "`SAMPLES=3 pnpm exec node apps/web/tooling/review-scale/local-routes.mjs`"). It sets a third environment value that is in no Wrangler file: `VISONAUT_ENVIRONMENT: "local"` and `VISONAUT_ORIGIN: origin` (`apps/web/tooling/review-scale/local-routes.mjs:73-75`). It stops when its samples finish.
  - `apps/web/package.json:9`: `"preview": "vite preview --host 127.0.0.1"` has the same origin problem as HYG-01.
- What happens: There are three ways to see UI locally. (1) `pnpm dev`: one synthetic run, read-only, fails with 403. (2) The browser-test fixture server (`apps/web/src/review/__tests__/vite.config.ts`), which is the richest but is documented only as a test server. (3) The review-scale harness, which is the only one with D1, R2, auth, and saves. None is a normal dev loop for API or UI work against real data shapes.
- Impact: UI work is done against fixtures or production. The preview fixture has 1 item and 2 variants (`preview-fixtures.ts:42-65`), so most UI states cannot be seen with `pnpm dev`. This is one reason why UI problems are found late. Assumption, not verified: `CLOUDFLARE_ENV=production pnpm dev` does not work without extra setup, because the production environment requires five secrets (`wrangler.jsonc:113-121`), a `visonaut-compare` service binding (line 88), and origin `https://visonaut.com` (line 54).
- Recommendation: Add one documented dev mode with seeded local data. A possible shape:
  ```jsonc
  // apps/web/wrangler.jsonc
  "env": { "local": { "vars": { "VISONAUT_ENVIRONMENT": "local", "VISONAUT_ORIGIN": "http://127.0.0.1:5173" },
                      "d1_databases": [{ "binding": "DB", "database_name": "visonaut-local", "database_id": "local", "migrations_dir": "migrations" }] } }
  ```
  ```json
  "dev:local": "CLOUDFLARE_ENV=local vite --host 127.0.0.1 --port 5173 --strictPort"
  ```
  Reuse the seed code that `local-routes.mjs` already has.
- Alternatives:
  1. Minimal: document the fixture server as the UI dev server (`pnpm --filter @visonaut/web exec vite --config src/review/__tests__/vite.config.ts`) and list its query flags.
  2. Extend the preview fixtures to cover more states, and keep one mode.
  3. Remove `db:local` and the README sentence if no local backend mode is wanted.
- Maintainer decision needed: yes. Do you want a seeded local backend mode, or fixtures only?

### HYG-03 · The in-app recovery link opens a runbook that describes retired behavior

- Kind: inconsistency
- Severity: medium. Confidence: high. Measured: no. Effort: M
- Evidence:
  - `apps/web/src/components/operations-attention/index.tsx:456-460`: `<a href="https://github.com/ariakit/visonaut/blob/main/apps/web/src/operations/README.md" />` with the label "Open the operations and recovery guide".
  - `apps/web/src/operations/README.md:3`: "This runbook describes source behavior before the selected retirements." and "the compare Worker consumes work and publishes a status wakeup."
  - Code: `apps/compare/src/index.ts:4-8` has a `fetch` handler only. `apps/compare/README.md:5`: "This Worker has no queue handler or cron."
  - `apps/web/src/operations/README.md:28`: "some non-promoted closed legacy runs can create a read-only comparison from retained native D1 captures." and "that target still needs implementation". Code: `apps/web/src/api/review.ts:592` sends `recompareAllowed: false` for every run, and the endpoint always throws (`review.ts:950-987`).
  - `apps/web/src/operations/README.md:64`: "D06/W06 stage B is prepared in source." `docs/current-contract.md:34` states that the removal is deployed (PR #228).
  - `apps/web/src/operations/README.md:12`: "preserve the committed preview and production budgets." Preview has no backend now (`apps/web/wrangler.jsonc:31-37`).
  - `apps/web/src/components/operations-attention/index.tsx:104`: "Set the GitHub App webhook URL to the production /v1/webhooks receiver after preview sessions are retired." Preview sessions are retired (`docs/current-contract.md:244`).
- What happens: The Service status view sends the operator to this README during an incident. The first paragraph says that the text is about an earlier state. Four statements contradict the current code or the contract.
- Impact: An operator must read 1,957 words and decide which sentences are still true. A wrong recovery step is possible.
- Recommendation: Rewrite this file as a short runbook for the current system: queue message kinds, the scheduled steps in order (`apps/web/src/operations/index.ts:49-60`), each alert kind with its action, and D1 recovery. Move history to a dated file.
- Alternatives:
  1. Minimal: delete the four stale statements and the "Conversion before deployment" and "Manual evidence export" sections (lines 34-70).
  2. Put the recovery text for each alert in the app (it has a per-alert `action` string already) and remove the external link.
- Maintainer decision needed: no.

### HYG-04 · The review guide and README describe the UI from before PR #252

- Kind: inconsistency
- Severity: medium. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - `git show f83fef6 --stat`: 21 files, 2,815 insertions, 1,140 deletions, all under `apps/web/src` plus one changeset. No file in `docs/` and not `README.md`.
  - String scan (`ui-strings.mjs`) of labels that `docs/review-guide.md` names, against non-test web source:
    ```text
    MISSING "New only"        MISSING "Original only"   MISSING "Queued on server"
    MISSING "All runs"        MISSING "200%" (now built from a number)
    FOUND   "Recompare stored run"   (the guide says that it is retired)
    ```
  - `docs/review-guide.md:31-34` lists "Side by side, `S`", "Pixel diff, `D`", "New only, `F`", "Original only, `G`". The buttons are now "Compare", "Difference", "Current", "Baseline" (`apps/web/src/review/review-workspace.tsx:845-888`).
  - `docs/review-guide.md:92`: "Use **All runs** to return to the dashboard". The control is now "Queue" (`review-workspace.tsx:584`).
  - `docs/review-guide.md:15`: "The Runs page shows the run type...". The app has "Review queue", "Run history", and "Service status" (`apps/web/src/components/app-shell.tsx:16-18`).
  - `docs/review-guide.md:45`: "**Queued on server**". The app shows "N queued on server" inside a longer sentence (`review-workspace.tsx:1113`).
  - `docs/review-guide.md:88`: "**Recompare stored run** is retired." The button is still rendered (HYG-10).
  - `README.md:13`: "select an item and variant". The UI says "Screenshots" and "views" (HYG-08).
  - The guide does not mention the new features in the changeset: screenshot search, status filters, the saved sidebar preference, or the `[` shortcut (`.changeset/200-inbox-review-ui.md`, `review-workspace.tsx:178-179`).
- What happens: The UI rewrite did not update the user guide.
- Impact: Low for users today (the maintainers are the users). Higher for the planned redesign: the guide cannot be used as the list of required behavior without a check of each sentence.
- Recommendation: Do not fix the wording now if the UI will change again. Reduce the guide to behavior rules that do not name labels (decision semantics, Undo rules, keyboard keys), and let the in-app help own the labels.
- Alternatives:
  1. Update the labels now (about 12 edits).
  2. Generate the shortcut table in the guide and in the help dialog from one data array.
- Maintainer decision needed: no.

### HYG-05 · Package versions in three documents are behind the manifests, and the published CLI README names the previous version

- Kind: inconsistency
- Severity: low. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - `packages/cli/package.json:3`: `"version": "0.5.4"`. `packages/playwright/package.json:3`: `"version": "0.5.0"`.
  - `README.md:35`: "The current package pair is `visonaut@0.5.3` and `@visonaut/playwright@0.4.0`".
  - `packages/cli/README.md:3`: "This guide describes CLI `visonaut@0.5.3`." This file is in the npm tarball (`packages/cli/package.json:14-18`), and the `0.5.4` changelog entry is "Updated the CLI guide" (`packages/cli/CHANGELOG.md:7`).
  - `.github/workflows/README.md:66`: "CLI `visonaut@0.5.3` is published under `latest`" and "Adapter `@visonaut/playwright@0.4.0` remains unchanged."
  - `docs/current-contract.md:22`: "The verified registry versions are CLI `visonaut@0.5.4` and adapter `@visonaut/playwright@0.5.0`".
- What happens: Version numbers are written by hand in four places. One place was updated.
- Impact: The npm page of `visonaut@0.5.4` says that it describes `0.5.3`. A reader of the root README installs an adapter pair that the contract calls superseded.
- Recommendation: Remove version numbers from prose. Link to the package manifest or the changelog.
- Alternatives: add a release-guard test (the repository already has `.github/workflows/scripts/*.test.mjs`) that fails when a README version differs from `package.json`.
- Maintainer decision needed: no.

### HYG-06 · Other statements that are stale or contradict another document

- Kind: inconsistency
- Severity: low. Confidence: high. Measured: no. Effort: S
- Evidence:
  - `docs/simplification-audit/README.md:7`: "Issue #1 remains the implementation contract until the authorized handoff". `docs/current-contract.md:3`: "This document became the current repository contract when PR #205 merged on 2026-10-02."
  - `docs/current-contract.md:38`: "The older fenced preview runtime remains unchanged." `docs/current-contract.md:188`: "The public preview serves synthetic read-only fixtures... Its source configuration has no D1, R2, comparator service, or queue bindings."
  - `packages/security/README.md:5`: "Apply `migrations/0001_auth.sql` before the first authenticated request." The applied migration is `apps/web/migrations/0003_auth.sql`. The package copy is byte-identical (SHA-256 match in `dupes.mjs`) and no code reads it (`packages/security/test/auth-d1.test.ts:1` uses `tooling/test-migrations.js`).
  - `docs/operations/recover-comparison-dead-letters.md:3`: "The comparison Worker sends only `{ taskId, publicationAttempt }` in each new primary Queue message." The comparison queue producers and handlers are removed (`docs/current-contract.md:32`, `apps/compare/src/index.ts`).
  - `docs/operations/simplification-inventory.json:7,24-25` and `docs/operations/issue-204-inventory.md:13` name `visonaut-production`, `visonaut-production-images`, and `visonaut-production-quarantine`. Commit `e277a91` (#251) changed the bindings to `visonaut`, `visonaut-images`, and `visonaut-quarantine` (`apps/web/wrangler.jsonc:70-81`) and changed no document.
  - `docs/development.md:17`: "CI calls the same named commands." `pnpm check` (`package.json:14`) does not run `test:release-guards` or `check:packages`, which are CI gate jobs (HYG-19).
- What happens: Dated records and current instructions are in the same folders with no marker that separates them. Each record is correct for its date and wrong for today.
- Impact: A reader cannot tell which file is current without the commit history.
- Recommendation: Move dated records to one folder (for example `docs/history/`) and put one line at the top of each: `Status: historical record, 2026-09-29. Not current.` Keep only current guides in `docs/`.
- Alternatives: minimal, add the status line only, with no move.
- Maintainer decision needed: no.

### HYG-07 · Documentation volume and style: 132,000 words, a "short contract" of 5,800 words, and nine code namespaces

- Kind: dx
- Severity: medium. Confidence: high. Measured: yes. Effort: L
- Evidence:
  - `docs-stats.mjs`: 122 Markdown files, 132,356 words. By area: `docs/evidence` 48,449 words in 61 files, `docs/simplification-audit` 26,691 in 14, top-level `docs/*.md` 23,174 in 9, `docs/operations` 12,969 in 9.
  - `docs/current-contract.md`: 5,773 words in 253 lines. 47 lines are longer than 500 characters and 7 are longer than 1,000. The longest is 1,661 characters.
  - The same file, line 177, records decision Q03: "Keep a short current contract in the repo".
  - `docs/current-contract.md` has 199 mentions of 78 different decision codes in nine namespaces: `A` 7, `C` 6, `D` 20, `O` 14, `P` 6, `Q` 4, `S` 5, `U` 6, `W` 10. Line 42: "An issue #204 D-number is separate from a revision 9 D-number." The same code can mean two decisions.
  - `README.md:7,35,42` and `.github/workflows/README.md:42,66` contain dated receipts (PR numbers, run IDs, "is complete", "remains unverified") inside usage instructions. Example, `README.md:35`: "PR #205 completed the readiness marker and authority handoff; #207 records completed transfer-key cleanup. These dated receipts do not prove the later #204 removal gates."
  - `README.md:79`: "D10 and D17 keep the copied UI components, current packages, and TanStack Start framework." The codes are not defined in the README.
  - Ratio: non-test product source is about 47,000 lines (`sizes.mjs loc`). Markdown is 132,356 words.
- What happens: The documents record what was approved and what was proved, in legal style. They do not explain the system. There is no architecture page, no data model page, and no glossary.
- Impact: A contributor cannot learn the system from the docs. An AI agent that loads "the binding contract" spends about 5,800 words of context on mostly historical receipts. Changes also get slower: each PR must update several long records (30 of the last 60 commits touch `docs/`; see the commit list in Measurements).
- Recommendation: Split by purpose.
  ```text
  README.md                 what it is, run it locally, where things are   (max 400 words)
  docs/architecture.md      request paths, storage, queue, trust chain      (new)
  docs/glossary.md          one name for each concept (see HYG-08, HYG-09)  (new)
  docs/contract.md          current rules only, as a list, no receipts
  docs/decisions/NNNN-*.md  one decision per file, with a unique ID
  docs/history/             all dated receipts and evidence indexes
  ```
- Alternatives:
  1. Minimal: add `docs/architecture.md` and a glossary, and remove receipts from the two READMEs. Change nothing else.
  2. Move all records and evidence to a separate repository or to GitHub issues (see HYG-13).
- Maintainer decision needed: yes. Are the dated receipts in the repository a requirement, or can they move out of the main reading path?

### HYG-08 · One screen uses three or more names for the same thing

- Kind: copy
- Severity: medium. Confidence: high. Measured: yes. Effort: M
- Evidence (all in `apps/web/src`; screenshot `review-fixture.png`):
  | Concept                                  | Names in the UI                                                                                       | Where                                                                                                                                                                  |
  | ---------------------------------------- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | Review unit, level 1 (`item` in code)    | "Screenshots", "items", "comparison items", "whole item"                                              | `review/review-workspace.tsx:627`, `:1009`, `:1280`, `:1293`; sidebar count "4 items" in the screenshot                                                                |
  | Review unit, level 2 (`variant` in code) | "variant", "view", "capture"                                                                          | `review-workspace.tsx:169` "Select a variant.", `:1055` "All {n} changed views…", `:1077` "Reject view", `:1251` "Review all changed views", `:1233` "Capture details" |
  | Old image (`reference` in code)          | "Baseline", "reference", "original"                                                                   | `review-workspace.tsx:888` button "Baseline", `:928` "requires both a reference and a new image", `:175` "original only", `:474` "Original comparison"                 |
  | New image (`candidate` in code)          | "Current", "new image"                                                                                | `review-workspace.tsx:874` button "Current", `:175` "new image only", `:927`                                                                                           |
  | View mode                                | "Compare" / "Side by side"; "Difference" / "Pixel diff"                                               | buttons `:845`, `:860`; help text `:175`; message `:379`                                                                                                               |
  | First screen                             | "Review queue", "Queue", "Inbox" (icon and PR title), `dashboard` (code, README), "Runs page" (guide) | `components/app-shell.tsx:2,16,29`; `review-workspace.tsx:584`; `routes/index.tsx:46-75`; `README.md:17`; `docs/review-guide.md:15`                                    |
  | Alerts                                   | "Service status", "alerts", "attention", `events` (API)                                               | `app-shell.tsx:18`; `components/operations-attention/index.tsx`; `/api/operations`                                                                                     |
  - The same dialog uses two names: heading "Review all changed views" (`review-workspace.tsx:1251`) and buttons "Reject whole item (n)" / "Approve whole item (n)" (`:1280`, `:1293`).
  - The keyboard help says "S / D / F / G: Side by side, red pixel diff, new image only, or original only." (`:174-175`). The buttons with those keys are "Compare", "Difference", "Current", "Baseline" (`:845-888`).
  - "Review queue" also has a second meaning: the durable D1 command queue (`apps/web/src/operations/review-queue.ts:69` `processReviewQueue`; `docs/current-contract.md:196` "a durable review queue in D1").
  - Count of visible strings (`vocabulary.mjs`, 269 extracted strings): `screenshot` 16, `capture` 16, `variant` 9, `view` 6, `item` 5; `current` 9, `new image` 5, `original` 5, `reference` 4, `baseline` 4.
- What happens: PR #252 changed the main labels and kept older strings in help text, messages, dialogs, and aria labels.
- Impact: The reader must map words at each step. This adds to the "bloated with text" problem, because unclear terms need more explaining text. It also makes UI tests and docs drift (HYG-04).
- Recommendation: Choose one word for each concept before the redesign and put it in a glossary. A possible set: Run, Screenshot (level 1), Variant (level 2), Baseline, Current, Diff. Then keep labels in one module:
  ```ts
  // apps/web/src/review/terms.ts
  export const modeLabels = {
    side: "Compare",
    diff: "Diff",
    new: "Current",
    original: "Baseline",
  } as const;
  ```
  Use the same module for buttons, help, aria labels, and messages.
- Alternatives:
  1. Minimal: fix the help dialog and the batch dialog to use the button words (about 10 strings).
  2. Rename the code identifiers too (`item` to `screenshot`, `candidate` to `current`). This is large, because the protocol and D1 use `item`, `capture`, `reference`, and `candidate`.
- Maintainer decision needed: yes. Which word set is canonical?

### HYG-09 · Code uses five names for the CI submission path, and resource names are now mixed

- Kind: inconsistency
- Severity: low. Confidence: high. Measured: yes. Effort: L
- Evidence:
  - File `apps/web/src/api/workflow-owned.ts` exports `reserveStaged`, `beginStaged`, `declareStaged`, `reuseStagedImages`, `uploadStagedImage`, `finalizeStaged`, `submitStaged` (`apps/web/src/api/index.ts:19-29`).
  - Tables: `ingest_staged_runs`, `ingest_staged_bundles`, `ingest_staged_images`, `ingest_staged_manifests`, `pre_run_checks`.
  - Files: `pre-run.ts`, `pre-run-attempts.ts`, `pre-run-candidates.ts`, `pre-run-checks.ts`, `pre-run-plan.ts`, `workflow-materialize.ts`, `workflow-evidence.ts`, `workflow-reconcile.ts`, `workflow-retention.ts`, `ingest.ts`.
  - Configuration: `VISONAUT_WORKFLOW_OWNED` (`apps/web/wrangler.jsonc:61`). Queue message kind: `ingest`. CLI and docs: "Submit".
  - Counts in web server source (`vocabulary.mjs`): `staged` 295, `ingest` 142, `submit` 134, `workflowOwned` 36, `pre-run` 20.
  - Table prefixes in the final schema (`schema-scan.mjs`): `visonaut_` 33, `operations_` 16, `ingest_` 10, `work_` 5, `github_` 2, `pre_run_` 1, `transfer_` 1, plus the Better Auth tables.
  - Product names: "Visuaria" (`docs/design-verification.md:1`), "Ariviso" (`apps/web/migrations/0001_service.sql`, 59 mentions; `packages/security/src/checks.ts:6` `const legacyCheckName = "Ariviso"`), "Visonaut".
  - Resource names after #251: D1 `visonaut`, R2 `visonaut-images` and `visonaut-quarantine` (`apps/web/wrangler.jsonc:70-81`), but queues `visonaut-production-operations` and `visonaut-production-dead-letter` (lines 95-105).
- What happens: Each name is from a different phase of the project (15 days, 258 commits). The old names were kept when the design changed.
- Impact: A search for one concept needs five words. New code picks one of the names at random.
- Recommendation: Record the mapping in the glossary first (cost: one page). Rename files only when a module is split for another reason (HYG-15). Example target: folder `apps/web/src/api/submit/` with `reserve.ts`, `declare.ts`, `images.ts`, `finalize.ts`.
- Alternatives: no rename; glossary only. Queue rename needs a Cloudflare resource change and is a separate decision.
- Maintainer decision needed: yes. Is a code rename wanted, or only a glossary?

### HYG-10 · The retired "Recompare stored run" control is still in the page, with permanent footer text

- Kind: dead-code
- Severity: medium. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - `docs/review-guide.md:88`: "**Recompare stored run** is retired."
  - Server: `apps/web/src/api/review.ts:592`: `recompareAllowed: false,` for every model, with a reason string (lines 593-598).
  - Server endpoint `POST /api/runs/:id/recompare` (`review.ts:950-987`): runs `projectRun` and up to two more D1 queries, then throws on every path. The last line is `throw new SecurityError("local_comparison_required", 409, serverRecompareDisabledReason);`.
  - Client: `createReviewCommands` always defines `recompare()` (`apps/web/src/review/client.ts:355-360`).
  - UI: `apps/web/src/review/review-workspace.tsx:1186-1201` renders the button when `commands.recompare && !model.preview`, and renders `<p>{recompareDisabledReason}</p>` when recompare is not allowed. A second button "Recompare now" is at lines 979-988. The handler and its message "Creating a new comparison from stored captures…" are in `apps/web/src/review/use-review-session.ts:507-540`.
  - Measurement in the fixture with the production-like flag (`footer-text.mjs`, URL `...index.html?localComparison`):
    ```json
    "footerText": "Shortcuts on Recompare stored run Rerun trusted Submit to compare locally again.",
    "footerButtons": [ ..., { "text": "Recompare stored run", "disabled": true, "title": "Rerun trusted Submit to compare locally again." } ]
    ```
- What happens: In production, every review page shows a disabled button and one sentence that explains why it is disabled. The feature cannot be enabled by any server response.
- Impact: Permanent visual noise in the footer of the main work screen. About 90 lines of client code, one API route, the model fields `recompareAllowed` and `recompareDisabledReason`, the run status `needs-recompare`, and browser tests keep a feature that does not exist.
- Recommendation: Remove the button, the footer paragraph, the client command, and the route. Keep the status label "New capture needed" (`apps/web/src/routes/index.tsx:131`) for old runs. The route can return the standard `404 not_found`, as the export routes do.
- Alternatives: minimal, remove only the two buttons and the footer paragraph (UI change only).
- Maintainer decision needed: no.

### HYG-11 · Inventory of code and configuration with no current consumer

- Kind: dead-code
- Severity: medium. Confidence: medium. Measured: yes. Effort: M
- Evidence:
  | Item                                                            | Size                                                                               | Evidence                                                                                                                                                                                                                                                                 |
  | --------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
  | Vendored `tabs.ariakit.react.tsx` and `kbd.ariakit.react.tsx`   | 778 + 93 lines                                                                     | `vendored-usage.mjs`: zero importers in app, tests, docs, and tooling. Variant tabs were replaced by links (`docs/current-contract.md:192`).                                                                                                                             |
  | `apps/compare/src/process.ts` (legacy comparison engine)        | 232 lines                                                                          | The production entry imports only `codecs.ts` and `validate.ts` (`apps/compare/src/index.ts:1-2`). Importers of `process.ts`: two test files and `apps/compare/container/transport.ts:3`.                                                                                |
  | Compare Worker production bindings `DB`, `IMAGES`, `OPERATIONS` | 20 config lines                                                                    | `apps/compare/wrangler.jsonc:38-58`. The handler takes no `env` argument (`apps/compare/src/index.ts:5`: `async fetch(request: Request)`).                                                                                                                               |
  | Probe and container code in `apps/compare`                      | `probe.ts` 86, `probe-auth.ts` 16, `container/*` 562 lines, 2 extra Wrangler files | `apps/compare/README.md`: "explicit diagnostic probe". Production resources are retired (`docs/current-contract.md:188`).                                                                                                                                                |
  | `allowMainDispatch` option and `VISONAUT_ALLOW_MAIN_DISPATCH`   | 6 code sites                                                                       | `apps/web/src/api/workflow-owned.ts:217-219` needs `environment === "preview"`, but preview returns before the API (`apps/web/src/server.ts:73-80`). `apps/web/src/runtime.ts:241-242` makes it false in production. The value cannot be true in a deployed environment. |
  | `apps/web/src/api/tsconfig.json`                                | 15 lines                                                                           | No script or config refers to it (`rg "api/tsconfig"` has no match). Last change: the first implementation commit `43552ce`.                                                                                                                                             |
  | `packages/security/migrations/0001_auth.sql`                    | 1.8 KB                                                                             | Byte-identical to `apps/web/migrations/0003_auth.sql`. Referenced only by a README sentence (HYG-06).                                                                                                                                                                    |
  | `apps/web/src/review.css`                                       | 2 lines                                                                            | `@import "tailwindcss"; @import ".../ui.css";`. `apps/web/src/styles.css:1-3` imports `review.css` and then the same two files again. The built CSS has no duplicate (`css-dupes.mjs`).                                                                                  |
  | Semantic class names with no stylesheet                         | 34 names                                                                           | `class-hooks.mjs`: none is defined in any CSS file after #252 removed 78 CSS lines. 18 are test selectors, 3 are script hooks, 15 have no consumer (for example `review-main`, `review-result`, `review-view-controls`, `dashboard-main`).                               |
  | `apps/web/tooling/backup-v2-recorded`                           | 12 files, `generate-fixture.mjs` 1,032 lines                                       | Backups were retired in #130 and #154.                                                                                                                                                                                                                                   |
  | One-time cutover tool `apps/web/tooling/baseline-reset`         | `reset.ts` 842 lines, `reset.test.ts` 955 lines                                    | The test runs in every `pnpm test` (`vitest.config.ts:5` includes `apps/**/*.test.ts`). A product test imports the tool: `apps/web/src/operations/sparse-storage.test.ts:30` `from "../../tooling/baseline-reset/reset.ts"`.                                             |
  | Legacy check name branch                                        | 4 code sites                                                                       | `packages/security/src/checks.ts:6,11,80,175` (`"Ariviso"`).                                                                                                                                                                                                             |
- What happens: The contract keeps several of these on purpose (`docs/current-contract.md:54` "D10: keep copied components... No pruning"; line 188 keeps the probes). The rest are leftovers from fast retirements.
- Impact: About 4,600 lines and three Wrangler files that a reader must classify as "not live". Unused Worker bindings give the stateless compare Worker access to the production database and bucket for no reason.
- Recommendation: Remove the items that no decision protects: the compare Worker bindings, `allowMainDispatch`, `api/tsconfig.json`, the duplicate migration, `review.css`, the 15 unused class names, and `backup-v2-recorded`. Replace test-selector classes with roles or `data-testid`. Move probes and one-time tools to a folder that normal test runs exclude, or to another repository.
- Alternatives: minimal, remove only the unused bindings and the dead option (security-relevant, small). Or keep all and add a `LEGACY.md` list.
- Maintainer decision needed: yes. D10 and the probe retention are contract decisions. Do they still stand after the UI redesign?

### HYG-12 · 11 of 74 tables have no reference in runtime source; migration numbers have gaps and one duplicate

- Kind: dead-code
- Severity: low. Confidence: medium. Measured: yes. Effort: M
- Evidence:
  - `schema-scan.mjs` applies the 33 migration files to in-memory SQLite. Result: 74 tables, 38 indexes, 18 triggers, 0 failures.
  - Tables with zero references in non-test source under `apps/` and `packages/`: `operations_backup_group_pages`, `operations_backup_groups`, `operations_backup_inventory`, `operations_backup_members`, `operations_backup_objects`, `operations_backup_pages`, `operations_backup_required`, `operations_backups`, `operations_promotions`, `transfer_key_redemptions`, `visonaut_baseline_restorations`.
  - Migration file names: `0017` and `0025` are missing, and there are two `0030_*` files (`apps/web/migrations/`). `docs/development.md:36` requires that both stay.
  - Only two `DROP TABLE` statements exist in all migrations.
  - `docs/baseline-delta-cutover.md` (step 4): "Apply all migrations from this PR to the replacement database only". A fresh database therefore gets all 74 tables.
- What happens: Retired features leave their tables. A fresh production database is created with tables for backups and transfer keys that no code reads.
- Impact: Small storage cost. Larger reading cost: the schema shows 16 `operations_` tables and 8 are dead. Every test that calls `applyTestMigrations` executes all 33 files (29 files call it; see Measurements).
- Recommendation: After the database cutover is final, add one migration that drops the 11 tables, or create a squashed baseline schema for new databases and tests.
  ```sql
  -- 0035_drop_retired_tables.sql
  DROP TABLE IF EXISTS operations_backup_group_pages;
  DROP TABLE IF EXISTS operations_backup_groups;
  -- ...
  ```
- Alternatives: keep the tables and add a comment file that lists retired tables. The contract (D14, `docs/current-contract.md:58`) currently says "No destructive migration".
- Maintainer decision needed: yes. D14 forbids table deletion. Is that still the rule now that production uses a fresh database?

### HYG-13 · Evidence and frozen artifacts are 77% of the history weight, and no code or CI job reads them

- Kind: cost
- Severity: low. Confidence: high. Measured: yes. Effort: M
- Evidence:
  - `du -sh`: `tooling/evidence` 7.4M, `docs/evidence` 4.2M, `packages/compare/evidence` 544K, `apps/web/tooling` 652K, `docs/simplification-audit` 2.6M, `docs` 8.8M.
  - Tracked bytes (`sizes.mjs`): `tooling/evidence` 7.21 MB in 83 files, `docs/evidence` 3.67 MB in 248 files, `docs/simplification-audit` 2.43 MB in 58 files, `docs/design-r9.html` 1.33 MB, `apps/web/tooling` 530.8 KB in 50 files, `packages/compare/evidence` 505.5 KB in 20 files.
  - Largest files: `tooling/evidence/v3-small/inputs/prepared.sql.gz` 2.41 MB, `docs/design-r9.html` 1.33 MB, `docs/simplification-audit/index.html` 1.13 MB, `tooling/evidence/v3-large-numeric/frozen-evidence.tar.gz` 1.0 MB.
  - By type: 29 `.gz` files 6.88 MB, 265 `.json` files 5.15 MB, 7 `.html` files 2.46 MB, 13 Python scripts 103 KB.
  - History (`history-size.mjs`): 2,712 blob versions, 11.42 MB on disk. Evidence, audit, design, and tooling directories are 8.78 MB (76.9%). `tooling/evidence` alone is 6.14 MB (53.8%).
  - `dupes.mjs`: `docs/design-r9.json` and `docs/simplification-audit/prior-r9.json` are byte-identical (241 KB each). Seven migration files are copied into `apps/web/tooling/backup-v2-recorded/frozen-schema/`.
  - Consumers: `dupes.mjs refs` finds 0 references to `tooling/evidence` from code, CI, or package manifests. The 13 Python scripts have no declared Python version or dependency file.
  - `docs/simplification-audit/source` contains an app (`main.tsx` 875 lines, `ui-prototypes.tsx` 627, `style.css` 1,222) that lint ignores (`.oxlintrc.json:4`) and no type check covers.
- What happens: Each measurement and rehearsal committed its inputs, recorded Worker bundles, and results.
- Impact: The absolute size is small (16 MiB pack). The real cost is navigation: 331 evidence files beside 6 guides, and search results full of JSON receipts. Binary `.gz` blobs never compress further and stay in history.
- Recommendation: Keep the short Markdown summary of each evidence set in the repository. Move the raw inputs and outputs to a release asset, an R2 bucket, or a separate `visonaut-evidence` repository, and link them by digest.
- Alternatives:
  1. Minimal: add `docs/evidence/README.md` as an index with one line and a date for each set, and delete the duplicate `prior-r9.json`.
  2. Keep all, and add `.ignore` rules so that search tools skip the evidence folders.
- Maintainer decision needed: yes. Must raw evidence stay in this repository?

### HYG-14 · Tests: three layouts, five files hold 40% of the test lines, and fixture builders are repeated

- Kind: simplification
- Severity: medium. Confidence: high. Measured: yes. Effort: L
- Evidence (`test-scan.mjs`):
  - Layouts: 46 files beside source (29,369 lines), 29 files in a package `test/` directory (8,647 lines), 8 files in `__tests__` directories (3,954 lines), 2 in tooling, 7 in `.github/workflows/scripts`.
  - `packages/service` puts tests in `src/`; `packages/cli`, `packages/security`, `packages/playwright`, `packages/protocol`, `packages/compare`, and `apps/compare` use `test/`; `apps/web` uses both co-location and `__tests__`.
  - Largest files:
    | File                                                     | Lines | Tests | Longest test |
    | -------------------------------------------------------- | ----- | ----- | ------------ |
    | `apps/web/src/api/workflow-owned.test.ts`                | 5,054 | 76    | 158          |
    | `apps/web/src/api/webhooks.test.ts`                      | 4,673 | 126   | 77           |
    | `packages/service/src/service.test.ts`                   | 3,871 | 66    | 132          |
    | `apps/web/src/api/api.test.ts`                           | 2,000 | 28    | 139          |
    | `apps/web/src/review/__tests__/review.browser.test.ts`   | 1,954 | 73    | 66           |
    | These five files have 17,552 of 43,725 test lines (40%). |
  - A function named `fixture` is defined in 15 test files, 1,578 lines in total. The largest are `api.test.ts` (387 lines) and `workflow-owned.test.ts` (321 lines). No two are verbatim copies.
  - `execute` (15 lines) is defined in 5 CLI test files (`packages/cli/test/{cli,declaration,local-comparison,public,retry}.test.ts`), although `packages/cli/test/fixture.ts` exists.
  - Test helpers are in product source folders: `apps/web/src/api/test-storage.ts`, `test-d1-costs.ts`, `test-upload-costs.ts`, `apps/web/src/operations/test-fixtures.ts`.
  - 53 relative imports leave their workspace (`cross-imports.mjs`). Examples: `apps/web/src/api/tolerated-mask.test.ts:11` `from "../../../compare/src/process.ts"`; `packages/service/src/service.test.ts` `from "../../compare/src/compare.ts"`; `packages/playwright/test/clients.test.ts` `from "../../cli/src/artifact-archive.js"`; 25 imports of `tooling/test-migrations.ts` and `tooling/legacy-comparison-fixture.ts` from `apps/web`.
- What happens: The test files grew with each feature PR. Vitest shards by file, so one 5,000-line file is one unit (assumption: this limits the benefit of the 3 CI shards; not measured).
- Impact: A failure in `workflow-owned.test.ts` needs a search in 5,054 lines. Shared setup changes must be repeated in up to 15 builders. Cross-workspace relative imports hide real dependencies between packages.
- Recommendation: Split each large file by its existing `describe` groups (workflow-owned has 6, webhooks has 4, service has 17). Create one shared test package for database and run fixtures:
  ```ts
  // packages/test-support/src/index.ts (private workspace)
  export { applyTestMigrations, readTestMigrations } from "./migrations.ts";
  export { createRunFixture } from "./run-fixture.ts";
  ```
  Then import `@visonaut/test-support` and declare it in each `devDependencies`.
- Alternatives:
  1. Minimal: split only the two files above 4,000 lines, and move `execute` into `packages/cli/test/fixture.ts`.
  2. Choose one layout rule (for example `test/` beside `src/` in every workspace) without a split.
- Maintainer decision needed: yes. Which test layout is the standard?

### HYG-15 · Twelve source modules are above 800 lines; the review workspace is one 1,105-line component

- Kind: simplification
- Severity: medium. Confidence: high. Measured: yes. Effort: L
- Evidence (`sizes.mjs lines 800`, `outline.mjs`; test files are in HYG-14):
  | File                                       | Lines | Largest unit                                                          | Suggested split                                                                                                                                                                                                                                                                                          |
  | ------------------------------------------ | ----- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `apps/web/src/review/review-workspace.tsx` | 1,300 | `ReviewSession` L195-1299, 1,105 lines                                | Shortcut hook (about L395-448); header and progress (about L562-700); variant strip (about L728-800); view and zoom controls (about L823-930); evidence frame (about L931-1004); action bar and save state (about L1027-1140); details panel (about L468-526 and L1147-1171); three dialogs (L1206-1296) |
  | `apps/web/src/api/workflow-owned.ts`       | 1,290 | `declareStaged` L476-759, 284 lines                                   | One file for each endpoint: reserve and begin (L293-474), declare (L476-759), image reuse and upload (L807-1122), finalize and submit (L1124-1289); shared configuration (L111-199)                                                                                                                      |
  | `apps/web/src/api/pre-run-attempts.ts`     | 1,035 | `ensureSignedAttemptCheck` L690-879                                   | Attempt retirement rules (L67-552, six functions); check binding (L554-879); settlement (L882-1034)                                                                                                                                                                                                      |
  | `apps/web/src/api/review.ts`               | 990   | `reviewModel` L227-617, 391 lines; `handleReview` L699-989, 291 lines | Read model in one file; one handler function for each route in another                                                                                                                                                                                                                                   |
  | `apps/web/src/operations/history.ts`       | 986   | `sourcePage` L473-659                                                 | Source table definitions (L56-189); readers (L200-387); writer, claim, and archive (L683-966)                                                                                                                                                                                                            |
  | `apps/web/src/api/workflow-materialize.ts` | 961   | `materializeWorkflowRun` L494-820, 327 lines                          | Images (L167-261); bundle (L263-491); run (L494-820); reconcile loop (L823-960)                                                                                                                                                                                                                          |
  | `packages/cli/src/engine.ts`               | 936   | `uploadShard` L438-684; `runInternalCli` L695-935                     | Argument parsing (L61-106); one file for each command; dispatcher                                                                                                                                                                                                                                        |
  | `packages/service/src/work.ts`             | 822   | 45 exports                                                            | Work queue (claim, complete, fail) and status outbox (L398-693)                                                                                                                                                                                                                                          |
  | `packages/service/src/run-admission.ts`    | 802   | `reserveRun` L46-353, 308 lines; `commitShard` L409-701, 293 lines    | One file for each transition                                                                                                                                                                                                                                                                             |
  - Below 800 but relevant to the UI work: `apps/web/src/routes/index.tsx`, 753 lines, holds three views in one route (`Index` L159-381, `ReviewQueue` L417-558, `RunHistory` L605-752), selected by `?view=` (lines 40-41).
  - Vendored or tooling files above 800 lines, for completeness: `components/ariakit/styles/ui.css` 1,541; `apps/web/tooling/backup-v2-recorded/generate-fixture.mjs` 1,032; `apps/web/tooling/baseline-reset/reset.ts` 842.
  - Functions with 4 or more positional parameters in non-test source: 33 (`style-scan.mjs`), for example `verifyLineage` (`apps/web/src/api/lineage.ts:82`).
- What happens: PRs #231 to #233 split by purpose once ("Split pre-run operations", "Split service transitions", "Extract the review command session"). The largest functions stayed whole.
- Impact: `ReviewSession` holds about 30 state values, the keyboard handler, and all markup. Each UI variant must change this one function. This is the main obstacle for the planned redesign, because the layout cannot change without touching the session logic.
- Recommendation: Split `ReviewSession` first. Keep `useReviewSession` as is, and pass plain props to presentational parts:
  ```tsx
  <ReviewLayout
    sidebar={<ScreenshotList ... />}
    header={<RunHeader run={model.run} progress={counts} />}
    viewer={<EvidenceFrame variant={variant} mode={mode} zoom={zoom} evidence={evidence} />}
    actions={<ActionBar session={session} targets={targets} />}
  />
  ```
  The design variants can then replace `ReviewLayout` without a change to the session.
- Alternatives: minimal, extract only the three dialogs and the shortcut hook (about 150 lines, no behavior risk). For the server files, split only when a file is next changed.
- Maintainer decision needed: no.

### HYG-16 · TypeScript configuration differs by workspace, some tests are not type-checked, and some dev dependencies are not declared

- Kind: inconsistency
- Severity: medium. Confidence: high. Measured: yes. Effort: M
- Evidence:
  - Extends the root `tsconfig.json`: `apps/web`, `packages/playwright`, `packages/service`. Does not: `apps/compare`, `packages/cli`, `packages/compare`, `packages/protocol`, `packages/security`.
  - `target`: ES2022 (`packages/security/tsconfig.json:3`), ES2023 (root, `packages/protocol`), ES2024 (`apps/compare`, `packages/cli`, `packages/compare`).
  - `verbatimModuleSyntax` is in the root and in `packages/cli` only. `module` is `NodeNext` in `packages/cli` and `packages/protocol`, and `ESNext` with `Bundler` in the others.
  - Type-check program contents (`tsc6 --noEmit --listFilesOnly`):
    - `packages/protocol`: 5 files, all in `src`. `packages/protocol/test/*.test.ts` (2 files, 616 lines) is not checked (`"include": ["src"]`).
    - `apps/compare`: no file from `apps/compare/test` (5 files, 816 lines; `"include": ["src", "worker-configuration.d.ts"]`).
    - `apps/web`: from the tooling folders, only `apps/web/tooling/baseline-reset/reset.ts` (through a test import). `reset.test.ts`, `worker.ts`, `probe.cost.ts`, and `run-routes.test.ts` are not checked.
  - Undeclared dependencies (`cross-imports.mjs`): `apps/web` imports `vitest` in 50 files and `@playwright/test` in 6 files, and declares neither (`apps/web/package.json:28-41`). `packages/service` and `packages/compare` import `vitest` and call `tsc6` in scripts with no `devDependencies` at all (`packages/service/package.json`, `packages/compare/package.json`). `apps/compare/container/server.mjs` imports `sharp`, which only the nested npm package declares.
  - Per-package scripts `"test": "vitest run"` (for example `packages/cli/package.json:31`) have no local Vitest config, so they do not use the root `testTimeout: 15000`. Assumption from Vite config resolution; not run.
  - `apps/web` has no `test` script. `apps/web/src/api/tsconfig.json` is unused (HYG-11).
- What happens: Each workspace was configured by copy. The root hoists the missing tools.
- Impact: A type error in 1,432 lines of `protocol` and `compare` Worker tests reaches CI only as a runtime failure. `import type` discipline differs by package. A strict pnpm setup would break the undeclared imports.
- Recommendation: One base file and thin workspace files.
  ```jsonc
  // packages/protocol/tsconfig.json
  {
    "extends": "../../tsconfig.json",
    "compilerOptions": { "types": ["node"] },
    "include": ["src", "test"],
  }
  ```
  Add `vitest`, `typescript`, and `@playwright/test` to the `devDependencies` of each workspace that imports them.
- Alternatives: minimal, add `test` to the two `include` arrays and declare `vitest` in `apps/web`. Or use TypeScript project references with one root `tsc -b`.
- Maintainer decision needed: no.

### HYG-17 · Lint checks one category; the shared Ariakit code-style rules are not enforced and the code deviates in countable ways

- Kind: inconsistency
- Severity: low. Confidence: high. Measured: yes. Effort: M
- Evidence:
  - `.oxlintrc.json:9`: `"categories": { "correctness": "error" }`. `pnpm exec oxlint` exits 0 in 1.6 s. `oxfmt --check` reports no issue in tracked files (0.9 s).
  - AST scan of 307 tracked TypeScript files against `ariakit-general-code-style` (`style-scan.mjs`), non-test source only:
    | Rule                                                       | Count |
    | ---------------------------------------------------------- | ----- |
    | `if` body without braces that is not an allowed early exit | 330   |
    | Several early exits combined with `\|\|`                   | 61    |
    | Loop body without braces                                   | 8     |
    | Function with 4 or more positional parameters              | 33    |
    | Relative import with `.js` extension                       | 161   |
    | Relative import with `.ts` or `.tsx` extension             | 337   |
    | Non-null assertion                                         | 2     |
    | `unknown as T` cast                                        | 1     |
    | `as any`                                                   | 0     |
    | Object shape declared with `type` instead of `interface`   | 0     |
    | Module-level arrow function                                | 1     |
  - Mixed import extensions in one file: `apps/web/src/api/index.ts:11` `from "../operations/failure.ts"` and line 12 `from "./context.js"`.
  - Examples: `apps/web/src/server.ts:83-84` (`if (...)` then `return` on the next line, no braces); `apps/web/src/server.ts:166` `for (const message of valid) message.retry({ delaySeconds: 60 });`; `apps/web/src/api/workflow-reconcile.ts:77` `object(JSON.parse(value)) as unknown as VerifiedRun`.
  - Tests have 34 non-null assertions on indexed access.
- What happens: The code is consistent on types (`interface`, no `any`). It is not consistent on braces, parameter objects, and import extensions.
- Impact: Low risk. Review comments about style will repeat, and agents that follow the shared style produce diffs that differ from the surrounding code.
- Recommendation: Decide if the shared style applies to this repository. If yes, enable the rules that a tool can check and fix them in one mechanical PR:
  ```jsonc
  // .oxlintrc.json
  "rules": { "curly": ["error", "multi-line"], "max-params": ["error", 3], "import/extensions": ["error", "always"] }
  ```
  (Rule options need a check against oxlint 1.83.) Choose `.ts` for relative imports; `allowImportingTsExtensions` is already on in most packages.
- Alternatives: no new rules; fix only the `.js` and `.ts` mix (161 specifiers, mechanical). Or accept the current style and record that this repository differs.
- Maintainer decision needed: yes. Does `ariakit-general-code-style` apply to Visonaut as written?

### HYG-18 · Error responses have at least six shapes

- Kind: inconsistency
- Severity: low. Confidence: high. Measured: no. Effort: M
- Evidence:
  | Shape                                                               | Where                                                            |
  | ------------------------------------------------------------------- | ---------------------------------------------------------------- |
  | `{ schemaVersion, error: { code, message } }`                       | `apps/web/src/api/index.ts:38-65`                                |
  | `{ schemaVersion, error: { code, message, reference } }`            | `apps/web/src/api/index.ts:73-83`                                |
  | `{ error: { code: "not_found", message } }` without `schemaVersion` | `apps/web/src/api/index.ts:216-218`                              |
  | `{ error: { code, message, reference? } }` without `schemaVersion`  | `apps/web/src/server.ts:34-53`                                   |
  | `{ error: { code: "conflict", message }, model, reviewer? }`        | `apps/web/src/api/review.ts:688-695`, `:819-830`                 |
  | Empty body with status 403 or 405                                   | `apps/web/src/server.ts:75`, `:84`, `:90-92`                     |
  | Plain text `"Not found"`                                            | `apps/web/src/api/index.ts:118`, `apps/web/src/api/images.ts:19` |
  | `{ error: "text" }` and `{ code, error: "text" }`                   | `apps/compare/src/validate.ts:18`, `:41-45`                      |
  - The same condition has two shapes: a wrong origin gives an empty 403 in `server.ts:75,84,90` and JSON `wrong_origin` in `api/index.ts:110-112`.
  - The path-prefix test is written three times: `server.ts:106-111`, `api/index.ts:96-101`, `review/preview-fixtures.ts:72-77`.
  - `/api/auth/` is handled in `server.ts:82-87` and again in `api/index.ts:131-133`. The second copy is reachable only from tests that call `handleApi` directly.
- What happens: Each layer returns its own error format.
- Impact: The clients need defensive parsing. The empty 403 is the reason why HYG-01 shows a blank page.
- Recommendation: One helper for all layers.
  ```ts
  export function errorResponse(status: number, code: string, message: string, reference?: string) {
    return Response.json(
      {
        schemaVersion: SCHEMA_VERSION,
        error: { code, message, ...(reference ? { reference } : {}) },
      },
      { status },
    );
  }
  ```
  Export one `isBackendPath(pathname)` function and use it in the three places.
- Alternatives: minimal, give the origin failures a JSON body and add `schemaVersion` to the 404.
- Maintainer decision needed: no.

### HYG-19 · Scripts: `pnpm check` is not the CI gate, two package scripts bypass the guarded deploy path, and the public adapter pins one Node patch version

- Kind: dx
- Severity: low. Confidence: high. Measured: no. Effort: S
- Evidence:
  - `package.json:14`: `"check": "pnpm lint && pnpm typecheck && pnpm build && pnpm test && pnpm test:browser"`. CI Gate also needs `pnpm check:packages` (`.github/workflows/checks.yml:74-75`) and `pnpm test:release-guards` (line 144). `README.md:48-51` gives `pnpm check` as the one local command.
  - `apps/web/package.json:11,13`: `"deploy": "pnpm build && wrangler deploy"` and `"db:remote": "wrangler d1 migrations apply DB --remote --env production"`. `.github/workflows/README.md:7` says that manual `migrate` runs "with independent credentials and fence acknowledgments".
  - `packages/playwright/package.json:59-61`: `"engines": { "node": "24.18.0" }` in a public package. `packages/cli/package.json:45-47` uses a range: `"node": ">=24.18.0 <25"`. The root also pins `24.18.0` exactly (`package.json:33-35`).
  - `package.json:17`: `test:container` uses npm in a nested package with its own lockfile.
  - CI builds 4 times and installs 7 times for each run (`.github/workflows/checks.yml`). The docs keep this on purpose (`.github/workflows/README.md:5`).
- What happens: The local "all checks" command covers five of seven CI jobs. A developer with Cloudflare credentials can apply production migrations with one package script. A consumer of `@visonaut/playwright` on Node 24.19 gets an engine warning, or an install failure with strict engines.
- Impact: CI failures after a green local check. A possible unreviewed production schema change. Friction for adapter consumers.
- Recommendation:
  ```json
  "check": "pnpm lint && pnpm typecheck && pnpm build && pnpm check:packages && pnpm test && pnpm test:browser && pnpm test:release-guards"
  ```
  Remove `db:remote` and `deploy` from `apps/web/package.json`, or make them print the workflow name and exit. Use `">=24.18.0 <25"` in the adapter.
- Alternatives: keep the scripts and document that they are for emergencies. Keep the exact engine pin if the Playwright image fixes the Node version for all consumers.
- Maintainer decision needed: yes. Is local production migration an intended emergency path?

## Measurements (command, raw result, limits)

All commands ran from the scratch directory against the worktree. No file in the repository was written by this lane. The untracked `apps/lab/` folder and the changed `pnpm-lock.yaml` in `git status` are from another lane.

| #   | Command                                                                                                                                                     | Raw result                                                                                                                                                                     | Limits                                                                    |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| 1   | `du -sh tooling/evidence docs/evidence packages/compare/evidence apps/web/tooling docs tooling docs/simplification-audit docs/operations`                   | 7.4M, 4.2M, 544K, 652K, 8.8M, 7.4M, 2.6M, 200K                                                                                                                                 | Disk blocks, includes ignored files                                       |
| 2   | `node sizes.mjs summary`                                                                                                                                    | 919 tracked files, 21,034,889 bytes; docs 8.03 MB, tooling 7.23 MB, apps 3.05 MB, packages 1.49 MB; `.gz` 29 files 6.88 MB, `.json` 265 files 5.15 MB, `.html` 7 files 2.46 MB | Tracked files only                                                        |
| 3   | `node sizes.mjs largest 70`                                                                                                                                 | Top: `prepared.sql.gz` 2.41 MB, `design-r9.html` 1.33 MB, `simplification-audit/index.html` 1.13 MB                                                                            |                                                                           |
| 4   | `git count-objects -vH`; `git rev-list --count HEAD`                                                                                                        | `size-pack: 16.16 MiB`, `in-pack: 8398`; 258 commits                                                                                                                           | Shared object store of the main checkout                                  |
| 5   | `node history-size.mjs`                                                                                                                                     | 2,712 blob versions, 55.05 MB raw, 11.42 MB on disk; `tooling/evidence` 6.14 MB (53.8%); evidence, audit, design, tooling 8.78 MB (76.9%)                                      | Blobs reachable from `HEAD` only                                          |
| 6   | `node sizes.mjs lines 600`                                                                                                                                  | 12 non-test source modules of 800 lines or more; see HYG-15                                                                                                                    | Lines include blanks and comments                                         |
| 7   | `node outline.mjs <files>`                                                                                                                                  | For example `review-workspace.tsx: 1300 lines... 1105 lines L195-1299 function ReviewSession`                                                                                  | Top-level statements only                                                 |
| 8   | `node test-scan.mjs summary` and `helpers`                                                                                                                  | 92 files, 43,725 lines, 1,083 tests; `fixture` in 15 files (1,578 lines); `execute` in 5 files; 0 verbatim copies of 6 lines or more                                           | Counts `test(` and `it(` calls, including `it.each` as one                |
| 9   | `node docs-stats.mjs table` and `groups` and `codes`                                                                                                        | 122 files, 132,356 words; contract 5,773 words, 47 lines above 500 characters, 199 code mentions, 78 unique                                                                    | Words split on whitespace                                                 |
| 10  | `node ui-strings.mjs`                                                                                                                                       | 7 guide labels missing from source; see HYG-04                                                                                                                                 | Exact substring match                                                     |
| 11  | `node vocabulary.mjs`                                                                                                                                       | Term counts by layer; see HYG-08 and HYG-09                                                                                                                                    | Regular-expression match, includes identifiers                            |
| 12  | `node footer-text.mjs "<fixture>?localComparison"`                                                                                                          | Footer text "Shortcuts on Recompare stored run Rerun trusted Submit to compare locally again."; button disabled                                                                | Fixture page, Chrome, 1440x900                                            |
| 13  | `node style-scan.mjs`                                                                                                                                       | 307 files scanned; counts in HYG-17                                                                                                                                            | AST scan with the repository TypeScript; early-exit rule approximated     |
| 14  | `node cross-imports.mjs`                                                                                                                                    | 53 relative imports leave their workspace; undeclared: `apps/web -> vitest` 50 files, `@playwright/test` 6 files                                                               | Regular-expression import parser                                          |
| 15  | `node schema-scan.mjs all`                                                                                                                                  | 33 migrations, 0 failures, 74 tables, 38 indexes, 18 triggers; 11 tables with zero runtime references                                                                          | Plain SQLite, not D1; reference = table name as a word in non-test source |
| 16  | `node vendored-usage.mjs`                                                                                                                                   | 9,652 vendored lines; `tabs` and `kbd` not reachable (871 lines)                                                                                                               | Static import graph                                                       |
| 17  | `node class-hooks.mjs`                                                                                                                                      | 34 semantic class names, 0 in CSS, 18 in tests, 3 in script, 15 with no consumer                                                                                               | Class names that start with `review`, `dashboard`, or `operations`        |
| 18  | `node dupes.mjs dupes` and `refs`                                                                                                                           | 8 identical-content groups, 263.6 KB; 0 code or CI references to `tooling/evidence`                                                                                            | Files of 1 KB or more                                                     |
| 19  | `node css-dupes.mjs`                                                                                                                                        | `index-CXm4JU5N.css: 464666 bytes, gzip 60125 bytes`; one `@layer base` block; no repeated slice                                                                               | Existing `apps/web/dist` from 16:23 today; built by another process       |
| 20  | `curl` with five `Host` values against `127.0.0.1:4310`                                                                                                     | 200, 403, 403, 403, 200 (`/health`); 403 has `content-length: 0`                                                                                                               | Server runs with the local `.dev.vars` override                           |
| 21  | `pnpm exec oxlint --ignore-pattern "apps/lab/**"`; `pnpm exec oxfmt --check`                                                                                | exit 0, no diagnostics, 1.58 s; 48 format issues, all in untracked `apps/lab`, 0.88 s                                                                                          | One run each                                                              |
| 22  | `pnpm exec oxlint -D suspicious -D pedantic -D style --format unix`                                                                                         | Top rules: `no-magic-numbers` 6,514, `curly` 1,610, `func-style` 1,119, `max-params` 44, `max-lines` 90                                                                        | Not the configured rule set; for scale only                               |
| 23  | `pnpm exec tsc6 --noEmit --listFilesOnly -p tsconfig.json` in `packages/protocol`, `apps/compare`, `apps/web`                                               | protocol: 5 files; compare: 0 test files; web: 3 tooling files                                                                                                                 | Lists the program; does not report errors                                 |
| 24  | `git log -S"if (url.origin !== env.VISONAUT_ORIGIN) {"`; `git log -S"starts the public fixture demo"`; `git show f83fef6 --stat`; `git show e277a91 --stat` | `5712036` (#155); `0b629ce` (#250); 21 files, no docs; 3 files, no docs                                                                                                        |                                                                           |

Screenshots: `review-fixture.png` (review workspace, dark, 1440x900) and `review-fixture-footer.png` (same page after scroll, with the footer).

## Open questions and items not verified

1. `pnpm dev` without the override was not run by this lane. The 403 is proved by the code path and by `Host` header probes on the running server. The orchestrator saw the 403 directly.
2. `CLOUDFLARE_ENV=production pnpm dev` and `vite preview` were not run. The statement that they do not work locally comes from the configuration only.
3. The full unit and browser suites were not run (lane rule). Test durations, shard balance, and the effect of large files on CI time are not measured.
4. `pnpm typecheck` was not run, because `wrangler types` writes a file in the repository. Only `--listFilesOnly` was used.
5. Per-package `vitest run` behavior (default 5 s timeout, no root config) is derived from configuration lookup rules, not from a run.
6. It is not known if the baseline cutover is finished. If it is, `apps/web/tooling/baseline-reset` and `docs/baseline-delta-cutover.md` are one-time material. `docs/current-contract.md:28` still says "Existing deployments must use the baseline cutover runbook."
7. Live Cloudflare state was not read. The statements about unused compare Worker bindings and resource names are about the committed configuration.
8. The 11 tables with no runtime reference can still hold rows that an operator wants. Row counts were not read.
9. The npm registry was not queried. The statement about the published CLI README comes from the `files` field and the changelog.
10. HYG-17 depends on a policy question: the shared code-style skill says "Ariakit-managed repositories", and Visonaut is under `github.com/ariakit`, but no document in this repository adopts it.
11. The claim "30 of the last 60 commits touch `docs/`" in HYG-07 is an estimate from commit titles (titles that start with "Record", "Document", "Pin", "Version", or that name a cutover). It was not counted with `git log -- docs/`. Treat it as an assumption.
