# Ariviso

Visual regression capture, comparison, and review for Ariakit.

Ariviso captures prepared Playwright pages, compares the original images in a Cloudflare Worker, and lets maintainers review changes in a private web app. GitHub checks report the result for the tested commit. Uploading a capture does not approve it.

[Issue #1](https://github.com/ariakit/ariviso/issues/1) defines the product and launch requirements. Package publication, production deployment, and Ariakit's required-check cutover use the [release and deployment workflow](.github/workflows/README.md). A passing local test suite alone does not establish launch readiness.

## Review a run

Open the review link from the GitHub check and sign in with GitHub. Access requires current write permission to the configured repository. Check the commit and attempt, select an item and variant, then inspect its images before you approve or reject it.

The dashboard also shows unresolved service alerts. It refreshes them while open; no external notifications are sent.

Use the [review guide](docs/review-guide.md) for image modes, keyboard controls, whole-item commands, Undo, and recovery from a failed save.

## Capture and upload

The Playwright adapter captures one prepared variant per call. The caller controls navigation, media settings, viewport, and variant order. Item and variant keys define identity.

```ts
import { visual } from "@ariviso/playwright";

await visual(page, {
  item: "dialog/success/open",
  name: "Success dialog",
  variant: { key: "react-chromium-light", browser: "chromium" },
});
```

Configure the reporter and trusted capture workflow before uploading. The [adapter guide](packages/playwright/README.md) explains capture profiles, stability, retries, and the reporter. The [CLI guide](packages/cli/README.md) explains GitHub Actions OIDC and upload status.

```sh
pnpm exec ariviso upload --manifest .ariviso/manifest.json
pnpm exec ariviso finalize --manifest .ariviso/manifest.json
```

The service verifies the complete capture plan and job results. It compares validated PNG and lossless WebP originals. Human decisions bind to the exact comparison and revision. A full main run promotes a baseline only when all acceptance conditions pass.

## Work on the repository

Use Node.js 24.18.0 and pnpm 12.5.1. Google Chrome is required for the review browser tests.

```sh
pnpm install --frozen-lockfile
pnpm check
```

For a focused check, run `pnpm test` or `pnpm test:browser`. The browser suite starts an isolated review fixture with controlled data. It does not require a GitHub session or a deployed Worker.

`pnpm dev` starts the web app. Complete the local Cloudflare bindings and authentication configuration before using its live API. Local, preview, and production must use separate data and credentials. See the [security configuration](packages/security/README.md), [Worker configuration](apps/web/wrangler.jsonc), and [deployment guide](.github/workflows/README.md).

| Path                  | Purpose                                                    |
| --------------------- | ---------------------------------------------------------- |
| `apps/web`            | TanStack Start app, private API, review UI, and operations |
| `apps/compare`        | Independent image comparison Worker                        |
| `packages/playwright` | Public Playwright adapter and reporter                     |
| `packages/cli`        | Public `ariviso` upload, finalize, and status commands     |
| `packages/protocol`   | Capture and service contracts                              |
| `packages/service`    | Run, review, acceptance, and baseline transitions          |
| `packages/security`   | Authentication, authorization, OIDC, and GitHub checks     |

## Reference

- [Review guide](docs/review-guide.md)
- [Operations and recovery](apps/web/src/operations/README.md)
- [CI, deployment, and publication](.github/workflows/README.md)
- [Review evidence capture plan](docs/review-evidence-plan.md)
- [Revision 9 design](docs/design-r9.html), [decision data](docs/design-r9.json), and [design verification](docs/design-verification.md)

The design archive records the selected product behavior. Its prototype checks are separate from implementation and deployment evidence. The copied Ariakit UI components retain their [MIT license](apps/web/src/components/ariakit/LICENSE) and [source notice](apps/web/src/components/ariakit/NOTICE).
