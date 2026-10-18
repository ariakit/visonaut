import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useState } from "react";
import { useAppSession, useSessionFacts } from "../../app-session.tsx";
import type { SessionFacts } from "../../app-session.tsx";
import { PullRequestPage } from "../../components/pull-request/index.tsx";
import type { PullFacts } from "../../components/pull-request/index.tsx";
import { pageTitle } from "../../page-title.ts";

export const Route = createFileRoute("/_app/pulls/$pullNumber")({
  validateSearch: (search: Record<string, unknown>): { check?: string } => ({
    check: typeof search.check === "string" ? search.check : undefined,
  }),
  head: ({ params }) => ({ meta: [{ title: pageTitle(`Pull request #${params.pullNumber}`) }] }),
  component: PullRequest,
});

// The page asks only for the pull request. It reads no run list, so the
// header has the facts that the answer carries: the repository, the viewer,
// and the alert count.
function PullRequest() {
  const { pullNumber } = Route.useParams();
  const { check } = Route.useSearch();
  const { deny, facts: known } = useAppSession();
  const [facts, setFacts] = useState<SessionFacts>();
  const onFacts = useCallback((answer: PullFacts) => setFacts({ signedIn: true, ...answer }), []);
  useSessionFacts(facts);
  return (
    // Another pull request or another check starts a new lookup and a new state.
    <PullRequestPage
      key={`${pullNumber}:${check ?? ""}`}
      pullNumber={pullNumber}
      check={check}
      // The repository of the preview is in no place on GitHub.
      knownRepository={known.preview ? undefined : known.repository}
      onAccessDenied={deny}
      onFacts={onFacts}
    />
  );
}
