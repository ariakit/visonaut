import type { GitHubClient, VerifiedWebhook } from "@visonaut/security";
import type { ApiContext } from "./context.js";
import { candidateForWebhook } from "./pre-run-candidates.js";
import { storeCandidateCheck, type Candidate } from "./pre-run-checks.js";

/** Create the check of a candidate as a fixture. No product path calls this. */
export async function ensurePreRunCheck(
  context: ApiContext,
  github: GitHubClient,
  candidate: Candidate,
  webhook: VerifiedWebhook,
  currentCandidate: () => Promise<Candidate | null> = () => candidateForWebhook(github, webhook),
) {
  await storeCandidateCheck({
    context,
    github,
    candidate,
    currentCandidate,
    validateBeforeCreation: false,
    createCheck: true,
  });
}
