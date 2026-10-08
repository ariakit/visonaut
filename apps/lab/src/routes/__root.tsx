import {
  createRootRoute,
  HeadContent,
  Link,
  Outlet,
  Scripts,
  useRouterState,
} from "@tanstack/react-router";
import { Button } from "../components/ariakit/components/button.ariakit.react.tsx";
import { Heading } from "../components/ariakit/components/heading.ariakit.react.tsx";
import { themeScript } from "../lab/theme.ts";
import { LabShell } from "../lab/ui/lab-shell.tsx";
// The stylesheet is a link, not a module import. In development, a module
// import makes the server send the style sheet together with every file that
// it imports as extra style sheets. The extra Tailwind sheet then wins over
// the theme until the client replaces it, and every page and every preview
// frame starts with the wrong font and layout.
import stylesHref from "../styles.css?url";

// After an edit, the development server adds a version to the URL, and the
// server and the client do not get the same one. React would then add a
// second link to the same style sheet. The plain path is always current.
function withoutSearch(href: string) {
  const [path = href] = href.split("?");
  return path;
}

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Visonaut design lab" },
      { name: "robots", content: "noindex, nofollow" },
    ],
    links: [
      { rel: "stylesheet", href: withoutSearch(stylesHref) },
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
    ],
  }),
  component: Root,
  notFoundComponent: NotFound,
});

function NotFound() {
  return (
    <div className="grid min-h-[60dvh] place-items-center p-6">
      <div className="grid justify-items-center gap-3 text-center">
        <Heading className="text-lg font-semibold">Nothing here</Heading>
        <Button render={<Link to="/" />} $lightnessOffset>
          Open the gallery
        </Button>
      </div>
    </div>
  );
}

function Root() {
  // The bare preview renders a variant alone, without the lab around it.
  const bare = useRouterState({
    select: (state) => state.location.pathname.startsWith("/preview/"),
  });
  return (
    <html lang="en" data-theme="dark" className="[font-synthesis:none]" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <HeadContent />
      </head>
      <body>
        {bare ? (
          <Outlet />
        ) : (
          <LabShell>
            <Outlet />
          </LabShell>
        )}
        <Scripts />
      </body>
    </html>
  );
}
