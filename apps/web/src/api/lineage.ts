import { type GitHubClient, SecurityError, type VerifiedRun } from "@visonaut/security";
import { digestJson } from "@visonaut/protocol";
import {
  assertion,
  atomic,
  materializeLineageStatements,
  statement,
  type RunRow,
} from "@visonaut/service";
import type { ApiContext } from "./context.js";
import { integer, object, string } from "./input.js";

type LineageTarget = Pick<
  VerifiedRun,
  | "repository"
  | "repositoryId"
  | "testedSha"
  | "event"
  | "ref"
  | "sourceHead"
  | "targetHead"
  | "pullRequestNumber"
  | "mergeGroup"
>;
interface FrozenTarget {
  mergeGroupMembers: MergeGroupMember[];
}

export interface LineageSource {
  id: string;
  kind: string;
  tested_sha: string;
  lineage_key: string;
  verified_json: string;
}
export interface MergeGroupMember {
  number: number;
  sourceHead: string;
  queueHead: string;
  queueBase: string;
}
export interface LineageProof {
  version: 1;
  startedAt: number;
  testedSha: string;
  relations: Array<{
    sourceRunId: string;
    reason:
      | "same-pr"
      | "ancestor"
      | "merged-pr"
      | "queue-member"
      | "merged-queue"
      | "verified-ancestor-lineage";
    commit?: string;
    pullRequestNumber?: number;
  }>;
  mergeGroupMembers: MergeGroupMember[];
}

function sha(value: unknown) {
  const result = string(value, 40);
  if (!/^[a-f0-9]{40}$/.test(result))
    throw new SecurityError("invalid_lineage", 503, "GitHub commit metadata is unavailable.");
  return result;
}

const queueQuery = `query VisonautQueue($owner: String!, $name: String!, $after: String) {
  repository(owner: $owner, name: $name) {
    databaseId
    mergeQueue(branch: "main") {
      entries(first: 100, after: $after) {
        nodes {
          baseCommit { oid }
          headCommit { oid }
          pullRequest {
            number state headRefOid baseRefName
            baseRepository { databaseId }
            headRepository { databaseId }
          }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
}`;

/** Only GitHub's queue membership and immutable commits establish these edges. */
export async function verifyLineage(
  github: GitHubClient,
  target: LineageTarget,
  sources: LineageSource[],
  frozen?: FrozenTarget,
) {
  const proof: LineageProof = {
    version: 1,
    startedAt: Date.now(),
    testedSha: target.testedSha,
    relations: [],
    mergeGroupMembers: frozen?.mergeGroupMembers ?? [],
  };
  const runIds = new Set<string>();
  const ancestorCache = new Map<string, Promise<boolean>>();
  const pullCache = new Map<number, Promise<Record<string, unknown>>>();
  let requests = 0;
  const request = (path: string, init?: RequestInit) => {
    requests += 1;
    if (requests > 200)
      throw new SecurityError(
        "lineage_limit",
        503,
        "Trusted lineage verification exceeded its request limit.",
      );
    return github.request(path, init);
  };
  const ancestor = (before: string, after: string) => {
    sha(before);
    sha(after);
    if (before === after) return Promise.resolve(true);
    const key = `${before}:${after}`;
    let result = ancestorCache.get(key);
    if (!result) {
      result = request(`/repos/${github.repository}/compare/${before}...${after}?per_page=1`).then(
        (value) => {
          const comparison = object(value);
          return comparison.status === "ahead" || comparison.status === "identical";
        },
      );
      ancestorCache.set(key, result);
    }
    return result;
  };
  const pull = (number: number) => {
    let result = pullCache.get(number);
    if (!result) {
      result = request(`/repos/${github.repository}/pulls/${number}`).then(object);
      pullCache.set(number, result);
    }
    return result;
  };
  const targetsMain = (value: Record<string, unknown>) => {
    const base = object(value.base);
    return base.ref === "main" && String(object(base.repo).id) === github.repositoryId;
  };
  const isMergedAncestor = async (value: Record<string, unknown>, targetSha: string) => {
    if (
      !targetsMain(value) ||
      value.merged !== true ||
      value.state !== "closed" ||
      typeof value.merged_at !== "string"
    )
      return false;
    // GitHub defines this as the resulting base commit for merge, squash, and rebase.
    // https://docs.github.com/en/rest/pulls/pulls#get-a-pull-request
    return ancestor(sha(value.merge_commit_sha), targetSha);
  };
  const add = (
    source: LineageSource,
    relation: Omit<LineageProof["relations"][number], "sourceRunId">,
  ) => {
    if (runIds.has(source.id)) return;
    runIds.add(source.id);
    proof.relations.push({ sourceRunId: source.id, ...relation });
  };

  if (target.event === "pull_request" && !frozen) {
    const current = await pull(integer(target.pullRequestNumber, 1));
    if (
      !targetsMain(current) ||
      current.state !== "open" ||
      current.merge_commit_sha !== target.testedSha ||
      object(current.head).sha !== target.sourceHead ||
      object(current.base).sha !== target.targetHead
    ) {
      throw new SecurityError(
        "stale_pull_request",
        409,
        "The pull request head or target changed during verification.",
      );
    }
  }
  if (target.event === "merge_group" && !frozen) {
    if (!target.mergeGroup || target.mergeGroup.headSha !== target.testedSha)
      throw new SecurityError(
        "invalid_merge_group",
        403,
        "Verified merge-group provenance is required.",
      );
    const [owner, name] = github.repository.split("/");
    const entries: Record<string, unknown>[] = [];
    let after: string | null = null;
    for (let page = 0; page < 20; page += 1) {
      const response = object(
        await request("/graphql", {
          method: "POST",
          body: JSON.stringify({ query: queueQuery, variables: { owner, name, after } }),
        }),
      );
      if (response.errors)
        throw new SecurityError(
          "queue_unavailable",
          503,
          "GitHub merge-queue verification is unavailable.",
        );
      const repository = object(object(response.data).repository);
      if (String(repository.databaseId) !== github.repositoryId || !repository.mergeQueue)
        throw new SecurityError(
          "queue_unavailable",
          503,
          "The verified repository merge queue is unavailable.",
        );
      const connection = object(object(repository.mergeQueue).entries);
      if (!Array.isArray(connection.nodes))
        throw new SecurityError(
          "queue_unavailable",
          503,
          "GitHub merge-queue entries are unavailable.",
        );
      entries.push(...connection.nodes.map(object));
      const pageInfo = object(connection.pageInfo);
      if (pageInfo.hasNextPage === false) break;
      after = string(pageInfo.endCursor);
      if (page === 19)
        throw new SecurityError(
          "queue_limit",
          503,
          "The merge queue exceeds the verification limit.",
        );
    }
    const exact = entries.filter(
      (entry) => entry.headCommit && object(entry.headCommit).oid === target.testedSha,
    );
    if (exact.length !== 1)
      throw new SecurityError(
        "queue_changed",
        409,
        "The tested merge group no longer has one exact queue entry.",
      );
    if (
      !(await ancestor(target.mergeGroup.baseSha, target.testedSha)) ||
      target.mergeGroup.baseSha === target.testedSha
    )
      throw new SecurityError(
        "queue_changed",
        409,
        "The merge-group base is not an ancestor of its tested commit.",
      );
    const seen = new Set<number>();
    for (const entry of entries) {
      if (!entry.headCommit || !entry.baseCommit || !entry.pullRequest) continue;
      const queueHead = sha(object(entry.headCommit).oid);
      // The signed group base can itself be the preceding unmerged queue
      // entry. Include every live queue ancestor, including that predecessor.
      if (!(await ancestor(queueHead, target.testedSha))) continue;
      const queueBase = sha(object(entry.baseCommit).oid);
      if (!(await ancestor(queueBase, queueHead)))
        throw new SecurityError(
          "queue_changed",
          409,
          "A merge-queue entry has inconsistent ancestry.",
        );
      const member = object(entry.pullRequest);
      const number = integer(member.number, 1);
      const sourceHead = sha(member.headRefOid);
      const current = await pull(number);
      if (
        seen.has(number) ||
        member.state !== "OPEN" ||
        member.baseRefName !== "main" ||
        String(object(member.baseRepository).databaseId) !== github.repositoryId ||
        String(object(member.headRepository).databaseId) !== github.repositoryId ||
        !targetsMain(current) ||
        current.state !== "open" ||
        object(current.head).sha !== sourceHead ||
        String(object(object(current.head).repo).id) !== github.repositoryId
      ) {
        throw new SecurityError(
          "queue_changed",
          409,
          "A queued pull request changed during verification.",
        );
      }
      seen.add(number);
      proof.mergeGroupMembers.push({ number, sourceHead, queueHead, queueBase });
    }
    if (!proof.mergeGroupMembers.some((member) => member.queueHead === target.testedSha))
      throw new SecurityError(
        "queue_changed",
        409,
        "The tested merge-group membership is unavailable.",
      );
    const currentRef = object(
      await request(`/repos/${github.repository}/git/ref/${target.ref.slice("refs/".length)}`),
    );
    if (object(currentRef.object).sha !== target.testedSha)
      throw new SecurityError(
        "queue_changed",
        409,
        "The tested merge-group ref changed during verification.",
      );
  }

  const associatedWithMain = new Set<number>();
  if (target.event === "push" || target.event === "workflow_dispatch") {
    for (let page = 1; page <= 20; page += 1) {
      const associated = await request(
        `/repos/${github.repository}/commits/${target.testedSha}/pulls?per_page=100&page=${page}`,
      );
      if (!Array.isArray(associated))
        throw new SecurityError(
          "invalid_lineage",
          503,
          "GitHub commit pull-request associations are unavailable.",
        );
      for (const value of associated) associatedWithMain.add(integer(object(value).number, 1));
      if (associated.length < 100) break;
      if (page === 20)
        throw new SecurityError(
          "lineage_limit",
          503,
          "GitHub commit associations exceed the verification bound.",
        );
    }
  }

  for (const source of sources) {
    const verified = object(JSON.parse(source.verified_json));
    if (
      verified.repositoryId !== github.repositoryId ||
      verified.repository !== github.repository ||
      verified.testedSha !== source.tested_sha
    )
      continue;
    if (source.kind === "main") {
      if (
        (verified.event === "push" || verified.event === "workflow_dispatch") &&
        verified.ref === "refs/heads/main" &&
        verified.sourceHead === source.tested_sha &&
        (await ancestor(source.tested_sha, target.testedSha))
      )
        add(source, { reason: "ancestor", commit: source.tested_sha });
      continue;
    }
    if (source.kind === "pull_request" && verified.event === "pull_request") {
      const number = integer(verified.pullRequestNumber, 1);
      if (source.lineage_key !== `pr:${number}` || verified.ref !== `refs/pull/${number}/merge`)
        continue;
      if (target.event === "pull_request" && target.pullRequestNumber === number) {
        add(source, { reason: "same-pr", pullRequestNumber: number });
        continue;
      }
      if (proof.mergeGroupMembers.some((member) => member.number === number)) {
        add(source, { reason: "queue-member", pullRequestNumber: number });
        continue;
      }
      const merged = await pull(number);
      if (associatedWithMain.has(number) && merged.merged !== true)
        throw new SecurityError(
          "pending_merge_metadata",
          503,
          "GitHub has not finished recording this main merge. Retry verification.",
        );
      const targetBase =
        target.event === "push" || target.event === "workflow_dispatch"
          ? target.testedSha
          : target.targetHead;
      if (await isMergedAncestor(merged, targetBase))
        add(source, {
          reason: "merged-pr",
          pullRequestNumber: number,
          commit: sha(merged.merge_commit_sha),
        });
      continue;
    }
    if (
      source.kind !== "merge_group" ||
      verified.event !== "merge_group" ||
      source.lineage_key !== `merge:${source.tested_sha}`
    )
      continue;
    const sourceGroup =
      verified.mergeGroup && typeof verified.mergeGroup === "object"
        ? object(verified.mergeGroup)
        : null;
    if (
      !sourceGroup ||
      sourceGroup.repositoryId !== github.repositoryId ||
      sourceGroup.headSha !== source.tested_sha ||
      sourceGroup.baseRef !== "refs/heads/main" ||
      sourceGroup.headRef !== verified.ref
    )
      continue;
    if (await ancestor(source.tested_sha, target.testedSha)) {
      add(source, { reason: "ancestor", commit: source.tested_sha });
      continue;
    }
    if (target.event !== "push" && target.event !== "workflow_dispatch") continue;
    // Queue commits can be rewritten by the selected merge strategy. In that
    // case every captured member must have the same head and a merged base
    // commit in this tested main history; queue membership alone is insufficient.
    const storedProof =
      verified.lineageProof && typeof verified.lineageProof === "object"
        ? object(verified.lineageProof)
        : null;
    const members =
      storedProof?.version === 1 &&
      storedProof.testedSha === source.tested_sha &&
      Array.isArray(storedProof.mergeGroupMembers)
        ? storedProof.mergeGroupMembers.map(object)
        : [];
    if (!members.length || !members.some((member) => member.queueHead === source.tested_sha))
      continue;
    if (!(await ancestor(sha(sourceGroup.baseSha), target.testedSha))) continue;
    let allMerged = true;
    for (const member of members) {
      const merged = await pull(integer(member.number, 1));
      if (
        object(merged.head).sha !== member.sourceHead ||
        !(await isMergedAncestor(merged, target.testedSha))
      ) {
        allMerged = false;
        break;
      }
    }
    if (allMerged) add(source, { reason: "merged-queue", commit: source.tested_sha });
  }
  return { runIds: [...runIds], proof };
}

interface LineageAnchor {
  id: string;
  tested_sha: string;
  verified_at: number;
}

async function lineageAnchor(context: ApiContext, github: GitHubClient, targetBase: string) {
  const candidates = await context.database
    .prepare(
      "SELECT r.id, s.tested_sha, COALESCE(json_extract(p.verified_json, '$.lineageProof.startedAt'), 0) AS verified_at FROM visonaut_snapshots s JOIN visonaut_runs r ON r.id = s.run_id JOIN ingest_run_provenance p ON p.run_id = r.id JOIN visonaut_projects project ON project.id = s.project_id WHERE s.project_id = ? AND s.reference_eligible = 1 ORDER BY (s.id = project.snapshot_id) DESC, s.created_at DESC LIMIT 100",
    )
    .bind(context.configuration.projectId)
    .all<LineageAnchor>();
  for (const candidate of candidates.results) {
    if (candidate.tested_sha === targetBase) return candidate;
    const comparison = object(
      await github.request(
        `/repos/${github.repository}/compare/${candidate.tested_sha}...${targetBase}?per_page=1`,
      ),
    );
    if (comparison.status === "ahead" || comparison.status === "identical") return candidate;
  }
  return null;
}

async function newMainPulls(github: GitHubClient, anchor: string, head: string) {
  const numbers = new Set<number>();
  if (anchor === head) return numbers;
  const commits = new Set<string>();
  // This bounds a single unaccepted main interval, not the lifetime of a project.
  for (let page = 1; page <= 10; page += 1) {
    const response = object(
      await github.request(
        `/repos/${github.repository}/compare/${anchor}...${head}?per_page=100&page=${page}`,
      ),
    );
    if (response.status !== "ahead" && response.status !== "identical")
      throw new SecurityError(
        "changed_ancestry",
        409,
        "The accepted main ancestor changed during verification.",
      );
    if (!Array.isArray(response.commits))
      throw new SecurityError("missing_commits", 503, "GitHub main commit history is unavailable.");
    for (const value of response.commits) commits.add(sha(object(value).sha));
    if (response.commits.length < 100) break;
    if (page === 10)
      throw new SecurityError(
        "lineage_interval_limit",
        503,
        "The unaccepted main interval exceeds the verification work bound.",
      );
  }
  const [owner, name] = github.repository.split("/");
  const entries = [...commits];
  for (let offset = 0; offset < entries.length; offset += 50) {
    const batch = entries.slice(offset, offset + 50);
    const fields = batch
      .map(
        (commit, index) =>
          `c${index}: object(oid: "${commit}") { ... on Commit { oid associatedPullRequests(first: 100) { nodes { number } pageInfo { hasNextPage } } } }`,
      )
      .join("\n");
    const response = object(
      await github.request("/graphql", {
        method: "POST",
        body: JSON.stringify({
          query: `query VisonautMergedHistory($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { databaseId ${fields} } }`,
          variables: { owner, name },
        }),
      }),
    );
    if (response.errors)
      throw new SecurityError(
        "history_unavailable",
        503,
        "GitHub merged pull-request history is unavailable.",
      );
    const repository = object(object(response.data).repository);
    if (String(repository.databaseId) !== github.repositoryId)
      throw new SecurityError(
        "invalid_history",
        503,
        "GitHub history belongs to a different repository.",
      );
    for (let index = 0; index < batch.length; index += 1) {
      const commit = object(repository[`c${index}`]);
      if (commit.oid !== batch[index])
        throw new SecurityError("missing_commits", 503, "GitHub commit identity is unavailable.");
      const pulls = object(commit.associatedPullRequests);
      if (!Array.isArray(pulls.nodes) || object(pulls.pageInfo).hasNextPage !== false)
        throw new SecurityError(
          "history_limit",
          503,
          "GitHub commit associations exceed the verification work bound.",
        );
      for (const pull of pulls.nodes) numbers.add(integer(object(pull).number, 1));
    }
  }
  return numbers;
}

export async function relatedRunEvidence(
  context: ApiContext,
  github: GitHubClient,
  target: LineageTarget,
  frozen?: FrozenTarget,
) {
  const startedAt = Date.now();
  // Freeze queue membership while the live group still exists, before capture.
  const identity = await verifyLineage(github, target, [], frozen);
  const targetBase =
    target.event === "push" || target.event === "workflow_dispatch"
      ? target.testedSha
      : target.targetHead;
  const anchor = await lineageAnchor(context, github, targetBase);
  const relevantPulls = anchor ? await newMainPulls(github, anchor.tested_sha, targetBase) : null;
  if (target.pullRequestNumber) relevantPulls?.add(target.pullRequestNumber);
  for (const member of identity.proof.mergeGroupMembers) relevantPulls?.add(member.number);
  const cutoff = anchor?.verified_at ?? 0;
  // Read only new main/group work and the PRs actually associated with this
  // interval. Prior proofs stay in the accepted ancestor's direct verified graph.
  // The compact projection avoids rereading each historical proof's full edge list.
  const projection = `json_object('repositoryId', json_extract(p.verified_json, '$.repositoryId'), 'repository', json_extract(p.verified_json, '$.repository'), 'testedSha', json_extract(p.verified_json, '$.testedSha'), 'event', json_extract(p.verified_json, '$.event'), 'ref', json_extract(p.verified_json, '$.ref'), 'sourceHead', json_extract(p.verified_json, '$.sourceHead'), 'pullRequestNumber', json_extract(p.verified_json, '$.pullRequestNumber'), 'mergeGroup', json_extract(p.verified_json, '$.mergeGroup'), 'lineageProof', json_object('version', json_extract(p.verified_json, '$.lineageProof.version'), 'testedSha', json_extract(p.verified_json, '$.lineageProof.testedSha'), 'mergeGroupMembers', json_extract(p.verified_json, '$.lineageProof.mergeGroupMembers'))) AS verified_json`;
  const result = await context.database
    .prepare(
      `SELECT r.id, r.kind, r.tested_sha, r.lineage_key, ${projection} FROM visonaut_runs r JOIN ingest_run_provenance p ON p.run_id = r.id WHERE r.project_id = ? AND (? = 1 OR (r.kind = 'pull_request' AND r.lineage_key IN (SELECT 'pr:' || value FROM json_each(?))) OR (r.kind != 'pull_request' AND (r.created_at >= ? OR p.created_at >= ?)) OR (r.kind = 'merge_group' AND EXISTS (SELECT 1 FROM json_each(p.verified_json, '$.lineageProof.mergeGroupMembers') member WHERE json_extract(member.value, '$.number') IN (SELECT value FROM json_each(?))))) ORDER BY r.created_at DESC`,
    )
    .bind(
      context.configuration.projectId,
      anchor ? 0 : 1,
      JSON.stringify([...(relevantPulls ?? [])]),
      cutoff,
      cutoff,
      JSON.stringify([...(relevantPulls ?? [])]),
    )
    .all<LineageSource>();
  const evidence = await verifyLineage(github, target, result.results, frozen);
  evidence.proof.startedAt = startedAt;
  const related = new Set(evidence.runIds);
  if (anchor) {
    related.add(anchor.id);
    if (!evidence.proof.relations.some((relation) => relation.sourceRunId === anchor.id))
      evidence.proof.relations.push({
        sourceRunId: anchor.id,
        reason: "ancestor",
        commit: anchor.tested_sha,
      });
  }
  return { runIds: [...related], proof: evidence.proof };
}

/** Recomparison uses the already verified captured target, not today's mutable PR ref. */
export async function refreshRunLineage(context: ApiContext, github: GitHubClient, run: RunRow) {
  const row = await context.database
    .prepare("SELECT verified_json FROM ingest_run_provenance WHERE run_id = ?")
    .bind(run.id)
    .first<{ verified_json: string }>();
  if (!row)
    throw new SecurityError("missing_provenance", 503, "Verified run provenance is unavailable.");
  const stored = object(JSON.parse(row.verified_json));
  if (
    stored.repositoryId !== github.repositoryId ||
    stored.repository !== github.repository ||
    stored.testedSha !== run.tested_sha
  ) {
    throw new SecurityError(
      "invalid_provenance",
      503,
      "Stored capture provenance does not match this repository and run.",
    );
  }
  const event = stored.event;
  if (
    event !== "push" &&
    event !== "workflow_dispatch" &&
    event !== "pull_request" &&
    event !== "merge_group"
  ) {
    throw new SecurityError("invalid_provenance", 503, "Stored capture event is invalid.");
  }
  const target: LineageTarget = {
    repository: github.repository,
    repositoryId: github.repositoryId,
    testedSha: sha(stored.testedSha),
    event,
    ref: string(stored.ref),
    sourceHead: sha(stored.sourceHead),
    targetHead: sha(stored.targetHead),
    ...(event === "pull_request"
      ? { pullRequestNumber: integer(stored.pullRequestNumber, 1) }
      : {}),
  };
  const frozen: FrozenTarget = { mergeGroupMembers: [] };
  if (event === "merge_group") {
    const group = object(stored.mergeGroup);
    target.mergeGroup = {
      repositoryId: string(group.repositoryId),
      headSha: sha(group.headSha),
      headRef: string(group.headRef),
      baseSha: sha(group.baseSha),
      baseRef: string(group.baseRef),
    };
    const proof = object(stored.lineageProof);
    if (
      proof.version !== 1 ||
      proof.testedSha !== run.tested_sha ||
      !Array.isArray(proof.mergeGroupMembers)
    ) {
      throw new SecurityError(
        "missing_queue_proof",
        503,
        "The captured merge-group membership is unavailable.",
      );
    }
    frozen.mergeGroupMembers = proof.mergeGroupMembers.map((value) => {
      const member = object(value);
      return {
        number: integer(member.number, 1),
        sourceHead: sha(member.sourceHead),
        queueHead: sha(member.queueHead),
        queueBase: sha(member.queueBase),
      };
    });
    if (!frozen.mergeGroupMembers.some((member) => member.queueHead === run.tested_sha)) {
      throw new SecurityError(
        "missing_queue_proof",
        503,
        "The captured merge-group membership does not match its SHA.",
      );
    }
  }
  const evidence = await relatedRunEvidence(context, github, target, frozen);
  const runIds = evidence.runIds.filter((id) => id !== run.id);
  evidence.proof.relations = evidence.proof.relations.filter(
    (relation) => relation.sourceRunId !== run.id,
  );
  const proofDigest = await digestJson(evidence.proof);
  await atomic(context.database, [
    assertion(
      context.database,
      "EXISTS (SELECT 1 FROM visonaut_runs WHERE id = ? AND project_id = ? AND active = 1)",
      [run.id, run.project_id],
    ),
    statement(
      context.database,
      "INSERT INTO visonaut_lineage_edges (source_run_id, target_run_id, proof_digest) SELECT r.id, ?, ? FROM visonaut_runs r JOIN json_each(?) source ON source.value = r.id WHERE r.project_id = ? ON CONFLICT(source_run_id, target_run_id) DO NOTHING",
      [run.id, proofDigest, JSON.stringify(runIds), run.project_id],
    ),
    ...materializeLineageStatements(context.database, run.id, proofDigest),
    statement(
      context.database,
      "UPDATE ingest_run_provenance SET verified_json = json_set(verified_json, '$.lineageProof', json(?)) WHERE run_id = ?",
      [JSON.stringify(evidence.proof), run.id],
    ),
  ]);
}
