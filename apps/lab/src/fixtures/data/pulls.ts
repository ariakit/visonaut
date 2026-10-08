import type { User } from "../types.ts";
import { people } from "./people.ts";

/**
 * The facts of one pull request that the datasets share. Production sends
 * only the number. The title, the author, and the branch exist in `improved`
 * mode only.
 */
export interface PullSeed {
  number: number;
  title: string;
  author: User;
  branch: string;
}

/** The pull requests with a fixed role in a scenario. */
export const pulls = {
  // The review scenario `problems`, and the pull request scenario `attempts`.
  mixed: {
    number: 7754,
    title: "Add a loading state to Button and remove the dimmed variant",
    author: people.sofia,
    branch: "feat/button-loading",
  },
  // The review scenario `one-browser`.
  safari: {
    number: 7753,
    title: "Fix Link underline offset in Safari",
    author: people.priya,
    branch: "fix/link-underline-safari",
  },
  // The review scenarios `large` (attempt 2) and `read-only` (attempt 1).
  token: {
    number: 7752,
    title: "Increase the letter spacing token of example headings",
    author: people.amara,
    branch: "refactor/heading-tracking-token",
  },
  // The review scenario `changes`.
  typical: {
    number: 7751,
    title: "Use the semibold weight for Button labels",
    author: people.theo,
    branch: "fix/button-label-weight",
  },
  // The review scenario `comparing`. A long title and a long branch name
  // stress truncation and wrapping.
  comparing: {
    number: 7755,
    title:
      "Fix a regression where the Combobox popover does not reposition after the virtual keyboard closes on iOS Safari when the input is inside a modal Dialog with nested portals",
    author: people.lucas,
    branch: "fix/combobox-popover-reposition-after-virtual-keyboard-closes-on-ios-safari",
  },
  // The review scenario `passed`, and the pull request scenario `single`.
  passed: {
    number: 7749,
    title: "Fix the weight of the selected segment in a segmented control",
    author: people.kenji,
    branch: "fix/segmented-control-weight",
  },
  // A failed run in the busy inbox.
  failed: {
    number: 7748,
    title: "Add forced colors styles to Checkbox and Radio",
    author: people.kenji,
    branch: "feat/forced-colors-choice",
  },
  // Two merged pull requests. Their main runs are open in the busy inbox.
  mergedStale: {
    number: 7747,
    title: "Heading: add the size of level 6",
    author: people.amara,
    branch: "feat/heading-level-6",
  },
  mergedCapturing: {
    number: 7745,
    title: "Fix Tooltip arrow color on a brand layer",
    author: people.sofia,
    branch: "fix/tooltip-arrow-brand",
  },
  // The review scenario `clean`: the run that the audit observed in production.
  clean: {
    number: 7746,
    title: "Update dependency @playwright/test to v1.63.0",
    author: people.renovate,
    branch: "renovate/playwright-monorepo",
  },
  // The review scenario `one-change`, and the inbox scenario `single`.
  oneChange: {
    number: 7756,
    title: "Fix the selected segment weight in the dark scheme",
    author: people.haz,
    branch: "fix/segment-weight-dark",
  },
  // The pull request scenario `no-runs`.
  docs: {
    number: 7757,
    title: "Docs: refresh the installation guide",
    author: people.priya,
    branch: "docs/installation",
  },
  // The pull request scenarios `waiting` and `capture-failed`.
  waiting: {
    number: 7758,
    title: "Move Tooltip closer to its anchor when the arrow is hidden",
    author: people.lucas,
    branch: "fix/tooltip-gutter",
  },
  // The review scenario `expired`.
  expired: {
    number: 7702,
    title: "Fix Select popover border radius in Safari",
    author: people.priya,
    branch: "fix/select-popover-radius",
  },
  // The review scenario `probes`. It is not a production case.
  probes: {
    number: 7760,
    title: "Lab only: pixel probes for each image size class",
    author: people.haz,
    branch: "lab/pixel-probes",
  },
} satisfies Record<string, PullSeed>;

type ClosedPull = Omit<PullSeed, "number">;

/**
 * Closed pull requests, newest first. The run history takes its older rows
 * from this list and gives each one a number.
 */
export const closedPulls: ClosedPull[] = [
  {
    title: "Toolbar: keep the pressed style on toggle buttons",
    author: people.sofia,
    branch: "fix/toolbar-pressed",
  },
  {
    title: "Refactor Form field spacing tokens",
    author: people.amara,
    branch: "refactor/form-spacing",
  },
  {
    title: "Fix Disclosure content height when the text wraps",
    author: people.theo,
    branch: "fix/disclosure-height",
  },
  {
    title: "Add sortable columns to the data table example",
    author: people.kenji,
    branch: "feat/table-sort",
  },
  {
    title: "Button: adjust the primary color for better contrast",
    author: people.amara,
    branch: "fix/button-contrast",
  },
  {
    title: "Improve Hovercard timeout handling on touch devices",
    author: people.lucas,
    branch: "fix/hovercard-touch",
  },
  {
    title: "Fix composite typeahead with non-Latin characters",
    author: people.kenji,
    branch: "fix/typeahead-unicode",
  },
  {
    title: "Add `unmountOnHide` to TabPanel",
    author: people.haz,
    branch: "feat/tab-panel-unmount",
  },
  {
    title: "Menubar: support RTL arrow keys",
    author: people.priya,
    branch: "feat/menubar-rtl",
  },
  {
    title: "Remove deprecated `backdropProps` from Dialog",
    author: people.haz,
    branch: "chore/dialog-backdrop",
  },
  {
    title: "Fix Radio group focus when the checked item is disabled",
    author: people.theo,
    branch: "fix/radio-focus",
  },
  {
    title: "Update Solid examples to the new store API",
    author: people.sofia,
    branch: "chore/solid-store",
  },
  {
    title: "Fix Command Enter key on Firefox with IME composition",
    author: people.kenji,
    branch: "fix/command-ime",
  },
  {
    title: "Add Separator orientation styles",
    author: people.amara,
    branch: "feat/separator-orientation",
  },
  {
    title: "Fix Portal context with nested shadow roots",
    author: people.lucas,
    branch: "fix/portal-shadow-root",
  },
  {
    title: "Improve SelectValue fallback rendering",
    author: people.priya,
    branch: "fix/select-value",
  },
  {
    title: "Docs: add a guide for styling with Tailwind",
    author: people.haz,
    branch: "docs/tailwind-guide",
  },
  {
    title: "Fix Checkbox indeterminate icon alignment",
    author: people.theo,
    branch: "fix/checkbox-indeterminate",
  },
  {
    title: "Update dependency vite to v8.3.0",
    author: people.renovate,
    branch: "renovate/vite-8.x",
  },
  {
    title: "Fix Tooltip position inside a scrolled Dialog",
    author: people.sofia,
    branch: "fix/tooltip-in-dialog",
  },
  // A one-word title is the short edge case.
  { title: "wip", author: people.amara, branch: "wip" },
  {
    title: "Add `disclosure` prop to MenuButton examples",
    author: people.kenji,
    branch: "docs/menu-button",
  },
  {
    title: "Version Packages",
    author: people.bot,
    branch: "changeset-release/main",
  },
  {
    title: "Update Popover shadow tokens",
    author: people.haz,
    branch: "chore/popover-shadow",
  },
  {
    title: "Fix Tabs selection indicator position with a border",
    author: people.theo,
    branch: "fix/tabs-indicator-offset",
  },
  {
    title: "Nav: align the glider with wide icons",
    author: people.sofia,
    branch: "fix/nav-glider-wide-icons",
  },
  {
    title: "Add a ring variant to Progress",
    author: people.amara,
    branch: "feat/progress-ring",
  },
  {
    title: "Fix Badge count alignment in a heading",
    author: people.lucas,
    branch: "fix/badge-count-heading",
  },
  {
    title: "Table: keep the cell edge on hover in forced colors",
    author: people.kenji,
    branch: "fix/table-cell-edge-forced-colors",
  },
  {
    title: "Update dependency tailwindcss to v4.3.3",
    author: people.renovate,
    branch: "renovate/tailwindcss-4.x",
  },
  {
    title: "Shell: fix the sidebar width at the narrow breakpoint",
    author: people.priya,
    branch: "fix/shell-sidebar-narrow",
  },
  {
    title: "Kbd: derive the cap edge from the layer",
    author: people.theo,
    branch: "refactor/kbd-edge",
  },
  {
    title: "Fix Dialog scroll lock with a nested Popover",
    author: people.haz,
    branch: "fix/dialog-scroll-lock",
  },
  {
    title: "List: add the checked marker for items",
    author: people.sofia,
    branch: "feat/list-item-marker",
  },
  {
    title: "Input: keep the focus ring above a grouped control",
    author: people.lucas,
    branch: "fix/input-group-focus-ring",
  },
  {
    title: "Update dependency react to v19.3.0",
    author: people.renovate,
    branch: "renovate/react-monorepo",
  },
  {
    title: "Code: fix the line height of inline code in a heading",
    author: people.amara,
    branch: "fix/code-line-height",
  },
  {
    title: "Disclosure: animate the content height with a view transition",
    author: people.kenji,
    branch: "feat/disclosure-view-transition",
  },
];
