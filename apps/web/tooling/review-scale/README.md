# Current review performance checks

This directory contains the existing synthetic review probe and two on-demand checks against the actual built application. Neither is a permanent browser CI project. Use the same local build and data fixture for the [manual built-app check](../../../../docs/development.md#built-app-check).

## Synthetic probe

The fixture uses the current `ReviewWorkspace`, global styles, selected variant, and image readiness state. It requires the selected item row to mount and the Ariakit UI Shell to have `display: grid`. Visible row counts come from the current renderer. Navigation must change the real selected variant and reach image readiness before its timeout.

```sh
pnpm --filter @visonaut/web exec vite build --config tooling/review-scale/vite.config.mjs
pnpm exec node apps/web/tooling/review-scale/server.mjs
```

In another terminal:

```sh
pnpm exec node --input-type=module -e '
import { chromium } from "@playwright/test";
import { run } from "./apps/web/tooling/review-scale/run.mjs";
await run(chromium);
'
```

`COUNTS`, `SAMPLES`, `WARMUPS`, `REVIEW_SCALE_PORT`, and `REVIEW_SCALE_OUTPUT` select the workload and ignored output directory. The default captures are 3,582, 10,580, and 35,820. Retain raw samples, excluded warmups, source hashes, browser environment, model bytes, and errors. A two-frame callback is a paint opportunity proxy, not a physical display timestamp. Synthetic data excludes real authorization, D1, R2, and review saves. The [historical measurements](../../../../docs/evidence/review-scale/README.md) remain unchanged.

## Built-route checks

Build the real Worker and run the isolated local harness. It loads the built modules and client assets in Miniflare, applies the current production migration files to ephemeral native D1, seeds a three-variant pending PR through the existing service with known identity history, stores image fixtures in native R2, and creates a valid signed Better Auth local session. These reintroduced variants require human review. Each has a distinct synthetic profile identity so a save leaves another variant pending. The local GitHub responder permits only installation-token and maintainer-permission reads; every other outbound request fails. There are no product API response mocks, remote credentials, persistent data, preview mutations, or added browser CI projects.

```sh
pnpm --filter @visonaut/web build
SAMPLES=3 pnpm exec node apps/web/tooling/review-scale/local-routes.mjs
```

The harness uses `VISONAUT_ENVIRONMENT=local`, the production authentication and mutation handlers, and a localhost origin. It uses the normal real approval and Undo requests. After the run, it requires every stored human approval to be revoked by Undo, writes `local-fixture.json` with safe GitHub request paths and scope, disposes Miniflare, and removes the private temporary session file. The Worker is warm after fixture readiness checks; “cold” and “warm” describe browser contexts and asset caches. Capture, comparison execution, production GitHub/networking, and Queue processing are outside this probe. `REVIEW_ROUTE_PORT` selects the localhost port (default 4183).

For an existing isolated writable local PR, serve its built Worker separately. The fixture must have at least two pending variants and support Undo. Preview fixtures are read-only and cannot prove a save. The runner does not mock the service and stops when a save does not commit.

Select that isolated run and collect raw samples:

```sh
REVIEW_ROUTE_ORIGIN=http://127.0.0.1:3000 \
REVIEW_ROUTE_RUN_PATH=/runs/your-local-run-id \
SAMPLES=3 \
pnpm exec node --input-type=module -e '
import { chromium } from "@playwright/test";
import { runRoutes } from "./apps/web/tooling/review-scale/run-routes.mjs";
await runRoutes(chromium);
'
```

If the local fixture requires a session, use `REVIEW_ROUTE_STORAGE_STATE` with its private local browser state file. Do not commit that file. The runner accepts localhost only. `REVIEW_ROUTE_OUTPUT` selects an ignored output directory; the default is `artifacts/review-routes`.

Each sample records direct route open to first decoded image, then Approve to next decoded image, followed by Undo to reset the PR fixture. A new browser context supplies the cold sample; the same context supplies the warm sample. The second profile uses four times CPU throttling, 150 ms latency, 200,000 bytes/s download, and 100,000 bytes/s upload. Both profiles record resource timing spans and actual `encodedBodySize`, `decodedBodySize`, and `transferSize`. Cached resources can have zero transfer bytes.

Keep source commit, working diff hash, build file hashes and byte sizes, environment, route, cache state, raw samples, errors, and nearest-rank summaries. Report this as local built-Worker timing. It does not establish production latency, Core Web Vitals, a supported workload limit, or a performance budget. Do not compare results from different fixtures or hardware as a product speed change.
