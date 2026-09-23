import type { Database } from "../../../../packages/service/src/database.ts";
import { RepairError, repairLegacyCheckLeases } from "./repair.ts";

interface Env {
  DB: Database;
  REPAIR_AUTH_TOKEN?: string;
  REPAIR_CLOUDFLARE_API_TOKEN?: string;
}

const accountId = "b04f3af3f0f10a6b9481bc23ba974eca";
const workerName = "visonaut-diagnostics";
const repository = "ariakit/visonaut-diagnostics";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export async function activeWorkerVersion(token: string) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${workerName}/deployments`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    redirect: "error",
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) {
    throw new RepairError("deployment_unavailable");
  }
  const envelope: unknown = await response.json();
  if (
    !isRecord(envelope) ||
    envelope.success !== true ||
    !isRecord(envelope.result) ||
    !Array.isArray(envelope.result.deployments)
  ) {
    throw new RepairError("deployment_unavailable");
  }
  const deployments = envelope.result.deployments.filter(isRecord);
  const latest = deployments.sort((left, right) =>
    String(right.created_on).localeCompare(String(left.created_on)),
  )[0];
  if (!latest || !Array.isArray(latest.versions) || latest.versions.length !== 1) {
    throw new RepairError("deployment_not_exclusive");
  }
  const version = latest.versions[0];
  if (!isRecord(version) || version.percentage !== 100 || typeof version.version_id !== "string") {
    throw new RepairError("deployment_not_exclusive");
  }
  return version.version_id;
}

async function readGitHubCheck(id: string) {
  const response = await fetch(`https://api.github.com/repos/${repository}/check-runs/${id}`, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "Visonaut-one-time-check-repair",
    },
    redirect: "error",
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) {
    throw new RepairError("github_check_unavailable");
  }
  return response.json();
}

export default {
  async fetch(request: Request, env: Env) {
    if (request.method !== "POST" || new URL(request.url).pathname !== "/repair") {
      return new Response(null, { status: 404 });
    }
    const authToken = env.REPAIR_AUTH_TOKEN;
    const cloudflareToken = env.REPAIR_CLOUDFLARE_API_TOKEN;
    if (!authToken || authToken.length < 32 || !cloudflareToken) {
      return Response.json({ error: "repair_credentials_unavailable" }, { status: 503 });
    }
    if (request.headers.get("Authorization") !== `Bearer ${authToken}`) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }
    const body: unknown = await request.json().catch(() => null);
    if (!isRecord(body) || (body.mode !== "inspect" && body.mode !== "settle")) {
      return Response.json({ error: "invalid_request" }, { status: 400 });
    }
    if (typeof body.expectedWorkerVersion !== "string") {
      return Response.json({ error: "fixed_worker_version_required" }, { status: 400 });
    }
    try {
      const result = await repairLegacyCheckLeases({
        database: env.DB,
        expectedWorkerVersion: body.expectedWorkerVersion,
        activeWorkerVersion: () => activeWorkerVersion(cloudflareToken),
        readGitHubCheck,
        now: Date.now,
        mode: body.mode,
      });
      return Response.json(result);
    } catch (error) {
      const code = error instanceof RepairError ? error.code : "repair_failed";
      return Response.json({ error: code }, { status: 409 });
    }
  },
};
