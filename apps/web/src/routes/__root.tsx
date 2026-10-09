import {
  createRootRoute,
  HeadContent,
  Link,
  Outlet,
  Scripts,
  useRouter,
} from "@tanstack/react-router";
import { ButtonLabel } from "../components/ariakit/components/button.ariakit.react.tsx";
import { ShellMain, ShellMainBody } from "../components/ariakit/components/shell.ariakit.react.tsx";
import { Text } from "../components/ariakit/components/text.ariakit.react.tsx";
import { ControlButton } from "../components/control-button.tsx";
import { AppShell } from "../components/kit/shell.tsx";
import { pageTitle } from "../page-title.ts";
import "../styles.css";
import { sidebarPreferenceScript } from "../review/sidebar-preference.ts";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Visonaut" },
      { name: "robots", content: "noindex, nofollow" },
    ],
    links: [{ rel: "icon", type: "image/svg+xml", href: "/favicon.svg" }],
  }),
  component: Root,
  notFoundComponent: NotFound,
});

/** The page of a URL that the app does not have: the shell and a way to the Queue. */
function NotFound() {
  const title = pageTitle("Page not found");
  return (
    <AppShell>
      {/* React moves a title element to the head of the document. */}
      <title>{title}</title>
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
  const router = useRouter();
  return (
    <html lang="en" className="[font-synthesis:none]" suppressHydrationWarning>
      <head>
        <script
          nonce={router.options.ssr?.nonce}
          dangerouslySetInnerHTML={{ __html: sidebarPreferenceScript }}
        />
        <HeadContent />
      </head>
      <body>
        <Outlet />
        <Scripts />
      </body>
    </html>
  );
}
