import { createFileRoute, Outlet, useMatches } from "@tanstack/react-router";
import { NoAccessScreen, SignInScreen } from "../access/access-screens.tsx";
import { AppSessionProvider, useAppSession } from "../app-session.tsx";
import { AppShell } from "../components/kit/shell.tsx";
import { isGuestDocument } from "../dashboard/run-list.ts";

declare module "@tanstack/react-router" {
  interface StaticDataRouteOption {
    /**
     * `page`: the page renders the shell root itself, with the header of the
     * layout route. Default: the layout route renders the shell around the page.
     */
    shell?: "page";
  }
}

// The layout route of each page. It has no URL segment. It keeps server
// rendering on, because a child route can only be more restrictive.
export const Route = createFileRoute("/_app")({
  // The server says if the document request has a session credential. With
  // none, the document has the sign-in page and no page waits for a request.
  loader: (options) => ({ guest: isGuestDocument(options) }),
  component: AppLayout,
});

function AppLayout() {
  const { guest } = Route.useLoaderData();
  return (
    <AppSessionProvider>
      <AppFrame guest={guest} />
    </AppSessionProvider>
  );
}

interface AppFrameProps {
  /** True when the document request had no session credential. */
  guest: boolean;
}

function AppFrame({ guest }: AppFrameProps) {
  const { denial } = useAppSession();
  const pageShell = useMatches({
    select: (matches) => matches.some((match) => match.staticData.shell === "page"),
  });
  // One sign-in page and one no access page for each page of the app.
  if (guest || denial?.status === "guest") return <SignInScreen />;
  if (denial?.status === "forbidden") {
    return <NoAccessScreen login={denial.login} message={denial.message} />;
  }
  if (pageShell) return <Outlet />;
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}
