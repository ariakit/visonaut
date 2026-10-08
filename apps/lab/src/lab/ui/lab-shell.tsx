import { Link, useRouter, useRouterState } from "@tanstack/react-router";
import { Aperture, Compass, LayoutGrid, MessagesSquare, Shapes } from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "../../components/ariakit/components/badge.ariakit.react.tsx";
import {
  Button,
  ButtonLabel,
  ButtonSlot,
} from "../../components/ariakit/components/button.ariakit.react.tsx";
import { Nav, NavLink, NavSlot } from "../../components/ariakit/components/nav.ariakit.react.tsx";
import {
  Shell,
  ShellHeader,
  ShellHeaderCenter,
} from "../../components/ariakit/components/shell.ariakit.react.tsx";
import { catalog } from "../catalog.ts";
import { FeedbackBar } from "./feedback-bar.tsx";
import { LookControls, ThemeToggle } from "./look-controls.tsx";

// The routes that render shell parts themselves: sidebars and a main area.
// Any other route gets a plain block in the main area of the shell.
const shellRoutes = new Set([
  "/",
  "/pages/$surface",
  "/components/$surface",
  "/directions/",
  "/directions/$direction",
  "/feedback",
]);

type Section = "gallery" | "directions" | "feedback" | "primitives";

// The primitives reference is a page of another part of the lab. The header
// links to it when the route exists, without a typed dependency on it.
const primitivesPath = "/primitives";

function getSection(pathname: string): Section | undefined {
  if (pathname === "/") return "gallery";
  if (pathname.startsWith("/pages/")) return "gallery";
  if (pathname.startsWith("/components/")) return "gallery";
  if (pathname.startsWith("/directions")) return "directions";
  if (pathname.startsWith("/feedback")) return "feedback";
  if (pathname.startsWith(primitivesPath)) return "primitives";
  return;
}

function LabNav() {
  const router = useRouter();
  const hasPrimitives = Object.hasOwn(router.routesByPath, primitivesPath);
  const section = useRouterState({ select: (state) => getSection(state.location.pathname) });
  const current = (id: Section) => (section === id ? "page" : undefined);
  return (
    <Nav
      aria-label="Lab"
      $layout="horizontal"
      glider={{ $kind: "bar", $state: "selected", $side: "end", $barOffset: "frame" }}
    >
      <NavLink
        // The router marks a link as current by path prefix, which is every
        // page for the root path, so the gallery link takes its state from
        // the section instead.
        render={<Link to="/" activeOptions={{ exact: true, includeSearch: false }} />}
        aria-label="Gallery"
        aria-current={current("gallery")}
      >
        <NavSlot>
          <LayoutGrid />
        </NavSlot>
        <ButtonLabel className="hidden lab-wide:inline">Gallery</ButtonLabel>
      </NavLink>
      {catalog.directions.length > 0 && (
        <NavLink
          render={<Link to="/directions" />}
          aria-label="Directions"
          aria-current={current("directions")}
        >
          <NavSlot>
            <Compass />
          </NavSlot>
          <ButtonLabel className="hidden lab-wide:inline">Directions</ButtonLabel>
        </NavLink>
      )}
      <NavLink
        render={<Link to="/feedback" />}
        aria-label="Feedback"
        aria-current={current("feedback")}
      >
        <NavSlot>
          <MessagesSquare />
        </NavSlot>
        <ButtonLabel className="hidden lab-wide:inline">Feedback</ButtonLabel>
      </NavLink>
      {hasPrimitives && (
        <NavLink href={primitivesPath} aria-label="Primitives" aria-current={current("primitives")}>
          <NavSlot>
            <Shapes />
          </NavSlot>
          <ButtonLabel className="hidden lab-wide:inline">Primitives</ButtonLabel>
        </NavLink>
      )}
    </Nav>
  );
}

export interface LabShellProps {
  children?: ReactNode;
}

/**
 * The frame of every lab page: one sticky header with the lab navigation, the
 * feedback bar, and the look controls. The bare preview does not use it.
 */
export function LabShell({ children }: LabShellProps) {
  const ownsShellParts = useRouterState({
    select: (state) => shellRoutes.has(state.matches.at(-1)?.routeId ?? ""),
  });
  return (
    <Shell
      // A stacked header has two rows. The shell reads the height token for
      // sticky offsets and anchors, and the header reads it for its own
      // minimum height, so both get the taller value.
      className="text-sm lab-stack:[--shell-header-height:--spacing(25)]!"
    >
      <ShellHeader
        $height="sm"
        className="lab-stack:content-center lab-stack:gap-y-0 lab-stack:[--shell-header-height:--spacing(25)]!"
        start={
          <>
            <Button render={<Link to="/" />} $p={1} aria-label="Visonaut lab, gallery">
              <ButtonSlot $kind="avatar" $layer="brand" $size="lg" $rounded="lg">
                <Aperture />
              </ButtonSlot>
              <ButtonLabel className="font-semibold tracking-tight max-sm:hidden">
                visonaut
              </ButtonLabel>
              <Badge $size="xs" className="max-sm:hidden">
                lab
              </Badge>
            </Button>
            <LabNav />
          </>
        }
        center={
          <ShellHeaderCenter
            // On a narrow window, the feedback bar takes a second row. If it
            // still does not fit, the row scrolls instead of the page.
            className="lab-stack:col-span-full lab-stack:row-start-2 lab-stack:min-w-0 lab-stack:justify-self-stretch lab-stack:overflow-x-auto lab-stack:scrollbar-none"
          >
            <FeedbackBar />
          </ShellHeaderCenter>
        }
        end={
          <>
            <LookControls />
            <ThemeToggle />
          </>
        }
      />
      {ownsShellParts ? (
        children
      ) : (
        <div className="col-[main-start/shell-end] row-[main-start/body-end] min-w-0">
          {children}
        </div>
      )}
    </Shell>
  );
}
