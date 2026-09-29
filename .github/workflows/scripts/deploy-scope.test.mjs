import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";

const project = "2e3bd11a-10ca-40c1-b8a7-73d786340a4a";
const environment = {
  ...process.env,
  INFISICAL_PROJECT_ID: project,
  INFISICAL_ENVIRONMENT: "prod",
  INFISICAL_DEPLOY_IDENTITY_ID: "3ca08078-9e92-4625-bdf9-51b3668b7982",
};

test("flat credential loading stays closed without the exact reviewed scope", () => {
  assert.doesNotThrow(() =>
    execFileSync(process.execPath, [".github/workflows/scripts/deploy-scope.mjs"], {
      env: environment,
      stdio: "pipe",
    }),
  );
  for (const field of [
    "INFISICAL_PROJECT_ID",
    "INFISICAL_ENVIRONMENT",
    "INFISICAL_DEPLOY_IDENTITY_ID",
  ]) {
    assert.throws(() =>
      execFileSync(process.execPath, [".github/workflows/scripts/deploy-scope.mjs"], {
        env: { ...environment, [field]: "" },
        stdio: "pipe",
      }),
    );
    assert.throws(() =>
      execFileSync(process.execPath, [".github/workflows/scripts/deploy-scope.mjs"], {
        env: { ...environment, [field]: "another-project-or-identity" },
        stdio: "pipe",
      }),
    );
  }
});
