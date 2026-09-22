import type { ReviewImage, ReviewModel, ReviewVariant } from "../model.ts";

function image(id: string, fill: string): ReviewImage {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><rect width="600" height="400" fill="#fff"/><rect x="120" y="90" width="360" height="220" rx="12" fill="${fill}"/><text x="150" y="140" font-family="sans-serif" font-size="24" fill="#222">Success dialog</text><rect x="150" y="185" width="250" height="10" fill="#adb5c1"/><rect x="150" y="210" width="210" height="10" fill="#adb5c1"/><rect x="320" y="250" width="125" height="35" rx="6" fill="#4c5d75"/><text x="360" y="273" font-family="sans-serif" font-size="14" fill="#fff">Done</text></svg>`;
  return {
    id,
    digest: id,
    url: `data:image/svg+xml,${encodeURIComponent(svg)}`,
    width: 600,
    height: 400,
  };
}

function variant(key: string, kind: ReviewVariant["kind"] = "changed"): ReviewVariant {
  return {
    id: `row-${key}`,
    key,
    label: `${key} · Chromium · Light · 1280 × 720`,
    kind,
    revision: 0,
    verdict: kind === "added" || kind === "removed" ? "approved" : null,
    source: kind === "added" || kind === "removed" ? "automatic" : null,
    reference: kind === "added" ? null : image(`${key}-reference`, "#edf0f5"),
    candidate: kind === "removed" ? null : image(`${key}-candidate`, "#e5edf7"),
    diff: kind === "added" || kind === "removed" ? null : image(`${key}-diff`, "#f33"),
    changedPixels: 120,
    ratio: 0.0005,
    engine: "rgba-v1",
    codec: "png-v1",
    policy: "test-policy",
    threshold: "0.0005",
  };
}

export function fixtureModel(): ReviewModel {
  return {
    run: {
      id: "run-42",
      kind: "pull_request",
      testedSha: "aabbccddeeff112233",
      attempt: 2,
      title: "Dialog focus styles",
      status: "Changes need review",
    },
    comparisonId: "comparison-2",
    comparisonRevision: 2,
    reviewReady: true,
    baselineRevision: 4,
    promotionId: null,
    items: [
      {
        key: "dialog/open",
        name: "Success dialog",
        variants: [
          variant("React"),
          variant("Solid"),
          variant("Dark"),
          variant("Contrast"),
          variant("Firefox"),
          variant("WebKit"),
          variant("Wide"),
        ],
      },
      { key: "menu/open", name: "Open menu", variants: [variant("Menu"), variant("Menu-dark")] },
      { key: "new/open", name: "New item", variants: [variant("Addition", "added")] },
      { key: "removed/open", name: "Removed item", variants: [variant("Removal", "removed")] },
    ],
  };
}
