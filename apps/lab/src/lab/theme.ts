import {
  defaultKnobs,
  getDataGateProperty,
  getKnobStorageKey,
  knobDefinitions,
  labDataModes,
} from "./knobs.ts";
import { setKnob } from "./knob-store.ts";
import type { LabTheme } from "./types.ts";

export type { LabTheme } from "./types.ts";

export const themeStorageKey = getKnobStorageKey("theme");

// One row per knob: the name, the valid values, the default, and the storage
// key. The inline script cannot import modules, so it gets the data as JSON.
const knobTable = knobDefinitions.map((definition) => [
  definition.name,
  definition.options.map((option) => option.id),
  defaultKnobs[definition.name],
  getKnobStorageKey(definition.name),
]);

// One row per data mode: the mode and the property that hides its content.
const dataGateTable = labDataModes.map((mode) => [mode, getDataGateProperty(mode)]);

/**
 * Runs before the first paint and sets one `data-*` attribute per look
 * control on the `html` element. A query parameter wins so that a preview
 * frame can show a look that differs from the stored preference.
 *
 * The last loop is for the data mode. The server does not know the saved
 * mode, so it can render the content of another mode. The loop hides the
 * content of every mode but the current one. See `useDataGate`.
 */
export const themeScript = `(() => {
  const root = document.documentElement;
  let query = new URLSearchParams();
  try {
    query = new URLSearchParams(location.search);
  } catch {}
  for (const [name, values, fallback, key] of ${JSON.stringify(knobTable)}) {
    let saved = null;
    try {
      saved = localStorage.getItem(key);
    } catch {}
    const fromQuery = query.get(name);
    root.dataset[name] = values.includes(fromQuery)
      ? fromQuery
      : values.includes(saved)
        ? saved
        : fallback;
  }
  for (const [mode, property] of ${JSON.stringify(dataGateTable)}) {
    if (mode !== root.dataset.data) {
      root.style.setProperty(property, "hidden");
    }
  }
})();`;

export function readTheme(): LabTheme {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

export function writeTheme(theme: LabTheme) {
  setKnob("theme", theme);
}
