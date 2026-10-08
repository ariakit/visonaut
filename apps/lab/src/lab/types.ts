import type { ComponentType } from "react";

/** A page is a full-viewport design. A component is one part shown in its states. */
export type SurfaceKind = "page" | "component";

export type LabTheme = "dark" | "light";

/**
 * What the fixtures send to a variant.
 *
 * - `decided`: the fields of today and the fields that the audit answers add,
 *   for example pull request titles and the reason that a run closed.
 * - `today`: exactly the fields that production sends today.
 * - `improved`: every proposed API addition, for example run counts, display
 *   names, and thumbnails.
 */
export type LabDataMode = "decided" | "today" | "improved";

/** One state that every variant of a surface must render. */
export interface ScenarioEntry {
  id: string;
  label: string;
  /** What the state shows, in one short sentence. */
  description?: string;
}

/** A coherent design language that spans several pages. */
export interface DirectionEntry {
  id: string;
  name: string;
  /** One line that tells this direction apart from the others. */
  tagline: string;
  description: string;
  principles: string[];
}

export interface VariantEntry {
  /** Unique in its surface. It is also the file name of the variant module. */
  id: string;
  name: string;
  /** One plain sentence that says what is different. */
  summary: string;
  /** The direction that this variant belongs to, when it has one. */
  direction?: string;
  /** The design ideas to look at. */
  ideas: string[];
  tradeoffs?: string[];
}

export interface SurfaceEntry {
  /** Stable identifier. It is also the folder name of the variant modules. */
  id: string;
  kind: SurfaceKind;
  /** Stable decision identifier for feedback, for example `UI-INBOX`. */
  decision: string;
  title: string;
  /** The question that the maintainer answers by picking a variant. */
  question: string;
  description: string;
  /** Gallery group, for example `Pages`. */
  group: string;
  /**
   * `settled` means that the record already has the answer: the surface shows
   * the pick and takes notes only. Absent means `open`.
   */
  status?: "settled" | "open";
  scenarios: ScenarioEntry[];
  variants: VariantEntry[];
  /**
   * How the component explorer lays out one variant across its scenarios.
   * `row` puts the states side by side. `stack` gives each state the full width.
   */
  layout?: "row" | "stack";
}

/** One group of the gallery. A surface names its group in `group`. */
export interface GroupEntry {
  name: string;
  /** One short sentence that says what the surfaces of the group are. */
  description: string;
}

export interface Catalog {
  directions: DirectionEntry[];
  /** The groups of the gallery, in the order of the gallery. */
  groups: GroupEntry[];
  surfaces: SurfaceEntry[];
}

/**
 * Props of every variant module default export. A page variant fills the
 * viewport. A component variant renders at its natural size.
 */
export interface VariantProps {
  /** One of the scenario identifiers of the surface. */
  scenario: string;
}

export type VariantComponent = ComponentType<VariantProps>;

/** The shape of a module under `src/explorations/{pages,components}`. */
export interface VariantModule {
  default: VariantComponent;
}

/** Global look controls. Every preview applies them through root attributes. */
export interface LabKnobs {
  theme: LabTheme;
  /** Brand color preset. */
  brand: string;
  /** Canvas tone preset. */
  canvas: string;
  /** Corner radius preset. */
  radius: string;
  /** Spacing density preset. */
  density: string;
  /** The data mode of the fixtures. It does not change the look. */
  data: LabDataMode;
}
