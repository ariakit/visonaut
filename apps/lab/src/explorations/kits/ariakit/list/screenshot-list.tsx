import { cx } from "clava";
import { useEffect, useRef } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { Frame } from "../../../../components/ariakit/components/frame.ariakit.react.tsx";
import { Link } from "../../../../components/ariakit/components/link.ariakit.react.tsx";
import {
  Nav,
  NavDisclosure,
  NavDisclosureButton,
  NavLink,
  NavLinkContent,
  NavLinkDescription,
  NavLinkLabel,
  NavList,
  NavSlot,
} from "../../../../components/ariakit/components/nav.ariakit.react.tsx";
import type { NavGliderProps } from "../../../../components/ariakit/components/nav.ariakit.react.tsx";
import { TextFrame } from "../../../../components/ariakit/components/text-frame.ariakit.react.tsx";
import { Text } from "../../../../components/ariakit/components/text.ariakit.react.tsx";
import { formatCount } from "../../../../fixtures/index.ts";
import { SkeletonLine } from "../skeleton-line.tsx";
import { Skeleton } from "../surfaces.tsx";
import { tertiary } from "../tokens.ts";
import { ListField } from "./field.tsx";
import { defaultListFilter, listStatusLabels } from "./model.ts";
import { ScreenshotRow } from "./row.tsx";
import type { RowForm } from "./row.tsx";
import { thumbBox } from "./thumb.tsx";
import type { ScreenshotListState } from "./use-screenshot-list.ts";

// The bar of the selected row lies on the end edge of the list, which is the
// edge of the main panel beside it (`$barOffset="frame"` with `$side="end"`).
// So the scroll box reaches that edge, and the nav has the gutter.
// The bar is the only glider of this list. Each row draws its own hover
// surface, selected surface, and focus ring: with a hover glider, one key
// makes the browser compute the style of each row again (audit decision
// D-PERF-01).
const barGlider: NavGliderProps = { $kind: "bar", $side: "end", $barOffset: "frame" };

// The list is a frame with a gutter of two steps, so its rows and its field
// take the corner radius that is concentric with the surface around them:
// the shell of the page. It is the size container of the field.
const listRoot = "@container flex min-h-0 flex-1 flex-col gap-2";

// The rows scroll under the field. The box takes back the gutter of the list
// on its sides and at the bottom, so the rows scroll to the edge of the list.
// A scroll box clips at its padding edge, so it keeps a padding at the start
// and at the top: the focus ring of a row lies 3 px outside the row.
const scrollBox =
  "-mx-2 -mt-1 -mb-2 min-h-0 flex-1 overscroll-contain ps-2 pt-1 pb-2 [scrollbar-width:thin]";

// One column that takes the width of the list, so a long name is cut and
// does not push the end of its row out.
const oneColumn = "grid-cols-[minmax(0,1fr)]";
const disclosureContent = { body: { className: oneColumn } };

const rowSelector = "a[data-row]";

// The target of a key can be a node of another realm, so the code tests what
// the node can do and not its class.
function matchesSelector(target: EventTarget, selector: string): boolean {
  if (!("matches" in target)) return false;
  if (typeof target.matches !== "function") return false;
  return target.matches(selector) === true;
}

interface ListNoteProps {
  children: ReactNode;
  /** The label of the link that leaves the state. */
  action?: string;
  onAction?(): void;
}

/** One soft line in the place of the rows, with one link. */
function ListNote({ children, action, onAction }: ListNoteProps) {
  return (
    <TextFrame $p={2} className="me-2 flex flex-wrap items-baseline justify-between gap-x-3">
      <Text className={cx(tertiary, "tabular-nums")}>{children}</Text>
      {action && (
        <Link render={<button type="button" />} onClick={onAction}>
          {action}
        </Link>
      )}
    </TextFrame>
  );
}

const skeletonWidths = ["w-3/5", "w-2/5", "w-1/2", "w-2/3", "w-2/5"];

interface RowSkeletonsProps {
  form: RowForm;
  count: number;
  still?: boolean;
}

/**
 * The shape of the rows before they load. Each row is the row recipe around
 * skeleton bars, so a block is where its text will be and the list does not
 * move when the rows come.
 */
function RowSkeletons({ form, count, still }: RowSkeletonsProps) {
  return (
    <Nav aria-hidden render={<div />} className={cx(oneColumn, "pe-2")}>
      {Array.from({ length: count }, (_, index) => {
        const width = skeletonWidths[index % skeletonWidths.length];
        if (form === "plain") {
          return (
            <NavLink key={index} render={<div />}>
              <NavLinkLabel className="min-w-0 flex-1">
                <SkeletonLine soft still={still} className={width} />
              </NavLinkLabel>
            </NavLink>
          );
        }
        return (
          <NavLink key={index} render={<div />}>
            <Skeleton still={still} $rounded="md" className={thumbBox} />
            <NavLinkContent>
              <NavLinkLabel>
                <SkeletonLine still={still} className={width} />
              </NavLinkLabel>
              <NavLinkDescription>
                <SkeletonLine soft still={still} className="w-1/3" />
              </NavLinkDescription>
              <NavLinkDescription>
                <SkeletonLine soft still={still} className="w-20" />
              </NavLinkDescription>
            </NavLinkContent>
          </NavLink>
        );
      })}
    </Nav>
  );
}

export interface ScreenshotListProps {
  /** The state of the list, from `useScreenshotList`. */
  list: ScreenshotListState;
  className?: string;
}

/**
 * The screenshot list of the review page: the one field (the status select
 * and the search), and one row for each screenshot with a change. It shows
 * the changes by default, because 623 of 626 screenshots of a normal pull
 * request are not work. Each row has a crop of its change, and it is a link
 * to its place. Put it in the
 * sidebar, in a column with a fixed height: the rows scroll.
 * @example
 * const list = useScreenshotList(session);
 * <ShellSidebar $width="lg" $border={false} aria-label="Screenshots" render={<nav />}>
 *   <ScreenshotList list={list} />
 * </ShellSidebar>
 */
export function ScreenshotList({ list, className }: ScreenshotListProps) {
  const body = useRef<HTMLDivElement | null>(null);
  const { rows, comparing, families, selectedKey, filter } = list;
  // A list has one Tab stop: its selected row, or its first row.
  const inList = selectedKey != null && list.order.includes(selectedKey);
  const tabStopKey = inList ? selectedKey : (rows[0]?.key ?? null);

  // The selected row stays in view, and it keeps the focus of the list when
  // a key moves the selection.
  useEffect(() => {
    const box = body.current;
    if (!box || !selectedKey) return;
    const selected = box.querySelector<HTMLElement>(
      `${rowSelector}[data-row="${CSS.escape(selectedKey)}"]`,
    );
    if (!selected) return;
    // Only the list scrolls. `scrollIntoView` would also scroll the page
    // around a list that is not in view. The row stops at the padding of
    // the box, so its focus ring is in view and it keeps the gutter of the
    // list to the window edge.
    const boxStyle = getComputedStyle(box);
    const boxRect = box.getBoundingClientRect();
    const rowRect = selected.getBoundingClientRect();
    const top = boxRect.top + Number.parseFloat(boxStyle.paddingTop);
    const bottom = boxRect.bottom - Number.parseFloat(boxStyle.paddingBottom);
    if (rowRect.top < top) {
      box.scrollTop -= top - rowRect.top;
    } else if (rowRect.bottom > bottom) {
      box.scrollTop += rowRect.bottom - bottom;
    }
    const active = box.ownerDocument.activeElement;
    if (active === selected) return;
    if (!active?.matches(rowSelector)) return;
    if (!box.contains(active)) return;
    selected.focus({ preventScroll: true });
  }, [selectedKey, filter.status]);

  const focusRows = () => {
    const box = body.current;
    const target = box?.querySelector<HTMLElement>(`${rowSelector}[tabindex="0"]`);
    (target ?? box?.querySelector<HTMLElement>("a, button"))?.focus();
  };
  // Up and Down on a row. The page binds the same keys to `list.step` for
  // every other place, and it skips an event that a widget handled.
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented) return;
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (!matchesSelector(event.target, rowSelector)) return;
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    list.step(event.key === "ArrowDown" ? 1 : -1);
  };

  const filtered = filter.query.trim() !== "";
  const defaultStatus = filter.status === defaultListFilter.status;
  const empty = !rows.length && !comparing.length && !families;
  const shown = families ? list.order.length : rows.length;
  // The words of an empty list. The live region says the same words.
  let emptyNote = "Nothing left here";
  if (filtered) {
    emptyNote = "No matches";
  } else if (defaultStatus) {
    emptyNote = "No changes";
  }
  return (
    <Frame $p={2} className={cx(listRoot, className)}>
      <ListField
        list={list}
        onLeave={focusRows}
        onSubmit={() => {
          const first = list.order[0];
          if (first == null) return;
          list.select(first);
        }}
      />
      <div ref={body} onKeyDown={handleKeyDown} className={cx(scrollBox, "overflow-y-auto")}>
        {empty && filtered && (
          <ListNote action="Clear" onAction={() => list.setQuery("")}>
            {emptyNote}
          </ListNote>
        )}
        {empty && !filtered && defaultStatus && <ListNote>{emptyNote}</ListNote>}
        {empty && !filtered && !defaultStatus && (
          <ListNote action="Show changes" onAction={list.reset}>
            {emptyNote}
          </ListNote>
        )}
        {(rows.length > 0 || comparing.length > 0) && (
          <Nav
            render={<div role="group" aria-label="Screenshots" />}
            glider={barGlider}
            className={cx(oneColumn, "pe-2")}
          >
            {rows.map((item) => (
              <ScreenshotRow
                key={item.key}
                item={item}
                form="picture"
                familyLabel={list.labels.get(item.family) ?? item.family}
                selected={item.key === selectedKey}
                selectedVariantKey={item.key === selectedKey ? list.selectedVariantKey : null}
                tabStop={item.key === tabStopKey}
                onSelect={list.select}
              />
            ))}
            {comparing.length > 0 && (
              <NavDisclosure
                content={disclosureContent}
                open={list.comparingOpen}
                setOpen={list.setComparingOpen}
                button={
                  <NavDisclosureButton label="Comparing">
                    <NavSlot $kind="shortcut" className="ms-auto tabular-nums">
                      {formatCount(comparing.length)}
                    </NavSlot>
                  </NavDisclosureButton>
                }
              >
                {list.comparingOpen && (
                  <NavList>
                    {comparing.map((item) => (
                      <ScreenshotRow
                        key={item.key}
                        item={item}
                        form="plain"
                        familyLabel=""
                        selected={item.key === selectedKey}
                        selectedVariantKey={null}
                        tabStop={item.key === tabStopKey}
                        onSelect={list.select}
                      />
                    ))}
                  </NavList>
                )}
              </NavDisclosure>
            )}
          </Nav>
        )}
        {families && list.fallback && <ListNote>{listStatusLabels.unchanged}</ListNote>}
        {families && !list.familiesReady && <RowSkeletons form="plain" count={8} />}
        {families && list.familiesReady && (
          <Nav
            render={<div role="group" aria-label="Unchanged screenshots" />}
            glider={barGlider}
            className={cx(oneColumn, "pe-2")}
          >
            {families.map((group) => {
              const open = list.isFamilyOpen(group.family);
              return (
                <NavDisclosure
                  key={group.family}
                  content={disclosureContent}
                  open={open}
                  setOpen={(next) => list.setFamilyOpen(group.family, next)}
                  button={
                    <NavDisclosureButton label={group.label}>
                      <NavSlot $kind="shortcut" className="ms-auto tabular-nums">
                        {formatCount(group.items.length)}
                      </NavSlot>
                    </NavDisclosureButton>
                  }
                >
                  {open && (
                    <NavList>
                      {group.items.map((item) => (
                        <ScreenshotRow
                          key={item.key}
                          item={item}
                          form="plain"
                          familyLabel={group.label}
                          selected={item.key === selectedKey}
                          selectedVariantKey={null}
                          tabStop={item.key === tabStopKey}
                          onSelect={list.select}
                        />
                      ))}
                    </NavList>
                  )}
                </NavDisclosure>
              );
            })}
          </Nav>
        )}
      </div>
      <div role="status" className="sr-only">
        {empty ? emptyNote : formatCount(shown, "screenshot")}
      </div>
    </Frame>
  );
}

export interface ScreenshotListSkeletonProps {
  /** The number of rows. A normal pull request has 3. */
  count?: number;
  /** A still shape under an `ErrorBand`: nothing loads while the error shows. */
  still?: boolean;
  className?: string;
}

const emptyCounts = { changes: 0, "needs-review": 0, rejected: 0, approved: 0, unchanged: 0 };

/**
 * The shape of the list before its run loads: the real field, which takes no
 * input yet, and one block for each part of a row.
 * @example
 * <ScreenshotListSkeleton />
 */
export function ScreenshotListSkeleton({
  count = 3,
  still,
  className,
}: ScreenshotListSkeletonProps) {
  return (
    <Frame $p={2} className={cx(listRoot, className)}>
      <ListField
        disabled
        list={{
          filter: defaultListFilter,
          counts: emptyCounts,
          setStatus: () => {},
          setQuery: () => {},
        }}
      />
      <div className={cx(scrollBox, "overflow-hidden")}>
        <RowSkeletons form="picture" count={count} still={still} />
      </div>
    </Frame>
  );
}
