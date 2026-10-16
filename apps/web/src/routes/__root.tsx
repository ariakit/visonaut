import { createRootRoute, HeadContent, Link, Outlet, Scripts } from "@tanstack/react-router";
import { ButtonLabel } from "../components/ariakit/components/button.ariakit.react.tsx";
import { ShellMain, ShellMainBody } from "../components/ariakit/components/shell.ariakit.react.tsx";
import { Text } from "../components/ariakit/components/text.ariakit.react.tsx";
import { ControlButton } from "../components/control-button.tsx";
import { AppShell } from "../components/kit/shell.tsx";
import { pageTitle } from "../page-title.ts";
import "../styles.css";

export const Route = createRootRoute({
  head: ({ match }) => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      // A URL that no route matches renders the not found page of this route.
      // The one head gives its title, so the document has one title element.
      { title: match._notFound ? pageTitle("Page not found") : "Visonaut" },
      { name: "robots", content: "noindex, nofollow" },
    ],
    links: [{ rel: "icon", type: "image/svg+xml", href: "/favicon.svg" }],
  }),
  component: Root,
  notFoundComponent: NotFound,
});

/** The page of a URL that the app does not have: the shell and a way to the Queue. */
function NotFound() {
  return (
    <AppShell>
      <ShellMain $maxWidth="70rem" $p="clamp(1rem, 3vw, 2.5rem)">
        <ShellMainBody className="mx-auto grid w-full max-w-xl justify-items-start gap-4 py-8 sm:py-16">
          <Text render={<h1 />} className="text-2xl font-semibold tracking-tight">
            Page not found
          </Text>
          <Text render={<p />} className="ak-ink-60">
            Visonaut has no page at this address.
          </Text>
          <ControlButton $layer="brand" render={<Link to="/" />}>
            <ButtonLabel>Open the Queue</ButtonLabel>
          </ControlButton>
        </ShellMainBody>
      </ShellMain>
    </AppShell>
  );
}

function Root() {
  return (
    <html lang="en" className="[font-synthesis:none]">
      <head>
        <HeadContent />
      </head>
      <body>
        <Outlet />
        <Scripts />
      </body>
    </html>
  );
}
