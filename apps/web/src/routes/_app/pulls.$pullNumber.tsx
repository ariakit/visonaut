import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useAppSession, useSessionFacts } from "../../app-session.tsx";
import { PullRequestPage } from "../../components/pull-request/index.tsx";
import { pageTitle } from "../../page-title.ts";

export const Route = createFileRoute("/_app/pulls/$pullNumber")({
  validateSearch: (search: Record<string, unknown>): { check?: string } => ({
    check: typeof search.check === "string" ? search.check : undefined,
  }),
  head: ({ params }) => ({ meta: [{ title: pageTitle(`Pull request #${params.pullNumber}`) }] }),
  component: PullRequest,
});

// The page asks only for the pull request. It reads no run list, so the
// header has the repository of the answer and nothing else.
function PullRequest() {
  const { pullNumber } = Route.useParams();
  const { check } = Route.useSearch();
  const { deny, facts } = useAppSession();
  const [repository, setRepository] = useState<string>();
  useSessionFacts(repository ? { signedIn: true, repository } : undefined);
  return (
    // Another pull request or another check starts a new lookup and a new state.
    <PullRequestPage
      key={`${pullNumber}:${check ?? ""}`}
      pullNumber={pullNumber}
      check={check}
      knownRepository={facts.repository}
      onAccessDenied={deny}
      onRepository={setRepository}
    />
  );
}
