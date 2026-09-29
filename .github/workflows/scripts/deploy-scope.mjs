import assert from "node:assert/strict";

assert.equal(
  process.env.INFISICAL_ENVIRONMENT,
  "prod",
  "Deployment requires the prod secret environment",
);
assert.equal(
  process.env.INFISICAL_PROJECT_ID,
  "2e3bd11a-10ca-40c1-b8a7-73d786340a4a",
  "Deployment requires the dedicated Visonaut Deploy project",
);
assert.equal(
  process.env.INFISICAL_DEPLOY_IDENTITY_ID,
  "3ca08078-9e92-4625-bdf9-51b3668b7982",
  "Deployment requires the dedicated GitHub deploy identity",
);
