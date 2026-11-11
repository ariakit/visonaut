export interface GitHubStubParams {
  appId: string;
  installationId: string;
  repository: string;
  maintainer: { id: number; login: string };
  /** The user ID of the App bot, which creates each commit status. */
  statusCreatorId?: number;
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
 * installation token, the maintainer, the permission of the maintainer, the
 * commit statuses that the service makes, and its pull request comments. Each
 * other request gets status 404.
 */
export function createGitHubStub({
  appId,
  installationId,
  repository,
  maintainer,
  statusCreatorId = 1,
}: GitHubStubParams) {
  const repositoryPath = `/repos/${repository}`;
  // The comments live only in memory. After a restart, the service reads a
  // stored comment as deleted, and it sends no comment to that pull request.
  const comments = new Map<number, Record<string, unknown>>();
  const issues = `${repositoryPath}/issues/`;
  // The statuses live only in memory, newest first. A status that the service
  // sends again after a restart shows as the newest one.
  const statuses: Record<string, unknown>[] = [];
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
    const statusSha = path.startsWith(`${repositoryPath}/statuses/`)
      ? /^[a-f0-9]{40}$/.exec(path.slice(`${repositoryPath}/statuses/`.length))
      : null;
    if (request.method === "POST" && statusSha) {
      const status = {
        ...(await jsonObject(request)),
        id: statuses.length + 1,
        sha: statusSha[0],
        creator: { id: statusCreatorId },
      };
      statuses.unshift(status);
      return Response.json(status, { status: 201 });
    }
    const commits = `${repositoryPath}/commits/`;
    if (request.method === "GET" && path.startsWith(commits) && path.endsWith("/statuses")) {
      const sha = path.slice(commits.length, -"/statuses".length);
      const page = Number(url.searchParams.get("page") ?? "1");
      const perPage = Number(url.searchParams.get("per_page") ?? "30");
      const found = statuses.filter((status) => status.sha === sha);
      return Response.json(found.slice((page - 1) * perPage, page * perPage));
    }
    const issueComments = /^(\d+)\/comments$/.exec(path.slice(issues.length));
    if (path.startsWith(issues) && issueComments) {
      const issue = Number(issueComments[1]);
      if (request.method === "GET") {
        return Response.json([...comments.values()].filter((comment) => comment.issue === issue));
      }
      if (request.method === "POST") {
        const id = comments.size + 1;
        const body = (await jsonObject(request)).body;
        const comment = { id, issue, body, performed_via_github_app: { id: Number(appId) } };
        comments.set(id, comment);
        console.info(`The local GitHub stub created comment ${id} on #${issue}.`);
        return Response.json(comment, { status: 201 });
      }
    }
    const comment = path.startsWith(`${issues}comments/`)
      ? comments.get(Number(path.slice(`${issues}comments/`.length)))
      : undefined;
    if (comment && request.method === "PATCH") {
      comment.body = (await jsonObject(request)).body;
      console.info(`The local GitHub stub edited comment ${String(comment.id)}.`);
      return Response.json(comment);
    }
    console.warn(`The local GitHub stub has no answer for ${route}.`);
    return Response.json({ message: "The local GitHub stub has no answer." }, { status: 404 });
  };
}
