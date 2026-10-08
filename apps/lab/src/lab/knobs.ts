import type { LabDataMode, LabKnobs } from "./types.ts";

export type KnobName = keyof LabKnobs;

export interface KnobOption {
  id: string;
  label: string;
}

export interface KnobDefinition {
  name: KnobName;
  label: string;
  /** One short sentence under the control, when the label is not enough. */
  description?: string;
  options: KnobOption[];
}

/**
 * The look controls. Each knob becomes a `data-*` attribute on the `html`
 * element, and `knobs.css` maps each value to Ariakit theme tokens.
 */
export const knobDefinitions: KnobDefinition[] = [
  {
    name: "theme",
    label: "Theme",
    options: [
      { id: "dark", label: "Dark" },
      { id: "light", label: "Light" },
    ],
  },
  {
    name: "brand",
    label: "Brand",
    options: [
      { id: "blue", label: "Blue" },
      { id: "violet", label: "Violet" },
      { id: "green", label: "Green" },
      { id: "orange", label: "Orange" },
      { id: "pink", label: "Pink" },
      { id: "mono", label: "Mono" },
    ],
  },
  {
    name: "canvas",
    label: "Canvas",
    options: [
      { id: "cool", label: "Cool" },
      { id: "neutral", label: "Neutral" },
      { id: "warm", label: "Warm" },
      { id: "black", label: "Black" },
      { id: "dim", label: "Dim" },
    ],
  },
  {
    name: "radius",
    label: "Radius",
    options: [
      { id: "sharp", label: "Sharp" },
      { id: "default", label: "Default" },
      { id: "round", label: "Round" },
    ],
  },
  {
    name: "density",
    label: "Density",
    options: [
      { id: "compact", label: "Compact" },
      { id: "default", label: "Default" },
      { id: "comfortable", label: "Comfortable" },
    ],
  },
  {
    // Not a look, but it travels the same way: the fixtures read it, and
    // every preview gets it in its URL.
    name: "data",
    label: "Data",
    description:
      "Decided API is production with the fields that the audit answers add. All proposed fields adds the others: counts, progress, authors, thumbnails.",
    options: [
      { id: "decided", label: "Decided API" },
      { id: "today", label: "API today" },
      { id: "improved", label: "All proposed fields" },
    ],
  },
];

export const knobNames: KnobName[] = knobDefinitions.map((definition) => definition.name);

/**
 * The knobs that Reset returns to their defaults. The theme has its own
 * toggle, and the data mode is not a look.
 */
export const resettableKnobNames: KnobName[] = knobNames.filter(
  (name) => name !== "theme" && name !== "data",
);

export const defaultKnobs: LabKnobs = {
  theme: "dark",
  brand: "blue",
  canvas: "cool",
  radius: "default",
  density: "default",
  data: "decided",
};

/** The values of the Data control, the default first. */
export const labDataModes: LabDataMode[] = ["decided", "today", "improved"];

/** True for a value of the Data control, for example from a URL. */
export function isDataMode(value: unknown): value is LabDataMode {
  return labDataModes.some((mode) => mode === value);
}

/**
 * The custom property on the `html` element that hides the content of one
 * data mode. Its value is `hidden` for every mode but the current one. See
 * `useDataGate` in `knob-store.ts`.
 */
export function getDataGateProperty(mode: LabDataMode) {
  return `--lab-data-${mode}`;
}

/** The local storage key of one knob. The lab owns the `visonaut-lab:` prefix. */
export function getKnobStorageKey(name: KnobName) {
  // Round 2 has a new default data mode. A browser that saved a mode in
  // round 1 would keep it and never show the decided data, so this knob has a
  // new key.
  if (name === "data") return "visonaut-lab:data-r2";
  return `visonaut-lab:${name}`;
}

export function isKnobValue(name: KnobName, value: unknown): value is string {
  if (typeof value !== "string") return false;
  const definition = knobDefinitions.find((item) => item.name === name);
  if (!definition) return false;
  return definition.options.some((option) => option.id === value);
}

/** Keeps the valid knob values of a loose record, such as URL search. */
export function pickKnobs(input: Partial<Record<KnobName, unknown>>): Partial<LabKnobs> {
  const result: Partial<LabKnobs> = {};
  if (input.theme === "dark" || input.theme === "light") {
    result.theme = input.theme;
  }
  if (isKnobValue("brand", input.brand)) {
    result.brand = input.brand;
  }
  if (isKnobValue("canvas", input.canvas)) {
    result.canvas = input.canvas;
  }
  if (isKnobValue("radius", input.radius)) {
    result.radius = input.radius;
  }
  if (isKnobValue("density", input.density)) {
    result.density = input.density;
  }
  if (isDataMode(input.data)) {
    result.data = input.data;
  }
  return result;
}

export function isSameKnobs(a: LabKnobs, b: LabKnobs) {
  return knobNames.every((name) => a[name] === b[name]);
}
