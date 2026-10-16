import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "../../styles.css";
import type { SessionItem, SessionVariant } from "../../components/kit/session.ts";
import { VariantPager } from "../../components/kit/variants/pager.tsx";
import { resetStoredView, useStoredView } from "../../components/kit/view-store.ts";

declare global {
  interface Window {
    /** Gives the pager another screenshot with these variant keys. A test calls it. */
    kitFixture: { setVariantKeys(keys: string[]): void };
    /** The router of the fixture. A test reads the location of the memory history from it. */
    kitRouter: { state: { location: { search: unknown; href: string } } };
  }
}

function createVariant(key: string, index: number): SessionVariant {
  return {
    id: `variant-${key}`,
    key,
    label: key,
    kind: "changed",
    revision: 0,
    verdict: null,
    source: null,
    reference: null,
    candidate: null,
    diff: null,
    itemKey: "screenshot",
    index,
    name: key,
    axes: {
      framework: "react",
      browser: "chromium",
      colorScheme: "light",
      contrast: "no-preference",
      forcedColors: "none",
    },
    status: "needs-review",
    automatic: false,
  };
}

function createItem(keys: string[]): SessionItem {
  return {
    key: "screenshot",
    name: "screenshot",
    label: "Screenshot",
    family: "screenshot",
    status: "needs-review",
    variants: keys.map(createVariant),
  };
}

function Harness() {
  const [keys, setVariantKeys] = useState(["first-a", "first-b", "first-c"]);
  useEffect(() => {
    window.kitFixture = { setVariantKeys };
  }, []);
  const item = createItem(keys);
  const [variant] = item.variants;
  if (!variant) return null;
  return <VariantPager item={item} variant={variant} />;
}

function ViewHarness() {
  const stored = useStoredView();
  return (
    <div>
      <output aria-label="View">{`${stored.mode} ${stored.mask ? "mask" : "no mask"}`}</output>
      <button onClick={() => stored.setMode("side")}>Side by side</button>
      <button onClick={() => stored.setMask(!stored.mask)}>Switch the mask</button>
      <button onClick={resetStoredView}>Reset the view</button>
    </div>
  );
}

const element = document.getElementById("root");
if (!element) throw new Error("Fixture root is missing.");
// `?part=view` renders the stored view in place of the pager.
const part = new URLSearchParams(window.location.search).get("part");
const router = createRouter({
  routeTree: createRootRoute({ component: part === "view" ? ViewHarness : Harness }),
  history: createMemoryHistory({ initialEntries: ["/?comparison=comparison-1"] }),
});
window.kitRouter = router;
createRoot(element).render(<RouterProvider router={router} />);
