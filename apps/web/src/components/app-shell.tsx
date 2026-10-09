import type { ReactNode } from "react";
import { Activity, Aperture, History, Inbox } from "lucide-react";
import { ControlButton } from "./control-button.tsx";
import { ButtonLabel, ButtonSlot } from "./ariakit/components/button.ariakit.react.tsx";
import { Nav, NavLink, NavSlot } from "./ariakit/components/nav.ariakit.react.tsx";
import { ShellHeader, ShellHeaderCenter } from "./ariakit/components/shell.ariakit.react.tsx";
import { Text } from "./ariakit/components/text.ariakit.react.tsx";

interface AppHeaderProps {
  active?: "queue" | "history" | "service";
  repository?: string;
  end?: ReactNode;
}

const links = [
  { id: "queue", href: "/", label: "Review queue", icon: Inbox },
  { id: "history", href: "/?view=history", label: "Run history", icon: History },
  { id: "service", href: "/?view=service", label: "Service status", icon: Activity },
] as const;

export function AppHeader({ active, repository, end }: AppHeaderProps) {
  return (
    <ShellHeader
      $height="sm"
      $p={3}
      $border
      start={
        <div className="flex min-w-0 items-center gap-3">
          <ControlButton $p={1} render={<a href="/" />} aria-label="Visonaut review queue">
            <ButtonSlot $kind="avatar" $layer="brand" $size="lg" $rounded="lg">
              <Aperture />
            </ButtonSlot>
            <ButtonLabel className="hidden lg:inline text-base font-semibold tracking-tight">
              visonaut.
            </ButtonLabel>
          </ControlButton>
          {repository && (
            <Text className="hidden xl:block max-w-44 truncate border-l border-current/15 pl-3 text-xs opacity-60">
              {repository}
            </Text>
          )}
        </div>
      }
      center={
        <ShellHeaderCenter $shrink>
          <Nav
            aria-label="Main navigation"
            $layout="horizontal"
            glider={{ $kind: "bar", $state: "selected", $side: "end", $barOffset: "frame" }}
          >
            {links.map(({ id, href, label, icon: Icon }) => (
              <NavLink
                key={id}
                href={href}
                aria-label={label}
                aria-current={active === id ? "page" : undefined}
              >
                <NavSlot>
                  <Icon />
                </NavSlot>
                <ButtonLabel className="hidden sm:inline">{label}</ButtonLabel>
              </NavLink>
            ))}
          </Nav>
        </ShellHeaderCenter>
      }
      end={end}
    />
  );
}
