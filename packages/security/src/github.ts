import { importPKCS8, SignJWT } from "jose";
import { numericId, record, SecurityError, textField } from "./errors.js";
import { readBoundedBody } from "./http.js";

export interface GitHubAppConfiguration {
  appId: string;
  privateKey: string;
  installationId: string;
  repositoryId: string;
  repository: string;
  fetch?: typeof fetch;
}

export interface GitHubClient {
  appId: string;
  request(path: string, init?: RequestInit): Promise<unknown>;
  repository: string;
  repositoryId: string;
}

export class GitHubUnavailableError extends SecurityError {
  constructor(public readonly upstreamStatus?: number) {
    super("github_unavailable", 503, "GitHub verification is temporarily unavailable.");
  }
}

export async function createAppJwt(
  appId: string,
  privateKey: string,
  now = Date.now(),
): Promise<string> {
  const key = await importPKCS8(privateKey, "RS256");
  const seconds = Math.floor(now / 1000);
  return new SignJWT({})
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer(appId)
    .setIssuedAt(seconds - 60)
    .setExpirationTime(seconds + 9 * 60)
    .sign(key);
}

interface GitHubRequestParams {
  path: string;
  token: string;
  init?: RequestInit;
  fetcher: typeof fetch;
}

async function githubRequest({
  path,
  token,
  init,
  fetcher,
}: GitHubRequestParams): Promise<unknown> {
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) {
    throw new Error("GitHub API requests need an absolute API path.");
  }
  const url = new URL(path, "https://api.github.com");
  if (url.origin !== "https://api.github.com") {
    throw new Error("Unexpected GitHub API host.");
  }
  const headers = new Headers(init?.headers);
  headers.set("Accept", "application/vnd.github+json");
  headers.set("Authorization", `Bearer ${token}`);
  // OIDC, lineage, and webhook checks require the supported PR merge_commit_sha contract.
  headers.set("X-GitHub-Api-Version", "2022-11-28");
  headers.set("User-Agent", "Visonaut");
  if (init?.body) {
    headers.set("Content-Type", "application/json");
  }
  try {
    const response = await fetcher(url, {
      ...init,
      headers,
      redirect: "manual",
      signal: init?.signal ?? AbortSignal.timeout(15_000),
    });
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      throw new GitHubUnavailableError(response.status);
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new GitHubUnavailableError(response.status);
    }
    if (response.status === 204) return null;
    const body = await readBoundedBody(response, 4 * 1024 * 1024);
    return JSON.parse(new TextDecoder().decode(body));
  } catch (error) {
    if (error instanceof GitHubUnavailableError) throw error;
    throw new GitHubUnavailableError();
  }
}

/** Installation tokens are request scoped and never share user OAuth storage. */
export async function createGitHubClient(
  configuration: GitHubAppConfiguration,
): Promise<GitHubClient> {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(configuration.repository)) {
    throw new Error("Invalid configured repository.");
  }
  const repositoryId = numericId(configuration.repositoryId);
  const fetcher = configuration.fetch ?? fetch;
  let installationToken: Promise<string> | undefined;
  async function authorize() {
    const token = await createAppJwt(configuration.appId, configuration.privateKey);
    const result = record(
      await githubRequest({
        path: `/app/installations/${numericId(configuration.installationId)}/access_tokens`,
        token,
        fetcher,
        init: { method: "POST", body: JSON.stringify({ repository_ids: [Number(repositoryId)] }) },
      }),
    );
    const expires = Date.parse(textField(result.expires_at));
    if (!Number.isFinite(expires) || expires <= Date.now()) {
      throw new GitHubUnavailableError();
    }
    return textField(result.token);
  }
  return {
    appId: configuration.appId,
    repository: configuration.repository,
    repositoryId,
    async request(path, init) {
      // Reject anonymous sessions before obtaining a GitHub installation token.
      installationToken ??= authorize();
      return githubRequest({ path, init, token: await installationToken, fetcher });
    },
  };
}

export interface MaintainerIdentity {
  githubUserId: string;
  login: string;
  role: string;
}

/** Resolve by numeric ID first so a renamed/reused login cannot gain access. */
export async function requireRepositoryWrite(
  client: GitHubClient,
  githubUserId: string,
): Promise<MaintainerIdentity> {
  const id = numericId(githubUserId);
  const user = record(await client.request(`/user/${id}`));
  const login = textField(user.login);
  if (numericId(user.id) !== id) {
    throw new GitHubUnavailableError();
  }
  const result = record(
    await client.request(
      `/repos/${client.repository}/collaborators/${encodeURIComponent(login)}/permission`,
    ),
  );
  const verifiedUser = record(result.user);
  if (numericId(verifiedUser.id) !== id) {
    throw new GitHubUnavailableError();
  }
  // GitHub maps maintain to write; custom role names do not define base access.
  // https://docs.github.com/en/rest/collaborators/collaborators#get-repository-permissions-for-a-user
  if (result.permission !== "write" && result.permission !== "admin") {
    throw new SecurityError("not_maintainer", 403, "Repository write permission is required.");
  }
  return { githubUserId: id, login, role: textField(result.role_name) };
}
