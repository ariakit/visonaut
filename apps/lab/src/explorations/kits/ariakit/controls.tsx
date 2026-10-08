import * as ak from "@ariakit/react";
import { cx } from "clava";
import { Info } from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import {
  Button,
  ButtonSlot,
} from "../../../components/ariakit/components/button.ariakit.react.tsx";
import type { ButtonProps } from "../../../components/ariakit/components/button.ariakit.react.tsx";
import { Frame } from "../../../components/ariakit/components/frame.ariakit.react.tsx";
import type { FrameProps } from "../../../components/ariakit/components/frame.ariakit.react.tsx";
import { Kbd } from "../../../components/ariakit/components/kbd.ariakit.react.tsx";
import {
  OptionLabel,
  OptionSlot,
} from "../../../components/ariakit/components/option.ariakit.react.tsx";
import {
  Popover,
  PopoverDescription,
  PopoverDisclosure,
  PopoverHeading,
} from "../../../components/ariakit/components/popover.ariakit.react.tsx";
import type { PopoverProviderProps } from "../../../components/ariakit/components/popover.ariakit.react.tsx";
import { Separator } from "../../../components/ariakit/components/separator.ariakit.react.tsx";
import { TextFrame } from "../../../components/ariakit/components/text-frame.ariakit.react.tsx";
import {
  Tooltip,
  TooltipAnchor,
  TooltipProvider,
} from "../../../components/ariakit/components/tooltip.ariakit.react.tsx";
import type { TooltipProviderProps } from "../../../components/ariakit/components/tooltip.ariakit.react.tsx";
import type { button } from "../../../components/ariakit/styles/button.ts";
import { option } from "../../../components/ariakit/styles/option.ts";
import { popover } from "../../../components/ariakit/styles/popover.ts";
import type { User } from "../../../fixtures/index.ts";
import { useShortcuts } from "./keys.tsx";
import { iconStroke, overlayRoot, tertiary } from "./tokens.ts";

export interface HintProps {
  /** The text of the tooltip. */
  label: ReactNode;
  /** The keys of one chord. They hide while the keyboard switch is off. */
  shortcut?: readonly string[];
  placement?: TooltipProviderProps["placement"];
  /** The control. It becomes the anchor: do not put a button inside a button. */
  children: ReactElement;
}

/**
 * A tooltip with an optional key cap on any control. The tooltip describes
 * the control. The control keeps its own name. A tooltip is a popover context
 * of its own: a `PopoverDisclosure` or a menu button inside a `Hint` must
 * take its store by name (`store={store}`), as `MoreInfo` does.
 * @example
 * <Hint label="Next screenshot" shortcut={["↓"]}>
 *   <Button aria-label="Next screenshot">…</Button>
 * </Hint>
 */
export function Hint({ label, shortcut, placement, children }: HintProps) {
  const { enabled } = useShortcuts();
  return (
    <TooltipProvider placement={placement}>
      <TooltipAnchor render={children} />
      <Tooltip className={cx(overlayRoot, "flex items-center gap-2")}>
        {label}
        {enabled && shortcut && (
          <span className="flex items-center gap-0.5">
            {shortcut.map((key) => (
              <Kbd key={key}>{key}</Kbd>
            ))}
          </span>
        )}
      </Tooltip>
    </TooltipProvider>
  );
}

export interface IconButtonProps extends Omit<ButtonProps, "children"> {
  /** The accessible name, and the text of the tooltip. */
  label: string;
  /** One lucide icon. */
  icon: ReactNode;
  shortcut?: readonly string[];
  placement?: TooltipProviderProps["placement"];
}

/**
 * A square icon button with its name in a tooltip, and its key when it has
 * one. Every icon-only control of the direction is one of these.
 * @example
 * <IconButton label="Undo" shortcut={["⌘", "Z"]} icon={<Undo2 strokeWidth={iconStroke} />} onClick={undo} />
 */
export function IconButton({ label, icon, shortcut, placement, ...props }: IconButtonProps) {
  return (
    <Hint label={label} shortcut={shortcut} placement={placement}>
      <Button<typeof button> aria-label={label} {...props}>
        <ButtonSlot>{icon}</ButtonSlot>
      </Button>
    </Hint>
  );
}

export interface MenuProps extends ak.MenuProps {}

/**
 * The menu surface: `ak.Menu` with the popover recipe, in a portal. Put it in
 * an `ak.MenuProvider` beside an `ak.MenuButton` that renders a `Button`.
 * @example
 * <ak.MenuProvider>
 *   <ak.MenuButton render={<Button aria-label="More" />}>…</ak.MenuButton>
 *   <Menu>
 *     <MenuItem icon={<Copy />} onClick={copy}>Copy link</MenuItem>
 *   </Menu>
 * </ak.MenuProvider>
 */
export function Menu({ className, ...props }: MenuProps) {
  return (
    <ak.Menu
      portal
      gutter={8}
      unmountOnHide
      {...popover.jsx({
        $p: 1,
        $rounded: "xl",
        className: cx(overlayRoot, "grid min-w-52 outline-none", className),
      })}
      {...props}
    />
  );
}

export interface MenuItemProps extends ak.MenuItemProps {
  icon?: ReactNode;
  /** The keys of one chord, at the end of the row. */
  shortcut?: readonly string[];
  /** Paints the label and the icon in the danger color. */
  danger?: boolean;
}

/**
 * One row of a `Menu`, with the option recipe. Its key is dimmed text in the
 * stock shortcut slot, and it hides while the keyboard switch is off.
 */
export function MenuItem({ icon, shortcut, danger, children, className, ...props }: MenuItemProps) {
  const { enabled } = useShortcuts();
  return (
    <ak.MenuItem {...option.jsx({ $text: danger ? "danger" : undefined, className })} {...props}>
      {icon && <OptionSlot>{icon}</OptionSlot>}
      <OptionLabel className="flex-1">{children}</OptionLabel>
      {enabled && shortcut && (
        <OptionSlot $kind="shortcut" aria-hidden>
          <kbd>{shortcut.join("")}</kbd>
        </OptionSlot>
      )}
    </ak.MenuItem>
  );
}

export interface MenuItemCheckboxProps extends ak.MenuItemCheckboxProps {}

/**
 * A row of a `Menu` that turns one setting on and off: the stock check in
 * the slot of the row. The `MenuProvider` holds the value under `name`.
 * @example
 * <ak.MenuProvider values={{ shortcuts: enabled }} setValues={(values) => setEnabled(!!values.shortcuts)}>
 *   <Menu>
 *     <MenuItemCheckbox name="shortcuts">Shortcuts</MenuItemCheckbox>
 *   </Menu>
 * </ak.MenuProvider>
 */
export function MenuItemCheckbox({ children, className, ...props }: MenuItemCheckboxProps) {
  return (
    <ak.MenuItemCheckbox {...option.jsx({ className })} {...props}>
      <OptionSlot>
        <ak.MenuItemCheck />
      </OptionSlot>
      <OptionLabel className="flex-1">{children}</OptionLabel>
    </ak.MenuItemCheckbox>
  );
}

/** The dashed rule between two groups of a `Menu`. */
export function MenuSeparator() {
  return <ak.MenuSeparator render={<Separator $gap={1} />} />;
}

/** A soft label above a group of menu rows, for example the login. */
export function MenuHeading({ className, ...props }: FrameProps) {
  return (
    <TextFrame $p={1.5} className={cx(tertiary, "text-xs font-medium", className)} {...props} />
  );
}

export interface MoreInfoProps {
  /** The accessible name and tooltip of the button. Default: `More info`. */
  label?: string;
  heading?: ReactNode;
  /** The prose that leaves the page. */
  children: ReactNode;
  placement?: PopoverProviderProps["placement"];
  className?: string;
}

/**
 * Words leave the chrome and go here: an `Info` icon button that opens a
 * popover, the idiom of the Ariakit sandbox boxes.
 * @example
 * <MoreInfo heading="About this page">Alerts refresh each minute while this page is open.</MoreInfo>
 */
export function MoreInfo({
  label = "More info",
  heading,
  children,
  placement,
  className,
}: MoreInfoProps) {
  // The tooltip of the button is a popover context too, so the button and
  // the popover take this store by name.
  const store = ak.usePopoverStore({ placement });
  return (
    <>
      <Hint label={label}>
        <PopoverDisclosure store={store} aria-label={label} className={className}>
          <ButtonSlot>
            <Info strokeWidth={iconStroke} />
          </ButtonSlot>
        </PopoverDisclosure>
      </Hint>
      <Popover
        store={store}
        portal
        unmountOnHide
        $rounded="xl"
        $p={3}
        className={cx(overlayRoot, "grid max-w-72 gap-1.5")}
      >
        {heading && <PopoverHeading className="text-sm font-semibold">{heading}</PopoverHeading>}
        <PopoverDescription>{children}</PopoverDescription>
      </Popover>
    </>
  );
}

type Person = Pick<User, "login" | "name" | "avatarUrl">;

/** `Diego Haz` gives `DH`. A login gives its first two letters. */
export function getInitials({ login, name }: Pick<User, "login" | "name">): string {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
  const first = words[0]?.[0];
  const last = words.length > 1 ? words.at(-1)?.[0] : undefined;
  if (first && last) return `${first}${last}`.toUpperCase();
  return login
    .replace(/[^a-z0-9]/gi, "")
    .slice(0, 2)
    .toUpperCase();
}

export interface AvatarContentProps {
  /** Without a person, the avatar is an empty disc. */
  user?: Person;
}

/**
 * The inside of an avatar slot: the picture, or the initials when the API
 * sends no picture.
 * @example
 * <ButtonSlot $kind="avatar" $layer="brand">
 *   <AvatarContent user={user} />
 * </ButtonSlot>
 */
export function AvatarContent({ user }: AvatarContentProps) {
  if (!user) return null;
  if (user.avatarUrl) {
    return <img src={user.avatarUrl} alt="" className="size-full object-cover" />;
  }
  return <>{getInitials(user)}</>;
}

export interface AvatarProps extends Omit<FrameProps, "children"> {
  user?: Person;
}

/**
 * An avatar outside a control: a round frame of 1lh with the picture or the
 * initials. Inside a control, use a slot with `$kind="avatar"` and
 * `AvatarContent`.
 */
export function Avatar({ user, className, ...props }: AvatarProps) {
  return (
    <Frame
      $layer={user?.avatarUrl ? true : "brand"}
      $lightnessOffset={user ? undefined : 2}
      $rounded="full"
      $forceRounded
      aria-hidden
      // A span, so the avatar can sit in a paragraph, a heading, or a label.
      render={<span />}
      className={cx(
        "inline-flex size-[1lh] flex-none items-center justify-center overflow-clip",
        className,
      )}
      {...props}
    >
      <span className="contents text-[0.6em] leading-none font-semibold">
        <AvatarContent user={user} />
      </span>
    </Frame>
  );
}
