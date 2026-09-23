import { createRoot } from "react-dom/client";
import { ReviewWorkspace } from "../../src/review/review-workspace.tsx";

// Two animation frames mark a paint opportunity, not a physical display time.
function afterPaintOpportunity() {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

const metrics = { start: performance.now(), longTasks: [] };
window.scaleMetrics = metrics;
new PerformanceObserver((list) => {
  metrics.longTasks.push(
    ...list.getEntries().map((entry) => ({ start: entry.startTime, duration: entry.duration })),
  );
}).observe({ type: "longtask", buffered: true });

const count = Number(new URLSearchParams(location.search).get("count") || 3582);
const response = await fetch(`/model/${count}`);
if (!response.ok) {
  throw new Error(`Fixture model failed: ${response.status}`);
}
metrics.headers = performance.now();
const json = await response.text();
metrics.body = performance.now();
const model = JSON.parse(json);
metrics.modelReady = performance.now();
metrics.jsonBytes = new TextEncoder().encode(json).length;
metrics.captures = count;
metrics.items = model.items.length;
const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Fixture root is missing.");
}

let listSeen = false;
let imageSeen = false;
const observer = new MutationObserver(() => {
  // The shipped sidebar mounts at most one 50-item page.
  const expectedRows = Math.min(50, model.items.length);
  if (!listSeen && document.querySelectorAll(".review-item").length === expectedRows) {
    listSeen = true;
    metrics.listCommit = performance.now();
    afterPaintOpportunity().then(() => {
      metrics.listPaintOpportunity = performance.now();
    });
  }
  if (!imageSeen && document.querySelector('[data-evidence="ready"]')) {
    const candidate = document.querySelector('img[alt="New image"]');
    if (!candidate?.complete) return;
    if (candidate.naturalWidth !== 1280) return;
    imageSeen = true;
    metrics.imageReadyCommit = performance.now();
    afterPaintOpportunity().then(() => {
      metrics.imagePaintOpportunity = performance.now();
      metrics.domNodes = document.querySelectorAll("*").length;
      metrics.complete = true;
      observer.disconnect();
    });
  }
});
observer.observe(rootElement, { childList: true, subtree: true, attributes: true });
const root = createRoot(rootElement);
metrics.renderStart = performance.now();
root.render(
  <ReviewWorkspace
    model={model}
    commands={{
      save: async () => {
        throw new Error("Save is outside the local render evidence scope.");
      },
      undo: async () => {
        throw new Error("Undo is outside the local render evidence scope.");
      },
      refresh: async () => model,
    }}
  />,
);

window.scaleFixture = {
  async navigate(key) {
    const workspace = document.querySelector(".review-workspace");
    if (!workspace) {
      throw new Error("Review workspace is missing.");
    }
    workspace.focus();
    const previous = document.querySelector('[role="tab"][aria-selected="true"]')?.id;
    const ready = new Promise((resolve) => {
      const navigationObserver = new MutationObserver(() => {
        const selected = document.querySelector('[role="tab"][aria-selected="true"]')?.id;
        if (selected === previous) return;
        if (!document.querySelector('[data-evidence="ready"]')) return;
        navigationObserver.disconnect();
        resolve(performance.now());
      });
      navigationObserver.observe(workspace, { childList: true, subtree: true, attributes: true });
    });
    const resourcesBefore = performance.getEntriesByType("resource").length;
    const start = performance.now();
    workspace.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
    const readyCommit = await ready;
    await afterPaintOpportunity();
    return {
      key,
      start,
      readyCommitMs: readyCommit - start,
      paintOpportunityMs: performance.now() - start,
      resourceEntriesAdded: performance.getEntriesByType("resource").length - resourcesBefore,
      selected: document.querySelector('[role="tab"][aria-selected="true"]')?.id,
    };
  },
};
