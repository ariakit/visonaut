import { ErrorScreen } from "./error-screen.tsx";

/**
 * The options of the router that do not depend on where it runs. The app and
 * the route fixture of the browser tests use the same ones.
 */
export const routerOptions = {
  scrollRestoration: true,
  // One error screen for each route that has none of its own.
  defaultErrorComponent: ErrorScreen,
};
