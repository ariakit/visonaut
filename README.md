# Visonaut

Visual regression capture, comparison, and review for Ariakit.

Visonaut captures prepared Playwright pages, compares the original images in a Cloudflare Worker, and lets maintainers review changes in a private web app. GitHub checks report the result for the tested commit. Uploading a capture does not approve it.

After this documentation handoff merges to main, the [current implementation contract](docs/current-contract.md) defines the current requirements and explicit supersessions. Until then, [issue #1](https://github.com/ariakit/visonaut/issues/1) remains the published authority. The repository contract preserves every unaffected issue requirement. After the handoff, the issue, design, and audit remain historical records.

Use the [release and deployment guide](.github/workflows/README.md) for execution and the [cutover guide](docs/operations/simplification-cutover.md) for production readiness verification and the remaining cleanup. A passing local test suite alone does not establish launch readiness.

## Review a run

Open the review link from the GitHub check and sign in with GitHub. Access requires current write permission to the configured repository. Check the commit and attempt, select an item and variant, then inspect its images before you approve or reject it.

Preview uses isolated fixture runs without GitHub login or production data. It does not certify deployed authentication.

The dashboard also shows unresolved service alerts. It refreshes them while open; no external notifications are sent.

Use the [review guide](docs/review-guide.md) for image modes, keyboard controls, whole-item commands, Undo, and recovery from a failed save.

## Capture and submit

The Playwright adapter captures one prepared variant per call. The caller controls navigation, media settings, viewport, and variant order. Item and variant keys define identity.

```ts
import { visual } from "@visonaut/playwright";

await visual(page, {
  item: "dialog/success/open",
  name: "Success dialog",
  variant: { key: "react-chromium-light", browser: "chromium" },
});
```

Ariakit configures its reporter explicitly and uploads ordinary one-day capture artifacts. The selected integration pins native CI and the small App workflow. Native `Plan` runs `visonaut submit --no-visual` only after successful `Plan CI` computes `app=false`. For `app=true`, `App / Visual Capture (linux)` and `App / Visual Capture (safari)` feed `App / Visual Submit`; trusted Submit verifies successful native Plan and the complete capture set. The [adapter guide](packages/playwright/README.md) explains capture profiles, stability, and retries. The [CLI guide](packages/cli/README.md) explains submission. CLI `visonaut@0.5.3` is published and verified; adapter `@visonaut/playwright@0.4.0` remains unchanged. The earlier CLI `0.5.2` run has successful captures, Submit, the recovered App check and Gate, and a verified normal export. The CLI `0.5.3` consumer update is published, and its normal Plan, captures, Submit, App check, and Gate passed. PR #7703 received eligible approval and merged as [`394aec5`](https://github.com/ariakit/ariakit/commit/394aec5cb6debc18dd88d28268b9c4bad9d4726c), which completes main adoption. Normal signed no-visual proof on PR #7552 and activation of the required App check are also complete. The service caller-pin deployment is verified, and matching consumer polling removal is adopted through PR #7708. Final readiness-marker deployment and exact transfer-key retirement remain pending; see the [implementation checkpoint](docs/simplification-implementation.md#current-handoff-checkpoint).

```sh
# In the trusted signed Submit job, after every capture job succeeds:
pnpm exec visonaut submit --shard linux --shard safari
```

The service verifies both workflow Git blobs, the exact tested commit and attempt, and the complete source-attempt capture set. The visual path has no separate signed Plan report. The Visonaut check from App `5028451` is required beside Gate. Gate polling is removed, and the service trusts the matching caller pin. Native Gate still verifies the other selected CI jobs. The service accepts validated PNG and lossless WebP originals; local Submit requires PNG captures and references. Human decisions bind to the exact comparison and revision. A full main run promotes a baseline only when all acceptance conditions pass.

## Work on the repository

Use Node.js 24.18.0 and pnpm 12.5.1. Google Chrome is required for the review browser tests.

```sh
pnpm install --frozen-lockfile
pnpm check
```

Use the [development and verification guide](docs/development.md) for command scopes and the on-demand built-app check. For a focused check, run `pnpm test` or `pnpm test:browser`. The browser suite starts an isolated review fixture with controlled data. It does not require a GitHub session or a deployed Worker.

`pnpm dev` starts the web app. Complete the local Cloudflare bindings and authentication configuration before using its live API. Local, preview, and production must use separate data and credentials. See the [security configuration](packages/security/README.md), [Worker configuration](apps/web/wrangler.jsonc), and [deployment guide](.github/workflows/README.md).

| Path                  | Purpose                                                    |
| --------------------- | ---------------------------------------------------------- |
| `apps/web`            | TanStack Start app, private API, review UI, and operations |
| `apps/compare`        | Independent image comparison Worker                        |
| `packages/playwright` | Public Playwright adapter and reporter                     |
| `packages/cli`        | Public `visonaut` upload, submit, and status commands      |
| `packages/protocol`   | Capture and service contracts                              |
| `packages/service`    | Run, review, acceptance, and baseline transitions          |
| `packages/security`   | Authentication, authorization, OIDC, and GitHub checks     |

## Reference

- [Current implementation contract](docs/current-contract.md)
- [Development and verification](docs/development.md)
- [Implementation record](docs/simplification-implementation.md)
- [Review guide](docs/review-guide.md)
- [Operations and recovery](apps/web/src/operations/README.md)
- [CI, deployment, and publication](.github/workflows/README.md)
- [Review evidence capture plan](docs/review-evidence-plan.md)
- [Revision 9 design](docs/design-r9.html), [decision data](docs/design-r9.json), and [design verification](docs/design-verification.md)

The revision 9 design is a historical record. The current contract preserves its 61 decisions and states each selected supersession. Prototype checks remain separate from implementation and deployment evidence. The copied Ariakit UI components retain their [MIT license](apps/web/src/components/ariakit/LICENSE) and [source notice](apps/web/src/components/ariakit/NOTICE).
