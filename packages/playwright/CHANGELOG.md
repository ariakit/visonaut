# @visonaut/playwright

## 0.2.0

### Minor Changes

- eeecb07: Workflow-owned visual capture

  **BREAKING** if you use the package's trusted-plan CI helpers. The immutable GitHub workflow now owns the capture matrix and complete test selection. The package adds `visonaut-capture` to render the actual environment; a separate signed upload job stages each shard.

  Before, the pinned executor verified its trusted plan through the package's CI helpers:

  ```js
  import { verifyTrustedPlan } from "@visonaut/playwright/ci";

  await verifyTrustedPlan({ directory: trustedExecutor, planFile: trustedPlan });
  ```

  After:

  ```sh
  visonaut-capture render --repository-root "$GITHUB_WORKSPACE" --test-dir app/src \
    --test-patterns '["/test[^/]*-browser"]' --project chrome --browser chromium \
    --device "Desktop Chrome" --base-url http://localhost:4321 --shard chrome-1 \
    --font-package @fontsource-variable/inter \
    --comparison-policy-digest "$POLICY_SHA" --bundle-sha256 "$PACKAGE_SHA" \
    --output "$RUNNER_TEMP/chrome-1.enc"
  ```

  Pass the same font package and policy digest to the signed `upload` command.

### Patch Changes

- 4a82767: Encrypted visual bundles with the transfer key of the selected Visonaut server so preview, production, and diagnostics can keep separate private keys.
- e43de8e: Accepted GitHub's runner OIDC request endpoint during signed visual uploads.
