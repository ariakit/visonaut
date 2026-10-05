import { createRootRoute, HeadContent, Outlet, Scripts, useRouter } from "@tanstack/react-router";
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
});

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
