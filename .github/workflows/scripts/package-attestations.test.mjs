import assert from "node:assert/strict";
import { test } from "node:test";
import { assertReleaseProvenance, withVerifiedPackages } from "./package-attestations.mjs";

const sourceSha = "a".repeat(40);
const digest = Buffer.alloc(64, 3);
const record = {
  name: "visonaut",
  version: "0.4.0",
  integrity: `sha512-${digest.toString("base64")}`,
};
function fixture() {
  const statement = {
    _type: "https://in-toto.io/Statement/v1",
    predicateType: "https://slsa.dev/provenance/v1",
    subject: [{ name: "pkg:npm/visonaut@0.4.0", digest: { sha512: digest.toString("hex") } }],
    predicate: {
      buildDefinition: {
        buildType: "https://slsa-framework.github.io/github-actions-buildtypes/workflow/v1",
        externalParameters: {
          workflow: {
            repository: "https://github.com/ariakit/visonaut",
            path: ".github/workflows/release.yml",
            ref: "refs/heads/main",
          },
        },
        internalParameters: {
          github: { repository_id: "1380751023", event_name: "workflow_dispatch" },
        },
        resolvedDependencies: [
          {
            uri: "git+https://github.com/ariakit/visonaut@refs/heads/main",
            digest: { gitCommit: sourceSha },
          },
        ],
      },
      runDetails: {
        builder: { id: "https://github.com/actions/runner/github-hosted" },
        metadata: {
          invocationId: "https://github.com/ariakit/visonaut/actions/runs/100/attempts/2",
        },
      },
    },
  };
  const bundle = { dsseEnvelope: { payloadType: "application/vnd.in-toto+json", payload: "" } };
  const audit = {
    invalid: [],
    missing: [],
    verified: [
      {
        name: record.name,
        version: record.version,
        registry: "https://registry.npmjs.org/",
        attestationBundles: [{ predicateType: statement.predicateType, bundle }],
      },
    ],
  };
  const verified = [];
  return {
    statement,
    bundle,
    audit,
    verified,
    execute: async ({ expectedSourceSha = sourceSha, verifyBundle } = {}) => {
      bundle.dsseEnvelope.payload = Buffer.from(JSON.stringify(statement)).toString("base64");
      return assertReleaseProvenance({
        records: [record],
        audit,
        expectedSourceSha,
        verifyBundle:
          verifyBundle ??
          (async (...args) => {
            verified.push(args);
          }),
      });
    },
  };
}

test("verified provenance binds the exact registry package, checked source and signer policy", async () => {
  const example = fixture();
  assert.deepEqual(await example.execute(), [{ ...record, sourceSha }]);
  assert.deepEqual(example.verified, [
    [
      example.bundle,
      {
        certificateIssuer: "https://token.actions.githubusercontent.com",
        certificateIdentityURI:
          "^https://github\\.com/ariakit/visonaut/\\.github/workflows/release\\.yml@refs/heads/main$",
        certificateOIDs: { "1.3.6.1.4.1.57264.1.3": sourceSha },
      },
    ],
  ]);
});

test("automatic main release provenance retains checked source and certificate verification", async () => {
  const example = fixture();
  example.statement.predicate.buildDefinition.internalParameters.github.event_name = "push";
  assert.deepEqual(await example.execute(), [{ ...record, sourceSha }]);
  assert.equal(example.verified.length, 1);
  example.statement.predicate.buildDefinition.resolvedDependencies[0].digest.gitCommit = "b".repeat(
    40,
  );
  await assert.rejects(example.execute(), /another source commit/);
});

test("unapproved publication events fail before the signer verifier runs", async () => {
  for (const event of [
    "pull_request",
    "pull_request_target",
    "workflow_call",
    "workflow_run",
    "schedule",
  ]) {
    const example = fixture();
    example.statement.predicate.buildDefinition.internalParameters.github.event_name = event;
    await assert.rejects(example.execute());
    assert.deepEqual(example.verified, []);
  }
});

test("older verified source can be inspected but cannot satisfy this commit's publication", async () => {
  const example = fixture();
  const older = "b".repeat(40);
  example.statement.predicate.buildDefinition.resolvedDependencies[0].digest.gitCommit = older;
  example.bundle.dsseEnvelope.payload = Buffer.from(JSON.stringify(example.statement)).toString(
    "base64",
  );
  assert.deepEqual(
    await assertReleaseProvenance({
      records: [record],
      audit: example.audit,
      verifyBundle: async () => {},
    }),
    [{ ...record, sourceSha: older }],
  );
  await assert.rejects(example.execute(), /another source commit/);
});

test("source claims cannot replace the supported certificate issuer and SAN verification", async () => {
  const example = fixture();
  await assert.rejects(
    example.execute({
      verifyBundle: async () => {
        throw new Error("Sigstore certificate identity policy rejected this signer");
      },
    }),
    /certificate identity policy rejected/,
  );
});

test("source, build workflow and package subject mismatches fail before acceptance", async () => {
  const mutations = [
    (s) => {
      s.subject[0].name = "pkg:npm/other@0.4.0";
    },
    (s) => {
      s.subject[0].digest.sha512 = "b".repeat(128);
    },
    (s) => {
      s.subject.push(s.subject[0]);
    },
    (s) => {
      s.predicate.buildDefinition.externalParameters.workflow.repository =
        "https://github.com/other/visonaut";
    },
    (s) => {
      s.predicate.buildDefinition.externalParameters.workflow.path = ".github/workflows/other.yml";
    },
    (s) => {
      s.predicate.buildDefinition.externalParameters.workflow.ref = "refs/heads/untrusted";
    },
    (s) => {
      s.predicate.buildDefinition.internalParameters.github.repository_id = "1";
    },
    (s) => {
      s.predicate.buildDefinition.internalParameters.github.event_name = "pull_request";
    },
    (s) => {
      s.predicate.buildDefinition.resolvedDependencies[0].uri =
        "git+https://github.com/other/visonaut@refs/heads/main";
    },
    (s) => {
      s.predicate.buildDefinition.resolvedDependencies[0].digest.gitCommit = "short";
    },
    (s) => {
      s.predicate.buildDefinition.resolvedDependencies.push(
        s.predicate.buildDefinition.resolvedDependencies[0],
      );
    },
    (s) => {
      s.predicate.runDetails.builder.id = "https://github.com/actions/runner/self-hosted";
    },
    (s) => {
      s.predicate.runDetails.metadata.invocationId =
        "https://github.com/other/visonaut/actions/runs/100/attempts/1";
    },
  ];
  for (const mutate of mutations) {
    const example = fixture();
    mutate(example.statement);
    await assert.rejects(example.execute());
    assert.deepEqual(example.verified, []);
  }
});

test("unverified, missing, duplicated and wrong-registry attestation output stays closed", async () => {
  const mutations = [
    (a) => {
      a.invalid.push({ name: "visonaut" });
    },
    (a) => {
      a.missing.push({ name: "visonaut" });
    },
    (a) => {
      delete a.verified;
    },
    (a) => {
      a.verified = [];
    },
    (a) => {
      a.verified.push(a.verified[0]);
    },
    (a) => {
      a.verified[0].registry = "https://other.example/";
    },
    (a) => {
      a.verified[0].attestationBundles = [];
    },
    (a) => {
      a.verified[0].attestationBundles.push(a.verified[0].attestationBundles[0]);
    },
  ];
  for (const mutate of mutations) {
    const example = fixture();
    mutate(example.audit);
    await assert.rejects(example.execute());
    assert.deepEqual(example.verified, []);
  }
});

test("scoped package PURL is checked against the exact independently published package", async () => {
  const example = fixture();
  const scoped = { ...record, name: "@visonaut/playwright" };
  example.statement.subject[0].name = "pkg:npm/%40visonaut/playwright@0.4.0";
  example.audit.verified[0].name = scoped.name;
  example.bundle.dsseEnvelope.payload = Buffer.from(JSON.stringify(example.statement)).toString(
    "base64",
  );
  assert.deepEqual(
    await assertReleaseProvenance({
      records: [scoped],
      audit: example.audit,
      verifyBundle: async () => {},
    }),
    [{ ...scoped, sourceSha }],
  );
});

test("empty eligible plan performs no registry installation or signature subprocess", async () => {
  assert.deepEqual(await withVerifiedPackages([], async (records) => records), []);
  await assert.rejects(
    withVerifiedPackages([{ ...record, name: "other" }], async () => {}),
    /Unknown release package/,
  );
});
