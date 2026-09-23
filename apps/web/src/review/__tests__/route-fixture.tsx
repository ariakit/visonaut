import { createMemoryHistory, createRouter, Outlet, RouterProvider } from "@tanstack/react-router";
import { createRoot } from "react-dom/client";
import { routeTree } from "../../routeTree.gen.ts";

const element = document.getElementById("root");
if (!element) throw new Error("Fixture root is missing.");
const entry = new URLSearchParams(window.location.search).get("entry") ?? "/runs/run-42";
const router = createRouter({
  routeTree: routeTree.update({ component: Outlet }),
  history: createMemoryHistory({ initialEntries: [entry] }),
});
createRoot(element).render(<RouterProvider router={router} />);
