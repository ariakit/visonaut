import { PanelLeft } from "lucide-react";
import { useId, useState } from "react";
import type { ReactNode } from "react";
import { Button, ButtonSlot } from "../../components/ariakit/components/button.ariakit.react.tsx";
import {
  Shell,
  ShellHeader,
  ShellMain,
  ShellMainBody,
  ShellSidebar,
  ShellSidebarBody,
} from "../../components/ariakit/components/shell.ariakit.react.tsx";
import type { ShellProps } from "../../components/ariakit/components/shell.ariakit.react.tsx";

export interface PageShellProps extends Pick<ShellProps, "className" | "$forceRounded"> {
  /** The start of the header, after the sidebar toggle. */
  brand: ReactNode;
  /** The end of the header. */
  actions?: ReactNode;
  /** The content of the sidebar, usually a `Nav`. */
  sidebar: ReactNode;
  children: ReactNode;
}

/**
 * A page shell with a sticky header and a sticky sidebar. The page scrolls, and
 * the sidebar body scrolls on its own. The sidebar shows from 48rem of shell
 * width, and the toggle button shows at the same widths.
 */
export function PageShell({ brand, actions, sidebar, children, ...props }: PageShellProps) {
  const [open, setOpen] = useState(true);
  const sidebarId = useId();
  return (
    <Shell {...props}>
      <ShellHeader
        $height="sm"
        $blur
        start={
          <>
            <Button
              className="@max-3xl/shell:hidden"
              aria-label="Toggle sidebar"
              aria-expanded={open}
              aria-controls={sidebarId}
              onClick={() => setOpen(!open)}
            >
              <ButtonSlot>
                <PanelLeft />
              </ButtonSlot>
            </Button>
            {brand}
          </>
        }
        end={actions}
      />
      <ShellSidebar id={sidebarId} open={open} $width="sm" aria-label="Sections" render={<nav />}>
        <ShellSidebarBody $p={2}>{sidebar}</ShellSidebarBody>
      </ShellSidebar>
      <ShellMain $p="1.5rem" $maxWidth="64rem">
        <ShellMainBody>{children}</ShellMainBody>
      </ShellMain>
    </Shell>
  );
}
