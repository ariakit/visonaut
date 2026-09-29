import * as React from "react";
import * as ak from "@ariakit/react";
import {
  Shell,
  ShellHeader,
  ShellMain,
  ShellMainBody,
} from "@ui/components/shell.ariakit.react.tsx";
import { Frame } from "@ui/components/frame.ariakit.react.tsx";
import { Layer } from "@ui/components/layer.ariakit.react.tsx";
import { Button } from "@ui/components/button.ariakit.react.tsx";
import { Nav, NavLink } from "@ui/components/nav.ariakit.react.tsx";
import { TabProvider, TabList, Tab, TabPanel } from "@ui/components/tabs.ariakit.react.tsx";

const row: React.CSSProperties = {
  display: "flex",
  gap: 8,
  alignItems: "center",
  flexWrap: "wrap",
};
const column: React.CSSProperties = { display: "grid", gap: 12, minWidth: 0 };
const small: React.CSSProperties = { fontSize: 12, lineHeight: 1.5 };
const names = ["Dialog / open", "Button / focused", "Menu / expanded"];
const variants = ["Chrome · Light", "Chrome · Dark"];

type Verdict = "approved" | "rejected";
type Selection = { item: number; variant: number };

function Sample({ dark = false, changed = true }: { dark?: boolean; changed?: boolean }) {
  return (
    <Frame $layer={dark ? true : "canvas"} $border $rounded="lg" $p={4} style={{ minWidth: 210 }}>
      <div style={column}>
        <strong>Keep your changes?</strong>
        <p style={{ margin: 0, fontSize: 13 }}>Your dialog example is ready.</p>
        <div style={{ ...row, justifyContent: "flex-end" }}>
          <Button $kind="flat" tabIndex={-1}>
            Cancel
          </Button>
          <Button $layer="brand" tabIndex={-1} style={{ marginLeft: changed ? 8 : 0 }}>
            Save changes
          </Button>
        </div>
      </div>
    </Frame>
  );
}

function ReviewLayout({
  compact,
  compactExisting = false,
}: {
  compact: boolean;
  compactExisting?: boolean;
}) {
  const [selection, setSelection] = React.useState<Selection>({ item: 0, variant: 0 });
  const [verdicts, setVerdicts] = React.useState<Record<string, Verdict>>({});
  const [history, setHistory] = React.useState<Array<{ selection: Selection; previous?: Verdict }>>(
    [],
  );
  const [mode, setMode] = React.useState<"side" | "new">("side");
  const [details, setDetails] = React.useState(false);
  const key = `${selection.item}:${selection.variant}`;
  const pending = 6 - Object.keys(verdicts).length;
  const save = (verdict: Verdict) => {
    const next = { ...verdicts, [key]: verdict };
    setHistory([...history, { selection, previous: verdicts[key] }]);
    setVerdicts(next);
    for (let offset = 1; offset <= 6; offset++) {
      const index = (selection.item * 2 + selection.variant + offset) % 6;
      if (next[`${Math.floor(index / 2)}:${index % 2}`]) continue;
      setSelection({ item: Math.floor(index / 2), variant: index % 2 });
      break;
    }
  };
  const undo = () => {
    const entry = history.at(-1);
    if (!entry) return;
    const next = { ...verdicts };
    const oldKey = `${entry.selection.item}:${entry.selection.variant}`;
    if (entry.previous) next[oldKey] = entry.previous;
    else delete next[oldKey];
    setVerdicts(next);
    setSelection(entry.selection);
    setHistory(history.slice(0, -1));
  };
  const recovery = (
    <div style={row}>
      <span role="status" style={small}>
        {history.length ? "Saved in this example" : "No changes yet"}
      </span>
      <Button disabled={!history.length} onClick={undo}>
        Undo
      </Button>
    </div>
  );
  const actions = (
    <div style={row}>
      <Button $layer="brand" onClick={() => save("approved")}>
        Approve
      </Button>
      <Button $border onClick={() => save("rejected")}>
        Reject
      </Button>
      {(compact || compactExisting) && recovery}
    </div>
  );
  return (
    <Shell style={{ minHeight: 0, fontSize: 13 }}>
      <ShellHeader
        $sticky={false}
        $height={compact ? "sm" : "lg"}
        start={<strong>PR #482 · {pending} need review</strong>}
        end={
          <Button onClick={() => setDetails(!details)} aria-expanded={details}>
            Details
          </Button>
        }
      />
      <ShellMain render={<div />} $p={3} $maxWidth="100%">
        <ShellMainBody>
          <div style={column}>
            {!compact && (
              <Frame $border $p={3}>
                <strong>Run preview-482 · Attempt 1</strong>
                <p style={small}>Comparison 3 · Commit abc123</p>
              </Frame>
            )}
            {details && (
              <Frame $border $p={3}>
                <p style={small}>
                  Run preview-482 · Attempt 1 · Comparison 3. Local example only. No service command
                  is sent.
                </p>
              </Frame>
            )}
            <label style={row}>
              <span>Item</span>
              <select
                value={selection.item}
                onChange={(e) => setSelection({ item: Number(e.target.value), variant: 0 })}
              >
                {names.map((name, item) => (
                  <option key={name} value={item}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <div style={row}>
              {variants.map((name, variant) => (
                <Button
                  key={name}
                  $kind="flat"
                  aria-pressed={selection.variant === variant}
                  onClick={() => setSelection({ ...selection, variant })}
                >
                  {name}
                </Button>
              ))}
            </div>
            {!compact && !compactExisting && (
              <Frame $p={3}>
                <strong>{names[selection.item]}</strong>
                <p style={small}>
                  {variants[selection.variant]} · {verdicts[key] ?? "Needs review"}
                </p>
              </Frame>
            )}
            {actions}
            <div style={row}>
              <Button $kind="flat" aria-pressed={mode === "side"} onClick={() => setMode("side")}>
                Side by side
              </Button>
              <Button $kind="flat" aria-pressed={mode === "new"} onClick={() => setMode("new")}>
                New only
              </Button>
            </div>
            <Frame $layer $border $rounded="lg" $p={3} style={{ overflow: "auto" }}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: mode === "side" ? "repeat(2, minmax(210px, 1fr))" : "1fr",
                  gap: 12,
                }}
              >
                {mode === "side" && (
                  <div style={column}>
                    <span style={small}>Reference</span>
                    <Sample dark={selection.variant === 1} changed={false} />
                  </div>
                )}
                <div style={column}>
                  <span style={small}>New · proposed {verdicts[key] ?? "pending"} view</span>
                  <Sample dark={selection.variant === 1} />
                </div>
              </div>
            </Frame>
            {!compact && (
              <Frame $border $p={3}>
                <details>
                  <summary>Comparison details</summary>
                  <p style={small}>Image profile, policy, comparison identity</p>
                </details>
              </Frame>
            )}
            {!compact && !compactExisting && recovery}
            <p style={small}>
              Action scope: current variant. A local action advances to the next pending variant.
              Undo returns to the previous selection. Image panes are live component examples, not
              captured evidence.
            </p>
          </div>
        </ShellMainBody>
      </ShellMain>
    </Shell>
  );
}

function NavigationModel({
  native,
  automatic = false,
  routeId = "U03",
}: {
  native: boolean;
  automatic?: boolean;
  routeId?: "U03" | "U06";
}) {
  const [item, setItem] = React.useState(0);
  const [variant, setVariant] = React.useState("light");
  const [query, setQuery] = React.useState("");
  React.useEffect(() => {
    if (!native) return;
    const readRoute = () => {
      const route = new RegExp(`^#${routeId}-item-(\\d+)-(light|dark)$`).exec(window.location.hash);
      if (!route) return;
      setItem(Number(route[1]));
      setVariant(route[2]);
    };
    readRoute();
    window.addEventListener("hashchange", readRoute);
    return () => window.removeEventListener("hashchange", readRoute);
  }, [native, routeId]);
  const visible = names
    .map((name, index) => ({ name, index }))
    .filter((entry) => entry.name.toLowerCase().includes(query.toLowerCase()));
  const destination = native ? `#${routeId}-item-${item}-${variant}` : `#/example/${item}/${variant}`;
  return (
    <Frame $p={3} style={column}>
      <label style={column}>
        Find an item
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Try Dialog" />
      </label>
      {native ? (
        <Nav aria-label="Example review items">
          {visible.map((entry) => (
            <NavLink
              key={entry.index}
              href={`#${routeId}-item-${entry.index}-light`}
              aria-current={item === entry.index ? "page" : undefined}
            >
              {entry.name}
            </NavLink>
          ))}
        </Nav>
      ) : (
        <ak.CompositeProvider
          orientation="vertical"
          activeId={`example-item-${item}`}
          setActiveId={(id) => {
            if (id) setItem(Number(id.split("-").at(-1)));
          }}
        >
          <ak.Composite role="listbox" aria-label="Example review items" style={column}>
            {visible.map((entry) => (
              <ak.CompositeItem
                key={entry.index}
                id={`example-item-${entry.index}`}
                role="option"
                aria-selected={item === entry.index}
                render={<Button />}
                onClick={() => setItem(entry.index)}
              >
                {entry.name}
              </ak.CompositeItem>
            ))}
          </ak.Composite>
        </ak.CompositeProvider>
      )}
      {!visible.length && <p role="status">No matching items.</p>}
      {native ? (
        <TabProvider
          selectedId={`${routeId}-${variant}`}
          selectOnMove={false}
        >
          <TabList
            aria-label="Example variants"
            onKeyDownCapture={(event) => {
              if (!automatic) return;
              if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
              if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
              const list = event.currentTarget;
              const before = list.ownerDocument.activeElement;
              requestAnimationFrame(() => {
                const focused = list.ownerDocument.activeElement;
                if (focused === before || !(focused instanceof HTMLAnchorElement)) return;
                if (list.contains(focused)) focused.click();
              });
            }}
          >
            <Tab id={`${routeId}-light`} render={<a href={`#${routeId}-item-${item}-light`} />}>
              Chrome · Light
            </Tab>
            <Tab id={`${routeId}-dark`} render={<a href={`#${routeId}-item-${item}-dark`} />}>
              Chrome · Dark
            </Tab>
          </TabList>
          <TabPanel single>
            <Sample dark={variant === "dark"} />
          </TabPanel>
        </TabProvider>
      ) : (
        <>
          <ak.CompositeProvider
            orientation="horizontal"
            activeId={variant}
            setActiveId={(id) => {
              if (id) setVariant(id);
            }}
          >
            <ak.Composite role="listbox" aria-label="Example variants" style={row}>
              {["light", "dark"].map((id) => (
                <ak.CompositeItem
                  key={id}
                  id={id}
                  role="option"
                  aria-selected={variant === id}
                  render={<Button />}
                  onClick={() => setVariant(id)}
                >
                  Chrome · {id}
                </ak.CompositeItem>
              ))}
            </ak.Composite>
          </ak.CompositeProvider>
          <Sample dark={variant === "dark"} />
        </>
      )}
      <Layer $layer style={small}>
        <strong>
          {native
            ? automatic
              ? "Native links + automatic tabs"
              : "Native links + manual tabs"
            : "Option lists + selection follows focus"}
        </strong>
        <p>
          Selected: {names[item]} · {variant}
        </p>
        <p>
          Example route: <code>{destination}</code>
        </p>
        <p>
          {native
            ? automatic
              ? "Items and tabs are real links. An item opens its first pending variant (Light here). Left/Right focus and open a tab; modified clicks leave this page in place."
              : "Items and tabs are real links. An item opens its first pending variant (Light here). Left/Right focus a tab; Enter opens it."
            : "Use arrows in either list to change the selected result."}
        </p>
      </Layer>
    </Frame>
  );
}

function ArrowModel({ policy }: { policy: string }) {
  const [item, setItem] = React.useState(0);
  const [variant, setVariant] = React.useState(0);
  const [inspection, setInspection] = React.useState(false);
  const [pageWide, setPageWide] = React.useState(false);
  const [position, setPosition] = React.useState({ left: 0, top: 0 });
  const viewport = React.useRef<HTMLDivElement>(null);
  const workspace = React.useRef<HTMLDivElement>(null);
  const outerFocus = React.useRef<HTMLButtonElement>(null);
  const scrollOwned = policy === "focus-owned" || (policy === "pan-mode" && inspection);
  const pan = (left: number, top: number) => viewport.current?.scrollBy({ left, top });
  const move = React.useCallback(
    (event: KeyboardEvent | React.KeyboardEvent, includeOuter = false) => {
      if (event.key === "Escape" && inspection) {
        setInspection(false);
        workspace.current?.focus();
        return;
      }
      if (
        !includeOuter &&
        event.target !== viewport.current &&
        event.target !== workspace.current
      )
        return;
      if (event.target === viewport.current && scrollOwned) return;
      if (event.key === "ArrowDown") setItem((value) => Math.min(names.length - 1, value + 1));
      else if (event.key === "ArrowUp") setItem((value) => Math.max(0, value - 1));
      else if (event.key === "ArrowRight") setVariant((value) => Math.min(1, value + 1));
      else if (event.key === "ArrowLeft") setVariant((value) => Math.max(0, value - 1));
      else return;
      event.preventDefault();
    },
    [inspection, scrollOwned],
  );
  React.useEffect(() => {
    if (policy !== "global" || !pageWide) return;
    const owner = workspace.current?.ownerDocument;
    if (!owner) return;
    const onDocumentKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (
        target !== owner.body &&
        target !== outerFocus.current &&
        !workspace.current?.contains(target)
      )
        return;
      if (
        target instanceof Element &&
        target.closest('input, textarea, select, [contenteditable], [role="tablist"], [role="menu"]')
      )
        return;
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      move(event, true);
    };
    owner.addEventListener("keydown", onDocumentKeyDown);
    return () => owner.removeEventListener("keydown", onDocumentKeyDown);
  }, [move, pageWide, policy]);
  return (
    <div style={column}>
      {policy === "global" && (
        <Layer $layer style={{ ...row, padding: 8 }}>
          <Button aria-pressed={pageWide} onClick={() => setPageWide((value) => !value)}>
            {pageWide ? "Disable page-wide demo" : "Enable page-wide demo"}
          </Button>
          <Button ref={outerFocus}>Focus outside the review workspace</Button>
          <span style={small}>Enable, focus the outer button, then press Down or Right.</span>
        </Layer>
      )}
      <Frame
      $p={3}
      style={column}
      ref={workspace}
      tabIndex={0}
      aria-label="Keyboard ownership example"
      onKeyDown={(event) => {
        if (policy !== "global" || !pageWide) move(event);
      }}
    >
      <div style={row}>
        <Button onClick={() => viewport.current?.focus()}>Focus image</Button>
        <Button onClick={() => workspace.current?.focus()}>Focus review</Button>
        {policy === "pan-mode" && (
          <Button
            aria-pressed={inspection}
            onClick={() => {
              setInspection(!inspection);
              viewport.current?.focus();
            }}
          >
            {inspection ? "Leave inspection" : "Inspect image"}
          </Button>
        )}
      </div>
      <p style={small}>
        Focus the image, then press Down or Right.{" "}
        {policy === "focus-owned"
          ? "The image uses native arrow scrolling."
          : policy === "pan-mode"
            ? "Turn on inspection before panning with arrows. Escape leaves inspection."
            : "When the page-wide demo is enabled, arrows change the comparison from inside or outside the review workspace."}
      </p>
      <div style={row}>
        <Button aria-label="Pan example image left" onClick={() => pan(-100, 0)}>
          ←
        </Button>
        <Button aria-label="Pan example image right" onClick={() => pan(100, 0)}>
          →
        </Button>
        <Button aria-label="Pan example image up" onClick={() => pan(0, -100)}>
          ↑
        </Button>
        <Button aria-label="Pan example image down" onClick={() => pan(0, 100)}>
          ↓
        </Button>
      </div>
      <Frame
        $border
        $rounded="lg"
        ref={viewport}
        tabIndex={0}
        aria-label="Example image at 200 percent"
        style={{ height: 220, overflow: "auto" }}
        onScroll={(event) =>
          setPosition({
            left: Math.round(event.currentTarget.scrollLeft),
            top: Math.round(event.currentTarget.scrollTop),
          })
        }
      >
        <Layer
          $layer
          style={{
            width: 760,
            height: 520,
            padding: 30,
            boxSizing: "border-box",
            backgroundImage:
              "linear-gradient(90deg, #ffffff08 1px, transparent 1px), linear-gradient(#ffffff08 1px, transparent 1px)",
            backgroundSize: "32px 32px",
          }}
        >
          <p style={small}>Top left · 200% example canvas</p>
          <div style={{ width: 340, margin: "100px 0 0 180px" }}>
            <Sample dark={variant === 1} />
          </div>
          <p style={{ ...small, marginTop: 100 }}>Bottom of image</p>
        </Layer>
      </Frame>
      <Layer $layer style={small} aria-live="polite">
        Selected: {names[item]} · {variants[variant]}
        <br />
        Image position: x {position.left}, y {position.top}
        <br />
        Arrow owner in image: {scrollOwned ? "Image scroll" : "Review navigation"}
      </Layer>
      </Frame>
    </div>
  );
}

function DashboardModel({ policy }: { policy: string }) {
  const [opened, setOpened] = React.useState<string | null>(null);
  const [history, setHistory] = React.useState(false);
  const entries = [
    { id: "run-731", label: "PR #482 · Fix dialog focus", state: "Needs review" },
    { id: "run-730", label: "Main · abc123", state: "Passed" },
    { id: "run-729", label: "PR #479 · Simplify menu keys", state: "Failed capture" },
  ];
  const shown =
    policy === "task-first" && !history
      ? entries.filter((entry) => entry.state !== "Passed")
      : entries;
  return (
    <Frame $p={3} style={column}>
      <div style={{ ...row, justifyContent: "space-between" }}>
        <strong>
          {policy === "task-first"
            ? history
              ? "History"
              : "Review work"
            : policy === "github-entry"
              ? "Open review from GitHub"
              : "Latest 100 runs"}
        </strong>
        {policy === "task-first" && (
          <Button $kind="flat" onClick={() => setHistory((value) => !value)}>
            {history ? "Show review work" : "Show history"}
          </Button>
        )}
      </div>
      {policy === "github-entry" ? (
        <Frame $border $rounded="lg" $p={4}>
          <strong>PR #482 · Fix dialog focus</strong>
          <p style={small}>Visonaut — Changes need review</p>
          <Button onClick={() => setOpened("Pull request #482")}>Open review</Button>
        </Frame>
      ) : (
        <div style={column}>
          {shown.map((entry) => (
            <Frame key={entry.id} $border $rounded="lg" $p={3} style={row}>
              <Button $kind="flat" onClick={() => setOpened(entry.label)}>
                {entry.label}
              </Button>
              <span style={small}>{entry.state}</span>
              {policy === "recent-clear" && <code style={small}>{entry.id}</code>}
            </Frame>
          ))}
        </div>
      )}
      <p style={small}>
        {policy === "task-first"
          ? "The proposed server view returns actionable runs independently of bounded history. A title comes from existing verified PR data and stays outside capture identity."
          : policy === "recent-clear"
            ? "This bounded activity list does not claim to include every older pending run."
            : "GitHub is the work queue. The app only shows a linked review and recent activity."}
      </p>
      <Layer $layer style={small} role="status">
        {opened
          ? `Opened: ${opened}. The same review destination serves each approach.`
          : "Select a sample review to show its destination."}
      </Layer>
    </Frame>
  );
}

export function UiPrototype({ decisionId, optionId }: { decisionId: string; optionId: string }) {
  const [reset, setReset] = React.useState(0);
  return (
    <Frame $border $rounded="xl" style={{ overflow: "hidden", minWidth: 0 }}>
      <Frame $p={3} $layer style={row}>
        <strong style={small}>Interactive proposal · simulated data</strong>
        <Button onClick={() => setReset(reset + 1)}>Reset example</Button>
      </Frame>
      <div key={`${decisionId}:${optionId}:${reset}`}>
        {decisionId === "U01" || decisionId === "U02" ? (
          <ReviewLayout
            compact={optionId === "compose" || optionId === "single-shell"}
            compactExisting={decisionId === "U02" && optionId === "compact-existing"}
          />
        ) : null}
        {decisionId === "U03" ? (
          <NavigationModel native={optionId === "nav-tabs"} automatic />
        ) : null}
        {decisionId === "U06" ? (
          <NavigationModel native automatic={optionId === "automatic"} routeId="U06" />
        ) : null}
        {decisionId === "U04" ? <ArrowModel policy={optionId} /> : null}
        {decisionId === "U05" ? <DashboardModel policy={optionId} /> : null}
      </div>
    </Frame>
  );
}
