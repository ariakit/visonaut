import { cx } from "clava";
import { Lock } from "lucide-react";
import {
  createContext,
  useContext,
  useEffect,
  useEffectEvent,
  useId,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import type { ReactNode } from "react";
import {
  Badge,
  BadgeLabel,
  BadgeSlot,
} from "../../../components/ariakit/components/badge.ariakit.react.tsx";
import { ButtonSlot } from "../../../components/ariakit/components/button.ariakit.react.tsx";
import type { ButtonSlotProps } from "../../../components/ariakit/components/button.ariakit.react.tsx";
import {
  Dialog,
  DialogDismiss,
  DialogHeading,
  DialogProvider,
  DialogScroll,
} from "../../../components/ariakit/components/dialog.ariakit.react.tsx";
import { Kbd } from "../../../components/ariakit/components/kbd.ariakit.react.tsx";
import { Text } from "../../../components/ariakit/components/text.ariakit.react.tsx";
import { overlayRoot, tertiary } from "./tokens.ts";

export interface ShortcutsValue {
  /** False when the person turned the keys off in the account menu. */
  enabled: boolean;
  setEnabled(enabled: boolean): void;
  /** The state of the Keys dialog. */
  open: boolean;
  setOpen(open: boolean): void;
  /** False outside a `ShortcutsProvider`: nothing can change the switch. */
  provided: boolean;
}

const fallback: ShortcutsValue = {
  enabled: true,
  setEnabled: () => {},
  open: false,
  setOpen: () => {},
  provided: false,
};

const ShortcutsContext = createContext<ShortcutsValue>(fallback);

// The keyboard switch is one setting for every page of the direction. The
// browser keeps it, and this module keeps it when the browser has no storage.
const switchStorageKey = "visonaut-lab:folio-keys";
const switchListeners = new Set<() => void>();
let switchHere: boolean | null = null;

function subscribeToSwitch(listener: () => void) {
  switchListeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    switchListeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function readSwitch() {
  if (switchHere != null) return switchHere;
  try {
    return window.localStorage.getItem(switchStorageKey) !== "off";
  } catch {
    return true;
  }
}

// The server cannot know, so it renders the page with the keys on.
function readSwitchOnServer() {
  return true;
}

function writeSwitch(enabled: boolean) {
  switchHere = enabled;
  try {
    window.localStorage.setItem(switchStorageKey, enabled ? "on" : "off");
  } catch {
    // Without storage, the switch lasts until the next load.
  }
  for (const listener of switchListeners) {
    listener();
  }
}

export interface ShortcutsProviderProps {
  children?: ReactNode;
}

/**
 * Holds the keyboard switch and the state of the Keys dialog for one page.
 * Key hints below it hide while the switch is off. The browser stores the
 * switch, so it is the same on every page. `FolioShell` renders one, so a
 * list page needs none of its own.
 */
export function ShortcutsProvider({ children }: ShortcutsProviderProps) {
  const enabled = useSyncExternalStore(subscribeToSwitch, readSwitch, readSwitchOnServer);
  const [open, setOpen] = useState(false);
  const value = useMemo(
    () => ({ enabled, setEnabled: writeSwitch, open, setOpen, provided: true }),
    [enabled, open],
  );
  return <ShortcutsContext.Provider value={value}>{children}</ShortcutsContext.Provider>;
}

/** The keyboard switch and the dialog state of the page. */
export function useShortcuts(): ShortcutsValue {
  return useContext(ShortcutsContext);
}

export interface ShortcutSlotProps extends Omit<ButtonSlotProps, "children"> {
  /** The keys of one chord, for example `["⇧", "A"]`. */
  keys: readonly string[];
}

/**
 * The key that a control prints at its end: the stock shortcut slot of
 * `Button` and `Tab`, with the key as dimmed text and no cap. It renders
 * nothing while the keyboard switch is off, so the control closes up.
 * @example
 * <Button $kind="bevel" $layer="brand">
 *   <ButtonLabel>Approve</ButtonLabel>
 *   <ShortcutSlot keys={["A"]} />
 * </Button>
 */
export function ShortcutSlot({ keys, ...props }: ShortcutSlotProps) {
  const { enabled } = useShortcuts();
  if (!enabled) return null;
  return (
    <ButtonSlot $kind="shortcut" aria-hidden {...props}>
      <kbd>{keys.join("")}</kbd>
    </ButtonSlot>
  );
}

/** One key as a person reads it (`A`), or the caps of one chord (`["⇧", "A"]`). */
export type ShortcutKey = string | readonly string[];

export interface ShortcutEntry {
  /** The keys of the row, each one a cap: `["↑", "↓"]`, or `[["⇧", "A"], ["⇧", "X"]]`. */
  keys: readonly ShortcutKey[];
  /** One to three words. */
  label: string;
}

export interface ShortcutGroup {
  title: string;
  items: readonly ShortcutEntry[];
  /** Puts the rows side by side on one line under the other groups. */
  inline?: boolean;
  /** The keys change a verdict, so a run that takes no decision refuses them. */
  decides?: boolean;
}

/**
 * The keys of the review page: the keys of the app today, and `W` and `O` for
 * the two modes that D-WORK-02 adds. `D` is the mask switch, not a mode.
 */
export const reviewKeyGroups: readonly ShortcutGroup[] = [
  {
    title: "Navigate",
    items: [
      { keys: ["↑", "↓"], label: "Screenshot" },
      { keys: ["←", "→"], label: "Variant" },
      { keys: ["1–6"], label: "Variant by number" },
      { keys: ["["], label: "List" },
    ],
  },
  {
    title: "Decide",
    decides: true,
    items: [
      { keys: ["A"], label: "Approve" },
      { keys: ["X"], label: "Reject" },
      // One chord for each row, so the caps column of this group is as wide
      // as the one of `Navigate` and the words of both groups align.
      { keys: [["⇧", "A"]], label: "Approve all" },
      { keys: [["⇧", "X"]], label: "Reject all" },
      { keys: [["⌘", "Z"]], label: "Undo" },
    ],
  },
  {
    title: "View",
    inline: true,
    items: [
      { keys: ["F"], label: "Current" },
      { keys: ["G"], label: "Baseline" },
      { keys: ["S"], label: "Side by side" },
      { keys: ["W"], label: "Swipe" },
      { keys: ["O"], label: "Overlay" },
      { keys: ["D"], label: "Mask" },
    ],
  },
];

interface KeyCapsProps {
  keys: readonly ShortcutKey[];
  /** The keys do nothing now: outlined caps. */
  soft?: boolean;
}

// The caps of one row: stock `Kbd` caps, with the caps of a chord close
// together.
function KeyCaps({ keys, soft }: KeyCapsProps) {
  const layer = soft ? "transparent" : undefined;
  return (
    <span className="inline-flex items-center gap-1.5">
      {keys.map((key) => {
        const caps = typeof key === "string" ? [key] : key;
        return (
          <span key={caps.join("+")} className="inline-flex items-center gap-0.5">
            {caps.map((cap) => (
              <Kbd key={cap} $layer={layer}>
                {cap}
              </Kbd>
            ))}
          </span>
        );
      })}
    </span>
  );
}

interface KeyGroupSectionProps {
  group: ShortcutGroup;
  /** Every row is soft: the keys are off, or the run refuses them. */
  soft: boolean;
  /** The run takes no decision, and this group decides. */
  refused: boolean;
}

function KeyGroupSection({ group, soft, refused }: KeyGroupSectionProps) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      className={cx("grid content-start gap-2", group.inline && "@md:col-span-2")}
    >
      <div className="flex h-lh items-center gap-2">
        <Text id={headingId} render={<h3 />} className={cx(tertiary, "text-xs font-medium")}>
          {group.title}
        </Text>
        {refused && (
          <Badge $forceRounded>
            <BadgeSlot>
              <Lock />
            </BadgeSlot>
            <BadgeLabel>Read-only</BadgeLabel>
          </Badge>
        )}
      </div>
      <dl
        className={
          group.inline
            ? "flex flex-wrap gap-x-4 gap-y-2"
            : // The caps column is as wide as its widest row, so the words align.
              "grid grid-cols-[auto_1fr] gap-x-4 gap-y-2"
        }
      >
        {group.items.map((item) => (
          <div
            key={item.label}
            className={
              group.inline
                ? "flex items-center gap-2"
                : "col-span-2 grid grid-cols-subgrid items-center"
            }
          >
            <dt className="flex">
              <KeyCaps keys={item.keys} soft={soft} />
            </dt>
            <dd className={cx("min-w-0 truncate", soft && "ak-ink-50")}>{item.label}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export interface KeyListProps {
  groups: readonly ShortcutGroup[];
  /** The run takes no decision: the groups that decide are soft and say so. */
  readOnly?: boolean;
  className?: string;
}

/**
 * The short list of every key of a page: the groups side by side when the
 * place is wide enough, and an `inline` group on one line under them. The
 * rows are soft while the keyboard switch is off.
 * @example
 * <KeyList groups={reviewKeyGroups} readOnly={session.readOnly} />
 */
export function KeyList({ groups, readOnly = false, className }: KeyListProps) {
  const { enabled } = useShortcuts();
  return (
    <div className={cx("@container", className)}>
      <div className="grid content-start gap-x-8 gap-y-5 @md:grid-cols-2">
        {groups.map((group) => {
          const refused = readOnly && !!group.decides;
          return (
            <KeyGroupSection
              key={group.title}
              group={group}
              soft={!enabled || refused}
              refused={refused}
            />
          );
        })}
      </div>
    </div>
  );
}

export interface ShortcutsDialogProps {
  groups: readonly ShortcutGroup[];
  /** The run takes no decision. */
  readOnly?: boolean;
}

/**
 * The dialog `Keys`: the list of every key of the page. The item `Keys` of
 * the account menu opens it. Render it one time for each page, inside a
 * `ShortcutsProvider`. The switch that turns the keys off is in the account
 * menu, not here.
 * @example
 * <ShortcutsDialog groups={reviewKeyGroups} readOnly={session.readOnly} />
 */
export function ShortcutsDialog({ groups, readOnly }: ShortcutsDialogProps) {
  const { open, setOpen } = useShortcuts();
  return (
    <DialogProvider open={open} setOpen={setOpen}>
      <Dialog unmountOnHide className={cx(overlayRoot, "flex max-w-xl flex-col gap-4")}>
        <div className="flex items-center justify-between gap-2">
          <DialogHeading className="text-lg font-semibold">Keys</DialogHeading>
          <DialogDismiss $size="sm" aria-label="Close" />
        </div>
        <DialogScroll>
          <KeyList groups={groups} readOnly={readOnly} />
        </DialogScroll>
      </Dialog>
    </DialogProvider>
  );
}

// Text fields, menus, and dialogs keep their own keys.
const ignoredTargets = [
  "input",
  "textarea",
  "select",
  '[contenteditable]:not([contenteditable="false"])',
  '[role="textbox"]',
  '[role="combobox"]',
  '[role="listbox"]',
  '[role="slider"]',
  '[role="menu"]',
  '[role="menubar"]',
  '[role="dialog"]',
  '[role="alertdialog"]',
  "[data-shortcuts-ignore]",
].join(", ");

function getTargetElement(event: KeyboardEvent): Element | null {
  const { target } = event;
  if (!target) return null;
  if (!("nodeType" in target)) return null;
  if (target.nodeType !== 1) return null;
  // The node type check proves an element. It works across documents, where
  // an `instanceof` check fails.
  return target as Element;
}

/** True when the key event belongs to a text field, a menu, or a dialog. */
export function isTypingEvent(event: KeyboardEvent): boolean {
  const element = getTargetElement(event);
  if (!element) return true;
  return element.closest(ignoredTargets) != null;
}

/** Return false to leave the key to the browser. */
export type PageKeyHandler = (event: KeyboardEvent) => void | boolean;

export interface PageKeysOptions {
  /** Default: true. The keys are also off while the keyboard switch is off. */
  enabled?: boolean;
}

/**
 * Binds keys on the document for a page that is alone in its document. The
 * map takes the lowercase `event.key`: `j`, `enter`, `/`, `?`, `arrowdown`.
 * It ignores keys in text fields, menus, and dialogs, keys with Meta,
 * Control, or Alt, and events that a widget already handled.
 * @example
 * usePageKeys({ "[": () => setListOpen(!listOpen) });
 */
export function usePageKeys(keys: Record<string, PageKeyHandler>, options: PageKeysOptions = {}) {
  const shortcuts = useShortcuts();
  const active = (options.enabled ?? true) && shortcuts.enabled;
  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (event.defaultPrevented) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (isTypingEvent(event)) return;
    const key = event.key.toLowerCase();
    if (!Object.hasOwn(keys, key)) return;
    const handler = keys[key];
    if (!handler) return;
    if (handler(event) === false) return;
    event.preventDefault();
  });
  useEffect(() => {
    if (!active) return;
    const listener = (event: KeyboardEvent) => onKeyDown(event);
    document.addEventListener("keydown", listener);
    return () => document.removeEventListener("keydown", listener);
  }, [active]);
}
