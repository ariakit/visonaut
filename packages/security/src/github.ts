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
  /** Exact App configuration identity for private permission caching. */
  authorizationKey?: string;
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

interface InstallationToken {
  token: string;
  expiresAt: number;
}

const installationTokens = new WeakMap<typeof fetch, Map<string, InstallationToken>>();
const maximumInstallationTokens = 128;
const tokenExpirySkew = 30_000;

/** Reuse resolved token bytes; pending I/O stays within the request's client. */
export async function createGitHubClient(
  configuration: GitHubAppConfiguration,
): Promise<GitHubClient> {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(configuration.repository)) {
    throw new Error("Invalid configured repository.");
  }
  const repositoryId = numericId(configuration.repositoryId);
  const installationId = numericId(configuration.installationId);
  const fetcher = configuration.fetch ?? fetch;
  const keyDigest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(configuration.privateKey),
  );
  const authorizationKey = JSON.stringify([
    configuration.appId,
    installationId,
    repositoryId,
    configuration.repository,
    Array.from(new Uint8Array(keyDigest), (byte) => byte.toString(16).padStart(2, "0")).join(""),
  ]);
  let tokens = installationTokens.get(fetcher);
  if (!tokens) {
    tokens = new Map();
    installationTokens.set(fetcher, tokens);
  }
  const tokenCache = tokens;
  let pendingToken: Promise<InstallationToken> | undefined;
  const authorize = async () => {
    const token = await createAppJwt(configuration.appId, configuration.privateKey);
    const result = record(
      await githubRequest({
        path: `/app/installations/${installationId}/access_tokens`,
        token,
        fetcher,
        init: { method: "POST", body: JSON.stringify({ repository_ids: [Number(repositoryId)] }) },
      }),
    );
    const expiresAt = Date.parse(textField(result.expires_at));
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now() + tokenExpirySkew) {
      throw new GitHubUnavailableError();
    }
    const resolved = { token: textField(result.token), expiresAt };
    tokenCache.delete(authorizationKey);
    if (tokenCache.size >= maximumInstallationTokens) {
      const oldest = tokenCache.keys().next().value;
      if (oldest !== undefined) {
        tokenCache.delete(oldest);
      }
    }
    tokenCache.set(authorizationKey, resolved);
    return resolved;
  };
  return {
    appId: configuration.appId,
    repository: configuration.repository,
    repositoryId,
    authorizationKey,
    async request(path, init) {
      // No token is minted until a verified session needs GitHub access.
      let resolved = tokenCache.get(authorizationKey);
      if (!resolved || resolved.expiresAt <= Date.now() + tokenExpirySkew) {
        tokenCache.delete(authorizationKey);
        pendingToken ??= authorize().finally(() => {
          pendingToken = undefined;
        });
        resolved = await pendingToken;
      }
      try {
        return await githubRequest({ path, init, token: resolved.token, fetcher });
      } catch (error) {
        if (error instanceof GitHubUnavailableError && error.upstreamStatus === 401) {
          // Do not retry a mutation; the next request can mint a new token.
          tokenCache.delete(authorizationKey);
        }
        throw error;
      }
    },
  };
}

export interface MaintainerIdentity {
  githubUserId: string;
  login: string;
  role: string;
}

const loginHints = new Map<string, string>();
const maximumLoginHints = 128;

function rememberLogin(key: string, login: string) {
  loginHints.delete(key);
  if (loginHints.size >= maximumLoginHints) {
    const oldest = loginHints.keys().next().value;
    if (oldest !== undefined) {
      loginHints.delete(oldest);
    }
  }
  loginHints.set(key, login);
}

/** A login is only a routing hint; each request checks current permission and numeric identity. */
export async function requireRepositoryWrite(
  client: GitHubClient,
  githubUserId: string,
): Promise<MaintainerIdentity> {
  const id = numericId(githubUserId);
  const key = JSON.stringify([client.appId, client.repositoryId, client.repository, id]);
  const checkPermission = async (login: string) => {
    const result = record(
      await client.request(
        `/repos/${client.repository}/collaborators/${encodeURIComponent(login)}/permission`,
      ),
    );
    const verifiedUser = record(result.user);
    if (numericId(verifiedUser.id) !== id) {
      return null;
    }
    // GitHub confirmed that this login has the numeric ID. Keep the login also
    // when the permission is refused: the next check then starts from it.
    rememberLogin(key, login);
    // GitHub maps maintain to write; custom role names do not define base access.
    // https://docs.github.com/en/rest/collaborators/collaborators#get-repository-permissions-for-a-user
    if (result.permission !== "write" && result.permission !== "admin") {
      throw new SecurityError("not_maintainer", 403, "Repository write permission is required.");
    }
    return { githubUserId: id, login, role: textField(result.role_name) };
  };
  const hint = loginHints.get(key);
  if (hint) {
    try {
      const identity = await checkPermission(hint);
      if (identity) {
        return identity;
      }
    } catch (error) {
      const upstreamStatus = error instanceof GitHubUnavailableError ? error.upstreamStatus : null;
      if (
        upstreamStatus !== 404 &&
        !(upstreamStatus && upstreamStatus >= 300 && upstreamStatus < 400)
      ) {
        throw error;
      }
    }
    // A renamed or reused login must be resolved again by its numeric ID.
    loginHints.delete(key);
  }
  const user = record(await client.request(`/user/${id}`));
  const login = textField(user.login);
  if (numericId(user.id) !== id) {
    throw new GitHubUnavailableError();
  }
  const identity = await checkPermission(login);
  if (!identity) {
    throw new GitHubUnavailableError();
  }
  return identity;
}
