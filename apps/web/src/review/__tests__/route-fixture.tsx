import {
  createMemoryHistory,
  createRouter,
  HeadContent,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { createRoot } from "react-dom/client";
import { fetchRunList } from "../../dashboard/run-list.ts";
import { routerOptions } from "../../router-options.ts";
import { routeTree } from "../../routeTree.gen.ts";

function FixtureRoot() {
  return (
    <>
      <HeadContent />
      <Outlet />
    </>
  );
}

const element = document.getElementById("root");
if (!element) throw new Error("Fixture root is missing.");
const entry = new URLSearchParams(window.location.search).get("entry") ?? "/runs/run-42";
export const router = createRouter({
  // The root of the app renders the document. The fixture has its own document,
  // so its root renders only the head content (the title) and the page.
  routeTree: routeTree.update({ component: FixtureRoot }),
  ...routerOptions,
  history: createMemoryHistory({ initialEntries: [entry] }),
});
// With `documentRead`, the first read of the run list comes as a promise in
// the loader data, as in a document that the server rendered. The router of
// the server gives that read to the loader in this option. Each later read is
// a read of the browser.
if (new URLSearchParams(window.location.search).has("documentRead")) {
  router.options.additionalContext = {
    serverContext: {
      readRunList: () => {
        router.options.additionalContext = undefined;
        return fetchRunList();
      },
    },
  };
}

declare global {
  interface Window {
    /** The router of the fixture. A test reads the location of the memory history from it. */
    fixtureRouter: typeof router;
  }
}
window.fixtureRouter = router;
createRoot(element).render(<RouterProvider router={router} />);
