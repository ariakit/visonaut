import { createFileRoute, Outlet } from "@tanstack/react-router";

// The layout route of each page. It has no URL segment. It keeps server
// rendering on, because a child route can only be more restrictive.
export const Route = createFileRoute("/_app")({
  component: Outlet,
});
