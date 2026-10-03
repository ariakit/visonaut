import { fileURLToPath } from "node:url";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { unstable_readConfig } from "wrangler";
import { apiBindings, databaseCapacityPolicy, operationsBudget } from "./runtime.ts";

const configurationPath = fileURLToPath(new URL("../wrangler.jsonc", import.meta.url));
const previousApiLimits = {
  maximumImageBytes: 2097152,
  maximumShardBytes: 536870912,
  maximumRunBytes: 2147483648,
  maximumStagedBytes: 8589934592,
  maximumManifestBytes: 16777216,
  maximumPlanBytes: 1500000,
  maximumCaptures: 40000,
  comparisonMaxAttempts: 5,
  databaseWarningBytes: 1610612736,
  databaseAdmissionBytes: 2147483648,
  maximumActiveRuns: 5,
};
const previousOperationsBudget = {
  tasksPerStep: 25,
  objectsPerStep: 1000,
  leaseMilliseconds: 720000,
  maxAttempts: 5,
  maximumObjectBytes: 16777216,
};

let runtime: Miniflare;
let bindings: Env;

beforeAll(async () => {
  const configuration = unstable_readConfig({ config: configurationPath, env: "production" });
  runtime = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: "export default { fetch() { return new Response('configuration tests'); } };",
      compatibilityDate: "2026-09-22",
      bindings: {
        ...configuration.vars,
        BETTER_AUTH_SECRET: "configuration-test-secret",
        CAPABILITY_SECRET: "configuration-test-secret",
        GITHUB_CLIENT_SECRET: "configuration-test-secret",
        GITHUB_APP_PRIVATE_KEY: "configuration-test-secret",
        GITHUB_WEBHOOK_SECRET: "configuration-test-secret",
      },
      d1Databases: ["DB"],
      r2Buckets: ["IMAGES", "QUARANTINE"],
      queueProducers: ["COMPARISONS", "OPERATIONS"],
      serviceBindings: { COMPARATOR: async () => new Response() },
    }),
  );
  bindings = await runtime.getBindings<Env>();
});

afterAll(async () => {
  await runtime?.dispose();
});

function configurationEnv(overrides: Record<string, unknown> = {}): Env {
  const env = { ...bindings };
  Reflect.deleteProperty(env, "VISONAUT_API_LIMITS");
  Reflect.deleteProperty(env, "VISONAUT_OPERATIONS_BUDGET");
  // Raw binding inputs exercise missing and invalid values beyond generated literals.
  for (const [name, value] of Object.entries(overrides)) {
    Object.defineProperty(env, name, { value, configurable: true, enumerable: true });
  }
  return env;
}

function resolvedApiLimits(env: Env) {
  const configuration = apiBindings(env).configuration;
  return {
    ...configuration.limits,
    comparisonMaxAttempts: configuration.comparisonMaxAttempts,
    ...databaseCapacityPolicy(env),
  };
}

describe("runtime numeric configuration", () => {
  it.each(["maximumExportEntries", "maximumMetadataBytes"])(
    "rejects the retired export budget %s",
    (name) => {
      const env = configurationEnv({ VISONAUT_OPERATIONS_BUDGET: JSON.stringify({ [name]: 100 }) });
      expect(() => operationsBudget(env)).toThrow(name);
    },
  );
  it.each([undefined, "production"])(
    "preserves remaining numeric bounds in Wrangler environment %s",
    (environment) => {
      const configuration = unstable_readConfig({ config: configurationPath, env: environment });
      const env = configurationEnv({
        VISONAUT_API_LIMITS: configuration.vars.VISONAUT_API_LIMITS,
        VISONAUT_OPERATIONS_BUDGET: configuration.vars.VISONAUT_OPERATIONS_BUDGET,
      });
      expect(resolvedApiLimits(env)).toEqual(previousApiLimits);
      expect(operationsBudget(env)).toEqual(previousOperationsBudget);
    },
  );

  it.each([undefined, "{}"])("uses exact defaults for missing or empty overrides %s", (value) => {
    const env = configurationEnv({
      VISONAUT_API_LIMITS: value,
      VISONAUT_OPERATIONS_BUDGET: value,
    });
    expect(resolvedApiLimits(env)).toEqual(previousApiLimits);
    expect(operationsBudget(env)).toEqual(previousOperationsBudget);
  });

  it("merges only declared partial overrides before resolving API, capacity and budget values", () => {
    const env = configurationEnv({
      VISONAUT_API_LIMITS: JSON.stringify({ maximumCaptures: 10, maximumActiveRuns: "2" }),
      VISONAUT_OPERATIONS_BUDGET: JSON.stringify({ tasksPerStep: "10", maxAttempts: 3 }),
    });
    expect(resolvedApiLimits(env)).toEqual({
      ...previousApiLimits,
      maximumCaptures: 10,
      maximumActiveRuns: 2,
    });
    expect(operationsBudget(env)).toEqual({
      ...previousOperationsBudget,
      tasksPerStep: 10,
      maxAttempts: 3,
    });
  });

  it("preserves complete overrides for remaining fields, including decimal strings", () => {
    const apiLimits = {
      maximumImageBytes: 100,
      maximumShardBytes: 200,
      maximumRunBytes: 300,
      maximumStagedBytes: 400,
      maximumManifestBytes: 500,
      maximumPlanBytes: 600,
      maximumCaptures: 700,
      comparisonMaxAttempts: 8,
      databaseWarningBytes: 900,
      databaseAdmissionBytes: 1000,
      maximumActiveRuns: 11,
    };
    const budget = {
      tasksPerStep: 12,
      objectsPerStep: 13,
      leaseMilliseconds: 1400,
      maxAttempts: 15,
      maximumObjectBytes: 1600,
    };
    const env = configurationEnv({
      VISONAUT_API_LIMITS: JSON.stringify(
        Object.fromEntries(Object.entries(apiLimits).map(([name, value]) => [name, String(value)])),
      ),
      VISONAUT_OPERATIONS_BUDGET: JSON.stringify(
        Object.fromEntries(Object.entries(budget).map(([name, value]) => [name, String(value)])),
      ),
    });
    expect(resolvedApiLimits(env)).toEqual(apiLimits);
    expect(operationsBudget(env)).toEqual(budget);
  });

  it("keeps complete overrides for the remaining preview and production fields compatible", () => {
    const env = configurationEnv({
      VISONAUT_API_LIMITS: JSON.stringify(previousApiLimits),
      VISONAUT_OPERATIONS_BUDGET: JSON.stringify(previousOperationsBudget),
    });
    expect(resolvedApiLimits(env)).toEqual(previousApiLimits);
    expect(operationsBudget(env)).toEqual(previousOperationsBudget);
  });

  it.each(["", " ", "{", "[]", "null", "1", "true", '"limits"', null, {}, []])(
    "rejects malformed override objects %j with the binding name",
    (value) => {
      const env = configurationEnv({
        VISONAUT_API_LIMITS: value,
        VISONAUT_OPERATIONS_BUDGET: value,
      });
      expect(() => apiBindings(env)).toThrow("VISONAUT_API_LIMITS must be a JSON object.");
      expect(() => databaseCapacityPolicy(env)).toThrow(
        "VISONAUT_API_LIMITS must be a JSON object.",
      );
      expect(() => operationsBudget(env)).toThrow(
        "VISONAUT_OPERATIONS_BUDGET must be a JSON object.",
      );
    },
  );

  it.each(["unknown", "constructor", "toString", "__proto__"])(
    "rejects unknown own fields %s instead of discarding them",
    (name) => {
      const env = configurationEnv({
        VISONAUT_API_LIMITS: JSON.stringify({ ...previousApiLimits, [name]: 1 }),
        VISONAUT_OPERATIONS_BUDGET: JSON.stringify({ ...previousOperationsBudget, [name]: 1 }),
      });
      expect(() => apiBindings(env)).toThrow(
        `VISONAUT_API_LIMITS.${name} is not a supported override.`,
      );
      expect(() => operationsBudget(env)).toThrow(
        `VISONAUT_OPERATIONS_BUDGET.${name} is not a supported override.`,
      );
    },
  );

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, null, false, [], {}, "-1", "1e2", " 2", ""])(
    "rejects invalid known numeric values %j instead of using a default",
    (value) => {
      const env = configurationEnv({
        VISONAUT_API_LIMITS: JSON.stringify({ maximumCaptures: value }),
        VISONAUT_OPERATIONS_BUDGET: JSON.stringify({ leaseMilliseconds: value }),
      });
      expect(() => apiBindings(env)).toThrow(
        "VISONAUT_API_LIMITS.maximumCaptures must be a positive safe integer.",
      );
      expect(() => operationsBudget(env)).toThrow(
        "VISONAUT_OPERATIONS_BUDGET.leaseMilliseconds must be a positive safe integer.",
      );
    },
  );

  it.each(["tasksPerStep", "objectsPerStep"])("keeps the 1000-entry %s page bound", (name) => {
    const env = configurationEnv({ VISONAUT_OPERATIONS_BUDGET: JSON.stringify({ [name]: 1001 }) });
    expect(() => operationsBudget(env)).toThrow("Operations pages cannot exceed 1000 entries.");
  });

  it.each([
    { databaseWarningBytes: 2147483648 },
    { databaseAdmissionBytes: 1073741824 },
    { databaseAdmissionBytes: 10000000000 },
  ])("validates merged database capacity thresholds %j", (limits) => {
    const env = configurationEnv({ VISONAUT_API_LIMITS: JSON.stringify(limits) });
    expect(() => apiBindings(env)).toThrow("Database capacity policy is invalid.");
    expect(() => databaseCapacityPolicy(env)).toThrow("Database capacity policy is invalid.");
  });

  it("rejects an encoded-image override above the existing decoder bound", () => {
    const env = configurationEnv({
      VISONAUT_API_LIMITS: JSON.stringify({ ...previousApiLimits, maximumImageBytes: 2097153 }),
    });
    expect(() => apiBindings(env)).toThrow(
      "VISONAUT_API_LIMITS.maximumImageBytes cannot exceed 2097152.",
    );
  });

  it.each(["BETTER_AUTH_SECRET", "VISONAUT_WORKFLOW_OWNED"])(
    "keeps %s required when numeric overrides are absent",
    (name) => {
      const env = configurationEnv();
      Reflect.deleteProperty(env, name);
      expect(() => apiBindings(env)).toThrow(`${name} is not configured.`);
    },
  );
});
