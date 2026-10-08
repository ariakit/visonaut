import type { DirectionEntry } from "./types.ts";

// The design directions. The lab has one: the design that the maintainer
// picked for all six pages.
export const directions: DirectionEntry[] = [
  {
    id: "ariakit",
    name: "Ariakit folio",
    tagline:
      "Visonaut as an Ariakit sibling: stock primitives, a desk with raised sheets, and one brand action for each view.",
    description:
      "The lab is one design. The six pages are the folio pages of round 1, changed as the notes say, with the 19 picked parts built into them. Round 2 settled the five choices that were open, and each page has the picked form.",
    principles: [
      "Stock primitives with their stock look: layout classes only, one base size, and stock size steps.",
      "Depth, not lines: desk, sheet, well. A border shows only where a surface ends.",
      "One brand action for each view, and a tint for each banner.",
      "One vocabulary: Queue, History, Status; run, screenshot, variant, change; and eight run states.",
      "Each fact has one place, and a shortcut in a control is dimmed text.",
    ],
  },
];
