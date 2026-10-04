# Visonaut

Visual regression capture, comparison, and review for Ariakit.

Visonaut captures prepared Playwright pages. Trusted CLI Submit verifies the capture evidence and compares PNG images in CI. The service validates the signed receipt and lets maintainers review changes in a private web app. The GitHub App check reports the result. Uploading a capture does not approve it. The comparison Worker still validates uploaded images and processes supported legacy comparisons.

The [current implementation contract](docs/current-contract.md) is the current guide. It owns the requirements, exact supersession map, source behavior, selected targets, and evidence limits. [PR #205](https://github.com/ariakit/visonaut/pull/205) completed the authority handoff on 2026-10-02. The [pinned issue #1 notice](https://github.com/ariakit/visonaut/issues/1#issuecomment-5958332349) preserves the earlier issue. Every unaffected requirement remains binding. The guide also records the selected changes from [issue #204](https://github.com/ariakit/visonaut/issues/204).

Use the [release and deployment guide](.github/workflows/README.md) for execution and the [cutover guide](docs/operations/simplification-cutover.md) for dated completion receipts and removal gates. A passing local test suite does not prove live state.

## Review a run

Open the review link from the GitHub check and sign in with GitHub. Access requires current write permission to the configured repository. Check the commit and attempt, select an item and variant, then inspect its images before you approve or reject it.

Validated image URLs need no session. Anyone with a URL can view and copy those pixels. Run metadata, labels, decisions, export files, and quarantine remain private. The public route serves only validated image records, not arbitrary bucket paths. Preview uses isolated fixture runs without GitHub login or production data. It does not certify deployed authentication.

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

Ariakit configures its reporter explicitly and uploads ordinary one-day capture artifacts. Native `Plan` runs `visonaut submit --no-visual` only after successful `Plan CI` computes `app=false`. For `app=true`, `App / Visual Capture (linux)` and `App / Visual Capture (safari)` feed `App / Visual Submit`. Trusted Submit verifies successful native Plan and the complete capture set. The [adapter guide](packages/playwright/README.md) explains capture profiles, comparison settings, stability, and retries. The [CLI guide](packages/cli/README.md) explains submission. The current package pair is `visonaut@0.5.3` and `@visonaut/playwright@0.4.0`, with Playwright `1.63.0`. The [implementation checkpoint](docs/simplification-implementation.md#current-handoff-checkpoint) records publication, consumer adoption, required checks, and deployment. PR #205 completed the readiness marker and authority handoff; #207 records completed transfer-key cleanup. These dated receipts do not prove the later #204 removal gates.

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

Use the [development and verification guide](docs/development.md) for command scopes and the on-demand built-app check. For a focused check, run `pnpm test` or `pnpm test:browser`. The browser suite starts its own review fixture with controlled data and fails if the selected port is busy. Set `VISONAUT_TEST_PORT=4392 pnpm test:browser` to use a separate port for another checkout. The default port is `4179`. The fixture needs no GitHub session or deployed Worker.

`pnpm dev` starts the public fixture demo. Preview uses synthetic review data and inline SVG images without backend bindings or credentials. Local tests create separate ephemeral storage when they need the live API. `pnpm --filter @visonaut/web db:local` applies the production schema to local D1 only. See the [security configuration](packages/security/README.md), [Worker configuration](apps/web/wrangler.jsonc), and [deployment guide](.github/workflows/README.md).

| Path                  | Purpose                                                    |
| --------------------- | ---------------------------------------------------------- |
| `apps/web`            | TanStack Start app, private API, review UI, and operations |
| `apps/compare`        | Image validation and legacy comparison Worker              |
| `packages/playwright` | Public Playwright adapter and reporter                     |
| `packages/cli`        | Public `visonaut` begin, submit, and status commands       |
| `packages/protocol`   | Capture and service contracts                              |
| `packages/compare`    | Image validation, codecs, and legacy comparison engine     |
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

D10 and D17 keep the copied UI components, current packages, and TanStack Start framework. The CLI remains independent of the Playwright peer runtime. The revision 9 design is a historical record. The current contract preserves its 61 decisions and states each selected supersession. Prototype checks remain separate from implementation and deployment evidence. The copied Ariakit UI components retain their [MIT license](apps/web/src/components/ariakit/LICENSE) and [source notice](apps/web/src/components/ariakit/NOTICE).
