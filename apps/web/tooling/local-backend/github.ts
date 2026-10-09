export type GitHubCheckRuns = Map<string, Record<string, unknown>>;

export interface GitHubStubParams {
  appId: string;
  installationId: string;
  repository: string;
  maintainer: { id: number; login: string };
  /**
   * The check runs by ID. The database of the app keeps these IDs, so the
   * local runner gives the stub the check runs of the earlier starts.
   */
  checks?: GitHubCheckRuns;
  /** Runs after the stub adds or changes a check run. */
  onCheckChange?: (checks: GitHubCheckRuns) => void;
}

async function jsonObject(request: Request): Promise<Record<string, unknown>> {
  const body: unknown = await request.json();
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("The request body must be a JSON object.");
  }
  return { ...body };
}

/**
 * Answer the GitHub requests of the local backend. The stub knows the
 * installation token, the maintainer, the permission of the maintainer, and
 * the check runs that the service makes. Each other request gets status 404.
 */
export function createGitHubStub({
  appId,
  installationId,
  repository,
  maintainer,
  checks = new Map(),
  onCheckChange,
}: GitHubStubParams) {
  const repositoryPath = `/repos/${repository}`;
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const path = url.pathname;
    const route = `${request.method} ${path}`;
    if (url.hostname !== "api.github.com") {
      console.warn(`The local backend refused a request to ${url.hostname}.`);
      return Response.json({ message: "The local backend has no network." }, { status: 502 });
    }
    if (route === `POST /app/installations/${installationId}/access_tokens`) {
      return Response.json({
        token: "local-installation-token",
        expires_at: new Date(Date.now() + 3_600_000).toISOString(),
      });
    }
    if (route === `GET /user/${maintainer.id}`) {
      return Response.json(maintainer);
    }
    if (route === `GET ${repositoryPath}/collaborators/${maintainer.login}/permission`) {
      return Response.json({
        user: { id: maintainer.id },
        permission: "write",
        role_name: "write",
      });
    }
    if (route === `POST ${repositoryPath}/check-runs`) {
      const id = checks.size + 1;
      const check = { ...(await jsonObject(request)), id, app: { id: Number(appId) } };
      checks.set(String(id), check);
      onCheckChange?.(checks);
      return Response.json(check, { status: 201 });
    }
    const commits = `${repositoryPath}/commits/`;
    if (request.method === "GET" && path.startsWith(commits) && path.endsWith("/check-runs")) {
      const sha = path.slice(commits.length, -"/check-runs".length);
      const name = url.searchParams.get("check_name");
      const found = [...checks.values()].filter(
        (check) => check.head_sha === sha && (!name || check.name === name),
      );
      return Response.json({ total_count: found.length, check_runs: found });
    }
    const check = path.startsWith(`${repositoryPath}/check-runs/`)
      ? checks.get(path.slice(`${repositoryPath}/check-runs/`.length))
      : undefined;
    if (check && request.method === "GET") {
      return Response.json(check);
    }
    if (check && request.method === "PATCH") {
      Object.assign(check, await jsonObject(request));
      onCheckChange?.(checks);
      return Response.json(check);
    }
    console.warn(`The local GitHub stub has no answer for ${route}.`);
    return Response.json({ message: "The local GitHub stub has no answer." }, { status: 404 });
  };
}
