import { pageVariants } from "./catalog-page-variants.ts";
import type { ScenarioEntry, SurfaceEntry } from "./types.ts";

// The six pages of the app. Round 1 settled the design of each one, and
// round 2 settled the five choices that were open in them.

const loading: ScenarioEntry = {
  id: "loading",
  label: "Loading",
  description: "The first load: the real header, then blocks with the size of the content.",
};

const pageEntries: SurfaceEntry[] = [
  {
    id: "sign-in",
    kind: "page",
    decision: "UI-SIGN-IN",
    title: "Sign in",
    question: "Which sign-in and access page do you prefer?",
    description: "What a person sees before the app can show data.",
    group: "Pages",
    status: "settled",
    scenarios: [
      { id: "guest", label: "Guest", description: "No session. The person can sign in." },
      { id: "signing-in", label: "Signing in", description: "GitHub sign-in is opening." },
      {
        id: "forbidden",
        label: "No access",
        description: "Signed in without write access to the repository.",
      },
      { id: "error", label: "Error", description: "The service did not answer." },
    ],
    variants: [],
  },
  {
    id: "inbox",
    kind: "page",
    decision: "UI-INBOX",
    title: "Queue",
    question: "Which Queue design do you prefer?",
    description: "The first page. It lists the runs that need a decision or attention.",
    group: "Pages",
    status: "settled",
    scenarios: [
      {
        id: "busy",
        label: "Busy",
        description: "Eight runs: to review, in progress, and needing attention.",
      },
      { id: "single", label: "One run", description: "One pull request waits for review." },
      { id: "empty", label: "All done", description: "No run needs a decision." },
      { id: "first-run", label: "First use", description: "No baseline and no runs yet." },
      loading,
      { id: "error", label: "Error", description: "The run list did not load." },
    ],
    variants: [],
  },
  {
    id: "history",
    kind: "page",
    decision: "UI-HISTORY",
    title: "History",
    question: "Which run history design do you prefer?",
    description: "Past runs with search and filters.",
    group: "Pages",
    status: "settled",
    scenarios: [
      {
        id: "full",
        label: "Full",
        description: "One hundred runs. Most are replaced attempts of the same pull requests.",
      },
      { id: "no-match", label: "No match", description: "The search has no results." },
      { id: "empty", label: "Empty", description: "No runs yet." },
      loading,
    ],
    variants: [],
  },
  {
    id: "status",
    kind: "page",
    decision: "UI-STATUS",
    title: "Status",
    question: "Which service status design do you prefer?",
    description: "Unresolved service alerts for maintainers.",
    group: "Pages",
    status: "settled",
    scenarios: [
      { id: "healthy", label: "Healthy", description: "No unresolved alerts." },
      { id: "alerts", label: "Alerts", description: "Three unresolved alerts." },
      loading,
      { id: "error", label: "Error", description: "The alerts did not load." },
    ],
    variants: [],
  },
  {
    id: "pull",
    kind: "page",
    decision: "UI-PULL",
    title: "Pull request",
    question: "Which pull request page do you prefer?",
    description: "The page that a GitHub check opens for one pull request.",
    group: "Pages",
    status: "settled",
    scenarios: [
      {
        id: "attempts",
        label: "Several attempts",
        description: "Three runs. The newest one needs review.",
      },
      { id: "single", label: "One run", description: "One run that passed." },
      { id: "no-runs", label: "No runs", description: "The pull request has no captures." },
      {
        id: "waiting",
        label: "Waiting",
        description: "The capture of the head commit is on its way.",
      },
      {
        id: "capture-failed",
        label: "Capture failed",
        description: "The capture failed in CI. The fix is a new workflow run.",
      },
      loading,
    ],
    variants: [],
  },
  {
    id: "review",
    kind: "page",
    decision: "UI-REVIEW",
    title: "Review workspace",
    question: "Which review workspace do you prefer?",
    description: "Where a maintainer compares screenshots and approves or rejects changes.",
    group: "Pages",
    status: "settled",
    // Every run has the production shape: 626 screenshots and 3,832 variants,
    // and almost all of them match the baseline.
    scenarios: [
      {
        id: "changes",
        label: "Typical",
        description: "A normal pull request: 3 of 626 screenshots changed, 9 variants need review.",
      },
      {
        id: "large",
        label: "Wide change",
        description: "A token change: 41 screenshots and 246 variants changed.",
      },
      {
        id: "one-browser",
        label: "One browser",
        description: "Only the WebKit variants of 12 screenshots changed.",
      },
      {
        id: "problems",
        label: "Mixed kinds",
        description: "Added, removed, resized, and failed variants.",
      },
      { id: "one-change", label: "One change", description: "A single changed variant." },
      {
        id: "probes",
        label: "Image sizes",
        description:
          "One screenshot for each image size, with a change of 1 pixel, of 2 by 2 pixels, and a real change.",
      },
      {
        id: "clean",
        label: "Nothing to review",
        description: "All 626 screenshots match the baseline.",
      },
      { id: "passed", label: "Passed", description: "Every change is approved." },
      { id: "read-only", label: "Read-only", description: "A newer run replaced this one." },
      { id: "comparing", label: "Comparing", description: "The comparison is still running." },
      loading,
    ],
    variants: [],
  },
];

function withPageVariants(surface: SurfaceEntry): SurfaceEntry {
  return { ...surface, variants: pageVariants[surface.id] ?? [] };
}

export const pages: SurfaceEntry[] = pageEntries.map(withPageVariants);
