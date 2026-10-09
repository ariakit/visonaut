import { createFileRoute, Outlet, useMatches } from "@tanstack/react-router";
import { AppSessionProvider } from "../app-session.tsx";
import { AppShell } from "../components/kit/shell.tsx";

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
  component: AppLayout,
});

function AppLayout() {
  const pageShell = useMatches({
    select: (matches) => matches.some((match) => match.staticData.shell === "page"),
  });
  return (
    <AppSessionProvider>
      {pageShell ? (
        <Outlet />
      ) : (
        <AppShell>
          <Outlet />
        </AppShell>
      )}
    </AppSessionProvider>
  );
}
