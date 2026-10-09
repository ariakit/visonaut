import { createHash, createHmac } from "node:crypto";
import { mkdtemp, readFile, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CAPTURE_PAGE_MAX_BYTES,
  CAPTURE_PAGES_MODE,
  canonicalJson,
  capturePagesDigest,
  capturePageUploads,
  captureRowProfile,
  digestJson,
  parseCapturePage,
  parseCapturePageIndex,
} from "@visonaut/protocol";
import type {
  CapturePage,
  CapturePageIndex,
  CaptureProfile,
  CaptureRowImage,
  CaptureSource,
  Manifest,
  Variant,
} from "@visonaut/protocol";
import { expect, vi } from "vitest";
import { combineBundles } from "../src/bundles.js";
import { writeSubmission } from "../src/submission.js";

/** The directory of one capture job, with the manifest that the test wrote into it. */
export interface Bundle {
  directory: string;
  manifest: Manifest;
}

interface PrepareOptions {
  /** The attempt of the signed Submit job. The default is the attempt of the first bundle. */
  attempt?: number;
}

/**
 * Make the prepared directory of one Submit from capture bundles, as the workflow module does
 * after it verified the artifacts. The Submit job has the ID 789.
 */
export async function prepare(
  directories: string[],
  bundles: Bundle[],
  { attempt }: PrepareOptions = {},
) {
  // The CLI prints the real path, and the temporary folder of macOS is a symbolic link.
  const directory = await realpath(await mkdtemp(join(tmpdir(), "visonaut-prepared-test-")));
  directories.push(directory);
  const sources = await Promise.all(
    bundles.map(async ({ manifest }, index): Promise<CaptureSource> => {
      const shardKey = manifest.shard.key;
      return {
        shardKey,
        workflowAttempt: manifest.run.workflowAttempt,
        jobId: String(100 + index),
        jobName: `capture (${shardKey})`,
        manifestDigest: await storedManifestDigest(bundles[index]?.directory, manifest),
        artifactId: String(200 + index),
        artifactName: `visonaut-capture-${manifest.run.workflowRunId}-${manifest.run.workflowAttempt}-${shardKey}`,
      };
    }),
  );
  const signedAttempt = attempt ?? bundles[0]?.manifest.run.workflowAttempt ?? 1;
  const pending = await combineBundles({
    bundles: bundles.map((bundle, index) => ({
      shard: bundle.manifest.shard.key,
      directory: bundle.directory,
      source: sources[index],
    })),
    directory,
    workflowAttempt: signedAttempt,
  });
  await writeSubmission(directory, {
    ...pending,
    run: { ...pending.run, workflowAttempt: signedAttempt },
    job: { id: "789", attempt: signedAttempt },
  });
  return directory;
}

/**
 * The Submit job takes the digest of the manifest file when it verifies the artifact. A file
 * that is no JSON text gets the digest of the object of the test, and Submit then refuses it.
 */
async function storedManifestDigest(directory: string | undefined, manifest: Manifest) {
  try {
    return await digestJson(
      JSON.parse(await readFile(join(directory ?? "", "manifest.json"), "utf8")),
    );
  } catch {
    return digestJson(manifest);
  }
}

/**
 * The state of the mocked workflow module of a test file. `submitShard` sets the bundles, and the
 * mock prepares them when the CLI calls the workflow, as the Submit job does after it verified
 * the artifacts. So a bundle that Submit must refuse fails inside the command.
 */
export interface Prepared {
  server: string;
  bundles: Bundle[];
  /** The prepared directory of the last run. */
  directory: string;
  /** Each prepared directory, so that the test file can remove it. */
  directories: string[];
  /** The attempt of the signed Submit job. The default is the attempt of the first bundle. */
  attempt?: number;
}

export function preparedState(server: string): Prepared {
  return { server, bundles: [], directory: "", directories: [] };
}

/** The replacement of `../src/workflow.js` in a test file that starts at verified bundles. */
export function workflowMock(prepared: Prepared) {
  return {
    runWorkflowCommand: async () => {
      prepared.directory = await prepare(prepared.directories, prepared.bundles, {
        attempt: prepared.attempt,
      });
      return { command: "submit", directory: prepared.directory, server: prepared.server };
    },
  };
}

export function json(value: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

export function sha256Hex(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

export interface ServiceRequest {
  url: URL;
  options: RequestInit | undefined;
}

export interface PageServiceOptions {
  runId?: string;
  /** The pages of the accepted reference, in order. The default is a project with no reference. */
  reference?: CapturePage[];
  /** The bytes of the reference images, by digest. */
  referenceImages?: Map<string, Uint8Array>;
  /** Images that the service has from another run. With `reuse`, a proof stages them. */
  stored?: Map<string, Uint8Array>;
  reuse?: boolean;
  /** The lifetime of the reuse challenge of each page answer. The default is 10 minutes. */
  reuseLifetimeMs?: number;
  /** The identity of the reference in the answer of each reserve call, by the number of the call. */
  referenceDigest?: (reserveCall: number) => string;
  /**
   * The lifetime of the capability of each reserve call, by the number of the call. The default
   * is 10 minutes, so that a slow computer does not reach the renewal in a test that counts
   * requests.
   */
  lifetimeMs?: (reserveCall: number) => number;
  /** Change the JSON answer of a request before the stub sends it. */
  change?: (url: URL, response: Record<string, unknown>, options?: RequestInit) => unknown;
  /** Answer a request in place of the stub. `undefined` lets the stub answer. */
  respond?: (
    url: URL,
    options: RequestInit | undefined,
  ) => Response | undefined | Promise<Response | undefined>;
  /** More headers for the JSON answer of a request, from its URL and its body text. */
  headers?: (url: URL, body: string) => Record<string, string>;
  /** Pad each upload ticket to this length. The limit of the protocol is 4,096 characters. */
  ticketLength?: number;
  requestToken?: string;
  oidcToken?: string;
}

export interface ReferenceEntry {
  itemKey: string;
  variant: Variant;
  profile: CaptureProfile;
  image: CaptureRowImage;
}

/** One reference page with the given captures. The caller gives them in the order of the format. */
export function referencePage(entries: ReferenceEntry[]): CapturePage {
  const page: CapturePage = {
    schemaVersion: "1.0",
    variants: [],
    profiles: [],
    tests: [{ id: "accepted/test", file: "accepted.test.ts", titlePath: ["accepted"], retry: 0 }],
    comparisons: [{ threshold: 0.2 }],
    rows: [],
  };
  const position = <T>(list: T[], entry: T) => {
    const known = list.findIndex((item) => canonicalJson(item) === canonicalJson(entry));
    return known === -1 ? list.push(entry) - 1 : known;
  };
  for (const { itemKey, variant, profile, image } of entries) {
    const split = captureRowProfile(profile);
    page.rows.push([
      itemKey,
      null,
      position(page.variants, variant),
      0,
      position(page.profiles, split.profile),
      split.clip,
      0,
      image.digest,
      image.bytes,
      image.width,
      image.height,
      // The CLI ignores the result of a reference row.
      1,
    ]);
  }
  return page;
}

export const REFERENCE_DIGEST = "9".repeat(64);
export const REUSE_NONCE = "ab".repeat(32);

/**
 * A stub of the service for the page requests. It holds what the CLI sent, checks each body with
 * the validators of the protocol package, and refuses a request that the protocol does not have.
 */
export function pageService({
  runId = "run-123",
  reference = [],
  referenceImages = new Map(),
  stored = new Map(),
  reuse = false,
  reuseLifetimeMs = 600_000,
  referenceDigest = () => REFERENCE_DIGEST,
  lifetimeMs = () => 600_000,
  change,
  respond,
  headers,
  ticketLength = 0,
  requestToken = "github-request-secret",
  oidcToken = "oidc-secret",
}: PageServiceOptions = {}) {
  const requests: ServiceRequest[] = [];
  const pages = new Map<string, CapturePage>();
  const uploads = new Map<string, Uint8Array>();
  const reserveBodies: Record<string, unknown>[] = [];
  const capabilities: string[] = [];
  let index: CapturePageIndex | undefined;
  const bearer = (options: RequestInit | undefined) =>
    new Headers(options?.headers).get("Authorization")?.replace("Bearer ", "");
  const capabilityRequest = (options: RequestInit | undefined) => {
    expect.soft(bearer(options)).toBe(capabilities.at(-1));
  };
  const answer = async (url: URL, options: RequestInit | undefined): Promise<Response> => {
    const custom = await respond?.(url, options);
    if (custom) return custom;
    const path = url.pathname;
    const send = async (response: Record<string, unknown>) => {
      const body = JSON.stringify(change ? await change(url, response, options) : response);
      return new Response(body, {
        headers: { "Content-Type": "application/json", ...headers?.(url, body) },
      });
    };
    if (url.hostname.endsWith(".actions.githubusercontent.com")) {
      expect.soft(bearer(options)).toBe(requestToken);
      return send({ value: oidcToken });
    }
    if (path === "/v1/runs") {
      expect.soft(bearer(options)).toBe(oidcToken);
      const body: Record<string, unknown> = JSON.parse(String(options?.body));
      expect.soft(body).toMatchObject({ comparisonMode: CAPTURE_PAGES_MODE, shardKey: "combined" });
      reserveBodies.push(body);
      const capability =
        capabilities.length === 0
          ? "capability-secret"
          : `capability-secret-${capabilities.length}`;
      capabilities.push(capability);
      return send({
        schemaVersion: "1.0",
        runId,
        capability,
        expiresAt: new Date(Date.now() + lifetimeMs(capabilities.length)).toISOString(),
        comparisonMode: CAPTURE_PAGES_MODE,
        reference: reference.length
          ? {
              snapshotId: "accepted",
              baselineRevision: 3,
              digest: referenceDigest(capabilities.length),
              pages: reference.length,
            }
          : { snapshotId: null, baselineRevision: 0, digest: null, pages: 0 },
      });
    }
    const referencePage = new RegExp(
      `^/v1/runs/${runId}/reference/${REFERENCE_DIGEST}/pages/(\\d+)$`,
    ).exec(path);
    if (referencePage && (options?.method ?? "GET") === "GET") {
      capabilityRequest(options);
      const page = reference[Number(referencePage[1]) - 1];
      if (!page) return json({ schemaVersion: "1.0", error: { code: "not_found" } }, 404);
      return send({ ...page });
    }
    const referenceImage = new RegExp(`^/v1/runs/${runId}/reference/images/([a-f0-9]{64})$`).exec(
      path,
    );
    if (referenceImage && (options?.method ?? "GET") === "GET") {
      capabilityRequest(options);
      const bytes = referenceImages.get(referenceImage[1] ?? "");
      if (!bytes) return json({ schemaVersion: "1.0", error: { code: "not_found" } }, 404);
      return new Response(Buffer.from(bytes), { headers: { "Content-Type": "image/png" } });
    }
    if (path === `/v1/runs/${runId}/pages` && options?.method === "POST") {
      capabilityRequest(options);
      const body = options.body;
      if (!(body instanceof Uint8Array)) throw new Error("A page body must be bytes.");
      expect.soft(body.byteLength).toBeLessThanOrEqual(CAPTURE_PAGE_MAX_BYTES);
      const page = parseCapturePage(JSON.parse(Buffer.from(body).toString("utf8")));
      const pageDigest = await digestJson(page);
      // The CLI sends the canonical bytes, so the digest of the body is the page digest.
      expect.soft(sha256Hex(body)).toBe(pageDigest);
      pages.set(pageDigest, page);
      const missing = [...capturePageUploads(page).values()].filter(
        (image) => !uploads.has(image.digest),
      );
      return send({
        schemaVersion: "1.0",
        pageDigest,
        uploads: missing.map((image) => ({
          imageDigest: image.digest,
          ticket: `ticket-${image.digest}.`.padEnd(ticketLength, "x"),
          maxBytes: image.bytes,
        })),
        ...(reuse
          ? {
              reuse: {
                nonce: REUSE_NONCE,
                token: "challenge-token",
                expiresAt: new Date(Date.now() + reuseLifetimeMs).toISOString(),
              },
            }
          : {}),
      });
    }
    if (path === `/v1/runs/${runId}/reuse` && options?.method === "POST") {
      capabilityRequest(options);
      const body: {
        pageDigest: string;
        challenge: string;
        proofs: { imageDigest: string; proof: string }[];
      } = JSON.parse(String(options.body));
      expect.soft(pages.has(body.pageDigest)).toBe(true);
      expect.soft(body.challenge).toBe("challenge-token");
      const reused: string[] = [];
      for (const { imageDigest, proof } of body.proofs) {
        const bytes = stored.get(imageDigest);
        if (!bytes) continue;
        const expected = createHmac("sha256", Buffer.from(REUSE_NONCE, "hex"))
          .update(bytes)
          .digest("hex");
        if (proof !== expected) continue;
        uploads.set(imageDigest, bytes);
        reused.push(imageDigest);
      }
      return send({ schemaVersion: "1.0", reused });
    }
    const ticket = /^\/v1\/uploads\/ticket-([a-f0-9]{64})\.x*$/.exec(path);
    if (ticket && options?.method === "PUT") {
      capabilityRequest(options);
      const body = options.body;
      if (!(body instanceof Uint8Array)) throw new Error("An image body must be bytes.");
      expect.soft(new Headers(options.headers).get("Content-Type")).toBe("image/png");
      expect.soft(sha256Hex(body)).toBe(ticket[1]);
      uploads.set(ticket[1] ?? "", Uint8Array.from(body));
      return new Response(null, { status: 204 });
    }
    if (path === `/v1/runs/${runId}/index` && options?.method === "POST") {
      capabilityRequest(options);
      index = parseCapturePageIndex(JSON.parse(String(options.body)), {
        maximumPages: 1000,
        maximumSources: 1000,
      });
      for (const entry of index.pages) {
        expect.soft(pages.has(entry.digest)).toBe(true);
      }
      return send({
        schemaVersion: "1.0",
        runId,
        state: "staged",
        manifestDigest: await capturePagesDigest(index),
      });
    }
    if (/^\/v1\/runs\/\d+\/submit$/.test(path) && options?.method === "POST") {
      expect.soft(bearer(options)).toBe(oidcToken);
      return send({ schemaVersion: "1.0", runId, state: "submitted", submittedAt: 1790200000000 });
    }
    throw new Error(`Unexpected request: ${options?.method ?? "GET"} ${path}`);
  };
  const fetch = vi.fn(async (input: string | URL | Request, options?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input);
    requests.push({ url, options });
    return answer(url, options);
  });
  vi.stubGlobal("fetch", fetch);
  return {
    fetch,
    requests,
    reserveBodies,
    uploads,
    /** The pages that the CLI sent, in the order of the index when it exists. */
    pages: () =>
      index
        ? index.pages.flatMap(({ digest }) => {
            const page = pages.get(digest);
            return page ? [page] : [];
          })
        : [...pages.values()],
    index: () => index,
    paths: () => requests.map(({ url }) => url.pathname),
  };
}
