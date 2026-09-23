import { createRouter } from "@tanstack/react-router";
import { createIsomorphicFn } from "@tanstack/react-start";
import { routeTree } from "./routeTree.gen";

const scriptNonce = createIsomorphicFn().server(() => crypto.randomUUID());

export function getRouter() {
  return createRouter({ routeTree, scrollRestoration: true, ssr: { nonce: scriptNonce() } });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
