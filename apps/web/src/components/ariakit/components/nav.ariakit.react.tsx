import * as ak from "@ariakit/react";
import type { VariantProps } from "clava";
import { cv, cx, splitProps } from "clava";
import * as React from "react";
import {
  createOptionalRender,
  createRender,
  isRenderable,
} from "../react-utils/create-render.react.ts";
import { frame, frameBase } from "../styles/frame.ts";
import { glider } from "../styles/glider.ts";
import { selected } from "../styles/selected.ts";
import { textFrame } from "../styles/text-frame.ts";
import { text } from "../styles/text.ts";
import { getSpacingValue } from "../utils/styles.ts";
import { isCurrentPage } from "../utils/is-current-page.ts";
import type { ButtonProps } from "./button.ariakit.react.tsx";
import { Button, button, buttonSlot } from "./button.ariakit.react.tsx";
import type {
  DisclosureButtonProps,
  DisclosureContentBodyProps,
  DisclosureContentProps,
  DisclosureProps,
} from "./disclosure.ariakit.react.tsx";
import {
  Disclosure,
  DisclosureButton,
  DisclosureButtonLabel,
  DisclosureContent,
  DisclosureContentBody,
} from "./disclosure.ariakit.react.tsx";

export const nav = cv({
  extend: [frame],
  class: [
    // Rows use the root gap; adjacent groups add their own spacing. Pack them
    // at the start so a stretched nav does not spread its rows.
    "nav content-start gap-(--nav-gap) min-w-0",
    // Gap defaults the variants override through the style attribute.
    "[--nav-gap:--spacing(1)]",
    "[--nav-group-gap:--spacing(4)]",
    // The gap between a row's icon slot and its label, on a disclosure row
    // and on a plain row alike.
    "[--nav-row-gap:--spacing(3)]",
    // A row's padding, and where its content starts past its edge: the
    // control's default padding and its optical side padding on top (see
    // --py and --px in text-frame.ts). Both are measured in the nav's own line
    // box and font and registered as lengths (see ui.css), so a group
    // label in smaller text pads like a row and insets its text to the same
    // pixel.
    "[--nav-py:--spacing(2)]",
    "[--nav-px:calc(var(--nav-py)+(1lh-1cap)*0.5)]",
    // The box a glider positions against, and a stacking context that keeps
    // the glider's place in the paint order inside the nav.
    "relative isolate [--glider-padding:var(--ak-frame-padding)]",
  ],
  style: {
    anchorName: "--glider-frame",
    // A glider follows the rows through the first three names and finds the
    // guide line beside the row through the others (see navGlider). The scope
    // keeps them to this nav, so a glider never lands in another one.
    anchorScope:
      "--glider-frame, --glider-hover, --glider-focus, --glider-selected, --disclosure-guide-hover, --disclosure-guide-focus, --disclosure-guide-selected",
  },
  variants: {
    /**
     * Arranges top-level links in a column or one scrolling row. Groups and
     * disclosures keep their own vertical layout. Defaults to `vertical`.
     */
    $layout: {
      vertical: "vertical grid",
      horizontal:
        "horizontal flex items-start overflow-x-auto overscroll-x-contain [clip-path:inset(-100vmax_0)] [&>.control,&>.nav-list>li>.control]:shrink-0 [&>.control,&>.nav-list>li>.control]:whitespace-nowrap",
    },
    /**
     * Sets the space between rows. Numbers scale the spacing token.
     */
    $gap(value?: string | number) {
      if (value == null) return;
      return {
        style: { "--nav-gap": getSpacingValue(value) },
      };
    },
    /**
     * Sets the space between groups. Numbers scale the spacing token.
     */
    $groupGap(value?: string | number) {
      if (value == null) return;
      return {
        style: { "--nav-group-gap": getSpacingValue(value) },
      };
    },
    /**
     * Sets the icon slot size for nav icons and nav disclosures. It must live
     * on the root or an ancestor: the consumers read it as an inherited
     * property or through container style queries, which read the nearest
     * ancestor container. Numbers scale the spacing token.
     */
    $iconSize(value?: string | number) {
      if (value == null) return;
      return {
        style: { "--nav-icon-size": getSpacingValue(value) },
      };
    },
  },
  defaultVariants: {
    $layout: "vertical",
    $layer: "transparent",
    $rounded: "md",
    $p: "none",
  },
});

export const navList = cv({
  // Disclosures keep a layout box for their indentation and vertical flow.
  class: "nav-list contents [&>li:not(.nav-disclosure)]:contents",
});

export const navGroup = cv({
  // The label sits one row gap over its list, on the rhythm of the rows.
  class:
    "nav-group grid content-start gap-(--nav-gap) shrink-0 [.nav.vertical>&+&]:mt-[calc(var(--nav-group-gap)-var(--nav-gap))] [.nav.horizontal>&+&]:ms-[calc(var(--nav-group-gap)-var(--nav-gap))]",
});

// The label of a group of rows. It takes the row padding above and below and
// starts its text where a row's content starts. Both lengths come from the nav
// (see --nav-py and --nav-px there): the label's own text is smaller, and the
// em-based spacing step would come out smaller in it.
export const navGroupLabel = cv({
  extend: [textFrame, text],
  class: ["ak-ink-60 font-medium text-[0.875em] text-start"],
  defaultVariants: {
    // The label pads like a row, with the lengths the nav measured in its own
    // font rather than the label's smaller one.
    $p: "var(--nav-py)",
    $px: "var(--nav-px)",
    $rounded: "md",
  },
});

// The icon slot of a nav row, sized by the nav's icon size. It is a control
// slot, so its outer box is one line square whatever the icon size: that is
// what keeps a wrapping label aligned to it. A standalone nav row, such as a
// brand link, can use it on its own.
export const navIcon = cv({
  extend: [buttonSlot],
  class: "[--size:var(--nav-icon-size,1em)]",
  defaultVariants: {
    // The size comes from the class above, not from a named step.
    $size: "unset",
  },
});

export const navLink = cv({
  extend: [button, selected],
  class: [
    "justify-start text-wrap",
    // Idle links on a dark layer read softer than their surface, and the
    // icon slot follows, because the ink inherits. The button's hover ink and
    // the selected ink below bring a row back to full strength.
    "ak-dark:ak-ink-70",
    // Links read as plain rows until they're current.
    "not-ui-selected:font-normal",
    // The row gap plus the control's extra side padding, which an icon slot
    // takes off, so a link with an icon lines up with the disclosure rows
    // around it. $gap is off below, so this is the only gap utility here.
    "gap-[calc(var(--nav-row-gap,--spacing(3))+var(--px)-var(--py))]",
  ],
  defaultVariants: {
    // Idle links sit flush with the surface around them; hover and current
    // still paint their own states.
    $lightnessOffset: false,
    $selectedPush: true,
    // Current links keep full text contrast on their pushed surface.
    $selectedInk: 100,
    $gap: "none",
  },
});

// Shared row alignment for disclosure buttons and standalone navigation links.
export const navButton = cv({
  class: [
    // A row fills its list item. A button element would otherwise shrink to
    // its content, and a trailing slot would stop short of the row's end.
    "w-full justify-start overflow-clip whitespace-normal text-start",
    // Every row keeps the one gap, plus the control's extra side padding
    // that an icon slot takes off, with the nav's default for a row outside
    // a nav, such as a brand row. Important, because a disclosure
    // button spends its own gap channel on the same property.
    "gap-[calc(var(--nav-row-gap,--spacing(3))+var(--px)-var(--py))]!",
  ],
});

export const navButtonContent = cv({
  class: "block overflow-hidden",
});

// A cover takes the box of the row it follows. It is placed from the top: a
// disclosure opening above the row moves the row, and a bottom inset, measured
// from the nav's moving end, would turn that into a travel of its own.
const navGliderCover = cx(
  "inset-s-[anchor(start)] top-[anchor(top)]",
  "w-[anchor-size()] h-[anchor-size()]",
);

// A glider that follows the rows of a nav, wherever they sit: in the nav's own
// list, in a group or in a disclosure. It is the nav's first child, so it
// paints under the rows, which are positioned and come after it, and it can
// travel from one list to another. The rows sit in list items, so the glider's
// own rules, which look for the control right beside it, are replaced by ones
// that look through the nav.
export const navGlider = cv({
  extend: [glider],
  class: [
    // At zero the glider paints over the surface behind the nav and under the
    // rows. A disclosure content paints no surface of its own in a nav (see
    // NavDisclosureContentBody), so a cover shows through it. Two gliders
    // paint in tree order: a later one over an earlier one.
    "z-0",
    // Firefox offsets an absolutely positioned anchor twice when its RTL
    // container scrolls. Fixed positioning follows the anchor's visible box.
    // The nav clips only its inline axis, so a bar can sit beyond its padding.
    "[.horizontal>&]:fixed!",
    // A row a disclosure is still revealing is clipped by the content around
    // it. The glider goes with the row while
    // none of it shows.
    "[position-visibility:anchors-visible]",
    // While a disclosure moves the rows, the nav says
    // so (see Nav), and the glider follows its row at once rather than easing
    // after it.
    "[.nav[data-settling]>&]:transition-none",
  ],
  variants: {
    /**
     * Sets how the glider is drawn. `flat` and `bevel` cover the row they
     * follow, while `bar` is a thin rule beside it, on the side `$side` picks.
     */
    $kind(value?: "flat" | "bevel" | "bar") {
      if (value === "flat") return navGliderCover;
      if (value === "bevel") return ["ui-bevel", navGliderCover];
      if (value !== "bar") return;
      return [
        "glider-bar",
        // The bar reads as an edge on top of the rows, not a surface behind
        // them, so it reverses the stacking the base class sets.
        "z-10",
        // Raw --contrast spans 0-100, so it must be normalized before
        // scaling the bar thickness, or high-contrast mode inflates the bar
        // from 2px to 42px.
        "[--glider-bar:calc(--spacing(0.5)+(--spacing(0.1))*var(--contrast)/100)]",
        "[.vertical>&]:top-[anchor(top)] [.vertical>&]:h-[anchor-size()] [.vertical>&]:w-(--glider-bar)",
        "[.vertical>&]:inset-e-[calc(anchor(start)+var(--glider-bar-offset))]",
        "[.vertical>&]:[&.glider-bar-end]:inset-e-auto",
        "[.vertical>&]:[&.glider-bar-end]:inset-s-[calc(anchor(end)+var(--glider-bar-offset))]",
        // An automatic start bar keeps the nearest disclosure guide when one
        // exists. Otherwise the gap comes from this nav's frame padding.
        "[.vertical>&]:[&.glider-bar-auto:not(.glider-bar-end)]:inset-e-auto",
        "[.vertical>&]:[&.glider-bar-auto:not(.glider-bar-end)]:inset-s-[calc(anchor(var(--glider-guide)_center,calc(anchor(start)-var(--glider-bar-offset)-var(--glider-bar)/2))-var(--glider-bar)/2)]",
        "[.vertical>&]:[&.glider-bar-frame]:inset-e-auto",
        "[.vertical>&]:[&.glider-bar-frame]:inset-s-0",
        "[.vertical>&]:[&.glider-bar-frame.glider-bar-end]:inset-s-auto",
        "[.vertical>&]:[&.glider-bar-frame.glider-bar-end]:inset-e-0",
        "[.horizontal>&]:left-[anchor(left)] [.horizontal>&]:w-[anchor-size()] [.horizontal>&]:h-(--glider-bar)",
        "[.horizontal>&]:top-[calc(anchor(bottom)+var(--glider-bar-offset))]",
        "[.horizontal>&]:[&.glider-bar-start]:top-auto",
        "[.horizontal>&]:[&.glider-bar-start]:bottom-[calc(anchor(top)+var(--glider-bar-offset))]",
        "[.horizontal>&]:[&.glider-bar-frame]:top-auto",
        "[.horizontal>&]:[&.glider-bar-frame]:bottom-[anchor(--glider-frame_bottom)]",
        "[.horizontal>&]:[&.glider-bar-frame.glider-bar-start]:bottom-auto",
        "[.horizontal>&]:[&.glider-bar-frame.glider-bar-start]:top-[anchor(--glider-frame_top)]",
        // Other engines can use this positioned nav's own frame edges. This
        // keeps document scrolling out of a second fixed-position anchor.
        "[@supports_not_(-moz-appearance:none)]:[.horizontal>&]:[&.glider-bar-frame]:absolute!",
        "[@supports_not_(-moz-appearance:none)]:[.horizontal>&]:[&.glider-bar-frame]:bottom-0",
        "[@supports_not_(-moz-appearance:none)]:[.horizontal>&]:[&.glider-bar-frame.glider-bar-start]:bottom-auto",
        "[@supports_not_(-moz-appearance:none)]:[.horizontal>&]:[&.glider-bar-frame.glider-bar-start]:top-0",
      ];
    },
    /**
     * Sets which row state the glider follows. A row publishes the matching
     * anchor name only while it is in that state, so the glider lands on
     * whichever row is hovered, focused, or current right now. A row is the
     * control right inside a list item anywhere in the nav after the glider: a
     * link, or a disclosure button, which a hover or focus glider follows too.
     * Only a link is current.
     */
    $state(value?: "none" | "hover" | "focus" | "selected") {
      // Each state names the guide used by automatic $barOffset (glider.ts). A
      // state without one names a guide nothing publishes, which keeps the bar
      // on the fallback: the dummy the rows carry is a real anchor.
      if (value === "none") return "[--glider-guide:--glider-no-guide]";
      if (value === "hover") {
        return [
          "[position-anchor:--glider-hover] ease-linear",
          "[--glider-guide:--disclosure-guide-hover]",
          "[&~.control,&~*_li>.control]:ui-hover:[--glider-hover:--glider-hover]",
          // The pointer is crossing the gap between two rows, so the glider
          // waits on the last one for the next instead of leaving at once.
          "[.nav:hover:not(:has(:is(li>.control,.nav>.control):hover))>&]:delay-250",
          // With no row under the pointer the anchor is gone, and a glider
          // that stayed would fall to a point at the nav's start. It leaves
          // instead, after the delay above.
          "[.nav:not(:has(:is(li>.control,.nav>.control):hover))>&]:hidden",
          // The glider sits behind the row it covers, so the row has to stop
          // painting its own surface or it hides the glider. A disclosure
          // button paints its hover as a gradient, which the second rule
          // takes off.
          "supports-anchor:[&~.control,&~*_li>.control]:ui-hover:bg-transparent!",
          "supports-anchor:[&~.control,&~*_li>.control]:ui-hover:bg-none!",
          "supports-anchor:[&~.control,&~*_li>.control]:ui-hover:border-transparent",
          "supports-anchor:[&~.control,&~*_li>.control]:ui-hover:befter:hidden",
        ];
      }
      if (value === "focus") {
        return [
          "[position-anchor:--glider-focus] focus",
          "[--glider-guide:--disclosure-guide-focus]",
          "[&~.control,&~*_li>.control]:ui-focus-visible:[--glider-focus:--glider-focus]",
          // The ring is drawn only while one of the rows has keyboard focus;
          // the row's own ring goes with it.
          "[&:has(~.control:is(:focus-visible,[data-focus-visible]),~*_li>.control:is(:focus-visible,[data-focus-visible]))]:outline-2",
          "supports-anchor:[&~.control,&~*_li>.control]:ui-focus-visible:outline-none",
          "ak-outline ak-outline-brand outline-offset-1",
        ];
      }
      if (value === "selected") {
        return [
          "[position-anchor:--glider-selected] selected",
          "[--glider-guide:--disclosure-guide-selected]",
          "[&~.control,&~*_li>.control]:ui-selected:[--glider-selected:--glider-selected]",
          // With no current row there is no anchor to land on, and the glider
          // would stay as a blank square at the nav's start. A current row in
          // a closed disclosure counts as none, from the moment the content
          // starts to close: the glider is outside the content, so it would
          // stay in view while the content folds up.
          "not-ui-nav-glider-selected:hidden",
        ];
      }
      return;
    },
    /**
     * Animates the glider as it travels between rows.
     */
    $animated(value?: boolean) {
      if (!value) return;
      return "duration-100 transition-discrete";
    },
  },
  defaultVariants: {
    // A cover takes the row's own radius; a bar has none (see glider.ts), and
    // keeps none inside a disclosure body, where a nested frame would round its
    // ends to stay concentric.
    $rounded(defaultValue, variants) {
      if (variants.$kind === "bar") return defaultValue;
      return "md";
    },
    $forceRounded(defaultValue, variants) {
      if (variants.$kind !== "bar") return defaultValue;
      return defaultValue ?? true;
    },
    // A selected cover takes the same pushed surface as the current row.
    $lightnessOffset(defaultValue, variants) {
      if (variants.$state !== "selected") return defaultValue;
      if (variants.$kind === "bar") return defaultValue;
      return false;
    },
    $lightnessPush(defaultValue, variants) {
      if (variants.$state !== "selected") return defaultValue;
      if (variants.$kind === "bar") return defaultValue;
      return defaultValue ?? true;
    },
    $border(defaultValue, variants) {
      if (variants.$state !== "selected") return defaultValue;
      if (variants.$kind === "bar") return defaultValue;
      return defaultValue ?? false;
    },
  },
  refine({ variants, addClass }) {
    if (variants.$animated) {
      // The insets are the longhands: WebKit passes over the inset-block and
      // inset-inline shorthands in a transition list. Only a hover glider keeps
      // display on the list, so it can wait out its delay before it leaves; a
      // current row's glider leaves at once with a closing disclosure.
      addClass(
        variants.$state === "hover"
          ? "transition-[top,left,inset-inline-start,inset-inline-end,border-color,height,width,outline,display]"
          : "transition-[top,left,inset-inline-start,inset-inline-end,border-color,height,width,outline]",
      );
    }
    if (variants.$state !== "selected") return;
    if (variants.$kind === "bar") return;
    // A cover takes over the row's surface. Beside a bar the row keeps its
    // surface, including any caller-provided edge.
    addClass([
      "supports-anchor:[&~.control,&~*_li>.control]:ui-selected:bg-transparent",
      "supports-anchor:[&~.control,&~*_li>.control]:ui-selected:ring-0",
      "supports-anchor:[&~.control,&~*_li>.control]:ui-selected:befter:hidden",
    ]);
  },
});

export const navDisclosure = cv({
  class: [
    "nav-disclosure",
    // Nav icons size the disclosure icon slot when an ancestor sets them.
    "[@container_style(--nav-icon-size)]:[--disclosure-icon-size:var(--nav-icon-size)]",
  ],
  style: {
    // The body indents by the row gap, the same one the button spends. The
    // style attribute is what beats the disclosure root's own gap.
    "--disclosure-gap": "var(--nav-row-gap, calc(var(--spacing) * 3))",
    // The body sits one nav gap under the button, the gap between rows, and the
    // guide starts there with it. The style attribute is what beats the root's
    // zero.
    "--disclosure-body-offset": "var(--nav-gap, calc(var(--spacing) * 1))",
  },
});

export const navDisclosureContentBody = cv({
  // frameBase, not frame: the body takes the radius, and any padding a caller
  // gives it, and paints nothing, so it must not open a layer of its own.
  extend: [frameBase],
  class: [
    "grid content-start gap-(--nav-gap)",
    // The rows are nested frames, so their radius is this one minus the body's
    // padding, which puts them on the disclosure's radius, the one its button
    // has, while a caller's padding stays under the frame system's 1rem cutoff
    // (see $p in frame.ts).
    "[--nav-body-radius:calc(var(--disclosure-radius)+var(--ak-frame-padding))]",
    // Pull a row back by its control inset so its text starts on the body. A
    // nested disclosure moves as a whole, so its guide stays under its leading
    // icon or indicator.
    "[&_li>.control:not(.disclosure-button)]:-ms-(--px)",
    "[&_li:has(>.disclosure-button)]:-ms-(--disclosure-px)",
    // A row can sit on an edge where the disclosure content clips: its end and
    // the last row's bottom while the body has no padding, and its start where
    // nothing indents the body (no guide, no leading icon), which a caller's
    // padding never changes. So rows here draw their focus ring inside their
    // box, like the disclosure button above them. This outranks a row's own
    // $focusOffset on purpose: an outset ring would be cut.
    "[&_li>.control]:-outline-offset-2",
  ],
  // No $p: the body pads nothing by itself, so its rows end where the button
  // ends and a bar or a cover on a row lands where it does on a top-level row.
  // The gap under the button comes from the disclosure (see navDisclosure), and
  // a caller's $p pads the rows inside it on every side but the start, which
  // keeps the label indent, with the content padding on, as a nav disclosure
  // keeps it by default.
  defaultVariants: {
    $forceRounded: true,
    $rounded: "var(--nav-body-radius)",
  },
});

// The stores of every NavDisclosure around a row, outermost first, so a current
// link can open all of them and not only the nearest one.
const NavDisclosureContext = React.createContext<readonly ak.DisclosureStore[]>([]);

/**
 * A glider for a nav, as `NavGlider` props or an element, or several of them in
 * an array, such as a hover cover followed by a cover of the current row: a
 * later glider paints over an earlier one. `true` renders the default glider, a
 * flat cover of the current row.
 */
export type NavGliderValue =
  | boolean
  | React.ReactElement
  | NavGliderProps
  | (React.ReactElement | NavGliderProps)[];

function renderGliders(value?: NavGliderValue) {
  if (!value) return null;
  if (value === true) return createRender(NavGlider);
  if (!Array.isArray(value)) return createRender(NavGlider, value);
  return value.map((item, index) => (
    <React.Fragment key={index}>{createRender(NavGlider, item)}</React.Fragment>
  ));
}

export interface NavProps extends ak.RoleProps<"nav">, VariantProps<typeof nav> {
  /**
   * The list that holds the rows, as an element or as `NavList` props. Set it
   * to `false` to render the children as they are, for a nav made of groups
   * that bring their own lists. Links with default items need a `NavList` or
   * another `ul`, `ol`, or `menu`; use `item={false}` for standalone links.
   */
  list?: React.ReactElement | NavListProps | false;
  /**
   * A glider that travels between the rows of the nav, in its own list, in a
   * group or in a disclosure alike, rendered before them.
   */
  glider?: NavGliderValue;
}

// The properties whose transitions move the rows of a nav when disclosure
// content opens or closes.
const ROW_MOVING_PROPERTIES = new Set(["height", "max-height"]);

/**
 * Marks the nav with `data-settling` while a transition inside it moves the
 * rows, so a glider stops easing after its row and follows it at once (see
 * navGlider). A glider's own transitions do not count. Native listeners: React
 * dispatches the end of a transition, but not its start.
 */
function useSettling(element: HTMLElement | null) {
  React.useEffect(() => {
    if (!element) return;
    let running = 0;
    const isRowMoving = (event: TransitionEvent) => {
      if (!ROW_MOVING_PROPERTIES.has(event.propertyName)) return false;
      // A capability check rather than instanceof: the target may come from
      // another realm.
      const target = event.target as Partial<Element> | null;
      return !target?.classList?.contains("glider");
    };
    const start = (event: TransitionEvent) => {
      if (!isRowMoving(event)) return;
      running += 1;
      element.setAttribute("data-settling", "");
    };
    const stop = (event: TransitionEvent) => {
      if (!isRowMoving(event)) return;
      running = Math.max(0, running - 1);
      if (running > 0) return;
      element.removeAttribute("data-settling");
    };
    element.addEventListener("transitionstart", start);
    element.addEventListener("transitionend", stop);
    element.addEventListener("transitioncancel", stop);
    return () => {
      element.removeEventListener("transitionstart", start);
      element.removeEventListener("transitionend", stop);
      element.removeEventListener("transitioncancel", stop);
      element.removeAttribute("data-settling");
    };
  }, [element]);
}

export function Nav({ list, glider, children, ...props }: NavProps) {
  const [variantProps, rest] = splitProps(props, nav);
  const [element, setElement] = React.useState<HTMLElement | null>(null);
  useSettling(element);
  return (
    <ak.Role.nav
      {...nav.jsx(variantProps)}
      {...rest}
      // The inner element takes the state setter as its ref, and Ariakit merges
      // it with the caller's ref and render element.
      render={<ak.Role.nav ref={setElement} render={rest.render} />}
    >
      {renderGliders(glider)}
      {list === false ? children : createRender(NavList, list, { children })}
    </ak.Role.nav>
  );
}

export interface NavListProps extends ak.RoleProps<"ul">, VariantProps<typeof navList> {}

export function NavList(props: NavListProps) {
  const [variantProps, rest] = splitProps(props, navList);
  return <ak.Role.ul {...navList.jsx(variantProps)} {...rest} />;
}

export interface NavGliderProps extends ak.RoleProps<"div">, VariantProps<typeof navGlider> {}

/**
 * Renders the element that glides between the rows of a `Nav` to mark the
 * current, hovered or focused one, as a cover of the row or as a bar beside it.
 * It goes before the rows, as the nav's first child, so it paints under them,
 * and it hides itself in browsers without CSS anchor positioning.
 */
export function NavGlider(props: NavGliderProps) {
  const [variantProps, rest] = splitProps(props, navGlider);
  return <ak.Role.div aria-hidden {...navGlider.jsx(variantProps)} {...rest} />;
}

export interface NavLinkProps extends ak.RoleProps<"a">, VariantProps<typeof navLink> {
  currentUrl?: string | URL;
  /**
   * The list item around the link. Set to `false` for a standalone link or an
   * existing item wrapper. All other props, including `ref` and `render`,
   * belong to the anchor. The default item needs a `NavList` or another `ul`,
   * `ol`, or `menu` parent, including inside disclosure content.
   */
  item?: React.ReactElement | ak.RoleProps<"li"> | false;
}

export function NavLink({ currentUrl, item, ...props }: NavLinkProps) {
  const [variantProps, rest] = splitProps(props, navLink);
  const isCurrent = isCurrentPage(currentUrl, rest.href);
  const disclosures = React.useContext(NavDisclosureContext);

  React.useEffect(() => {
    if (!isCurrent) return;
    for (const disclosure of disclosures) {
      disclosure.show();
    }
  }, [isCurrent, disclosures]);

  const link = (
    <ak.Role.a
      aria-current={isCurrent ? "page" : undefined}
      {...navLink.jsx(variantProps)}
      {...rest}
    />
  );
  if (item === false) return link;
  return createRender(ak.Role.li, item, { children: link });
}

export interface NavGroupProps extends ak.GroupProps, VariantProps<typeof navGroup> {}

export function NavGroup(props: NavGroupProps) {
  const [variantProps, rest] = splitProps(props, navGroup);
  return <ak.Group {...navGroup.jsx(variantProps)} {...rest} />;
}

export interface NavGroupLabelProps
  extends ak.GroupLabelProps, VariantProps<typeof navGroupLabel> {}

/**
 * Renders the label of a nav group, padded like a row and with its text
 * starting where the rows' content starts.
 */
export function NavGroupLabel(props: NavGroupLabelProps) {
  const [variantProps, rest] = splitProps(props, navGroupLabel);
  return <ak.GroupLabel {...navGroupLabel.jsx(variantProps)} {...rest} />;
}

export interface NavIconProps extends ak.RoleProps<"span">, VariantProps<typeof navIcon> {}

/**
 * Renders the icon slot of a nav row, sized by the Nav icon-size variable. It
 * keeps the line height so the label aligns with the icon.
 */
export function NavIcon(props: NavIconProps) {
  const [variantProps, rest] = splitProps(props, navIcon);
  return <ak.Role.span {...navIcon.jsx(variantProps)} {...rest} />;
}

export interface NavDisclosureProps extends DisclosureProps, VariantProps<typeof navDisclosure> {
  button?: React.ReactNode | NavDisclosureButtonProps;
  content?: React.ReactElement | NavDisclosureContentProps;
}

function NavDisclosureRoot(props: ak.RoleProps<"li">) {
  // Capture this disclosure's store before a nested provider can replace the
  // generic context, which also carries unrelated dialogs and popovers.
  const disclosure = ak.useDisclosureContext();
  const ancestors = React.useContext(NavDisclosureContext);
  const disclosures = React.useMemo(() => {
    if (!disclosure) return ancestors;
    return [...ancestors, disclosure];
  }, [ancestors, disclosure]);
  return (
    <NavDisclosureContext.Provider value={disclosures}>
      <ak.Role.li {...props} />
    </NavDisclosureContext.Provider>
  );
}

/**
 * A row of a `Nav` that discloses rows of its own. Its root paints no surface
 * by default: a nested section sits in a content that stacks over the nav's
 * gliders, so an opaque root would hide the covers of its rows.
 */
export function NavDisclosure({
  // Parameter defaults rather than props on the element below, so a value that
  // a caller forwards unset, as a wrapper with an optional prop does, still
  // lands on the row instead of reaching it as undefined.
  //
  // The row and its content are already spaced apart, so the button needs no
  // hover ramp between them.
  $contentPadding = true,
  // A nav row is a field-sized frame with control-sized padding.
  $rounded = "lg",
  $p = 2,
  $layer = "transparent",
  ...props
}: NavDisclosureProps) {
  const [variantProps, rest] = splitProps(props, navDisclosure);
  const button = createOptionalRender(NavDisclosureButton, rest.button);
  const content = createRender(NavDisclosureContent, rest.content);
  return (
    <Disclosure
      $contentPadding={$contentPadding}
      $rounded={$rounded}
      $p={$p}
      $layer={$layer}
      {...navDisclosure.jsx(variantProps)}
      {...rest}
      button={button}
      content={content}
      render={<NavDisclosureRoot render={rest.render} />}
    />
  );
}

export interface NavButtonProps extends ButtonProps, VariantProps<typeof navButton> {}

/**
 * Renders a standalone nav row. Use `NavButtonContent` for its label and the
 * `render` prop for a row that should be an anchor.
 */
export function NavButton(props: NavButtonProps) {
  const [variantProps, rest] = splitProps(props, navButton);
  return (
    <Button
      $rounded="lg"
      // The row sits flush with the surface around it, like a nav link.
      $lightnessOffset={false}
      {...navButton.jsx(variantProps)}
      {...rest}
    />
  );
}

export interface NavButtonContentProps extends ak.RoleProps<"span"> {}

/**
 * The label of a nav row.
 */
export function NavButtonContent(props: NavButtonContentProps) {
  const [variantProps, rest] = splitProps(props, navButtonContent);
  return <ak.Role.span {...navButtonContent.jsx(variantProps)} {...rest} />;
}

export interface NavDisclosureButtonProps
  extends DisclosureButtonProps, VariantProps<typeof navButton> {}

export function NavDisclosureButton({
  label,
  icon,
  indicator = isRenderable(icon) ? "chevron-right-end" : "chevron-right-start",
  ...props
}: NavDisclosureButtonProps) {
  const [variantProps, rest] = splitProps(props, navButton);
  const labelProps =
    label === undefined && isRenderable(rest.children) ? { children: rest.children } : label;
  const labelEl = createOptionalRender(DisclosureButtonLabel, labelProps);
  return (
    <DisclosureButton
      icon={icon}
      indicator={indicator}
      // The nav row spaces its icon and label through its own gap classes.
      $gap="none"
      {...navButton.jsx(variantProps)}
      {...rest}
      label={
        labelEl
          ? React.cloneElement(labelEl, {
              children: <NavButtonContent>{labelEl.props.children}</NavButtonContent>,
            })
          : null
      }
    >
      {label !== undefined && rest.children}
    </DisclosureButton>
  );
}

export interface NavDisclosureContentProps extends DisclosureContentProps {
  body?: React.ReactElement | NavDisclosureContentBodyProps;
}

export function NavDisclosureContent(props: NavDisclosureContentProps) {
  const body = createRender(NavDisclosureContentBody, props.body);
  return <DisclosureContent guide {...props} body={body} />;
}

export interface NavDisclosureContentBodyProps
  extends DisclosureContentBodyProps, VariantProps<typeof navDisclosureContentBody> {}

export function NavDisclosureContentBody(props: NavDisclosureContentBodyProps) {
  const [variantProps, rest] = splitProps(props, navDisclosureContentBody);
  return (
    <DisclosureContentBody
      // The body paints no surface of its own: a nav glider that covers a row
      // inside it paints under the content, and it has to show through.
      $layer="transparent"
      {...navDisclosureContentBody.jsx(variantProps)}
      {...rest}
    />
  );
}
