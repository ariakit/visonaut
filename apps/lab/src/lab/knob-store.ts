import { createContext, useContext, useSyncExternalStore } from "react";
import {
  defaultKnobs,
  getDataGateProperty,
  getKnobStorageKey,
  isKnobValue,
  isSameKnobs,
  knobNames,
  labDataModes,
  pickKnobs,
  resettableKnobNames,
} from "./knobs.ts";
import type { KnobName } from "./knobs.ts";
import type { LabDataMode, LabKnobs } from "./types.ts";

// The `html` element is the source of truth: the inline script sets its
// attributes before the first paint, and CSS reads them. This store mirrors
// the attributes for React.
let knobs: LabKnobs | undefined;
const listeners = new Set<() => void>();

function readDocument(): LabKnobs {
  const { dataset } = document.documentElement;
  return { ...defaultKnobs, ...pickKnobs(dataset) };
}

function emit() {
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getKnobs(): LabKnobs {
  if (typeof document === "undefined") {
    return defaultKnobs;
  }
  knobs ??= readDocument();
  return knobs;
}

/**
 * The look that the server rendered with. The server does not know the saved
 * look, so the default is the default look. The bare preview provides the
 * look of its URL, so a variant that reads the theme renders the same on the
 * server and on the client.
 */
export const ServerKnobsContext = createContext<LabKnobs>(defaultKnobs);

/** Hides the content of every data mode but the given one. See `useDataGate`. */
function syncDataGate(current: LabDataMode) {
  const { style } = document.documentElement;
  for (const mode of labDataModes) {
    const property = getDataGateProperty(mode);
    if (mode === current) {
      style.removeProperty(property);
    } else {
      style.setProperty(property, "hidden");
    }
  }
}

/**
 * Applies a look to this document without saving it. The bare preview uses it
 * to follow its URL, which the lab controls.
 */
export function applyKnobs(next: Partial<LabKnobs>) {
  const merged = { ...getKnobs(), ...pickKnobs(next) };
  for (const name of knobNames) {
    document.documentElement.dataset[name] = merged[name];
  }
  syncDataGate(merged.data);
  if (isSameKnobs(merged, getKnobs())) return;
  knobs = merged;
  emit();
}

/** Applies one look control and saves it as the lab preference. */
export function setKnob(name: KnobName, value: string) {
  if (!isKnobValue(name, value)) return;
  applyKnobs({ [name]: value });
  try {
    localStorage.setItem(getKnobStorageKey(name), value);
  } catch {
    // Storage can be unavailable in a private window. The attribute still applies.
  }
}

/** Returns the look to its default. The theme and the data mode stay. */
export function resetKnobs() {
  for (const name of resettableKnobNames) {
    setKnob(name, defaultKnobs[name]);
  }
}

export function useKnobs(): LabKnobs {
  const serverKnobs = useContext(ServerKnobsContext);
  return useSyncExternalStore(subscribe, getKnobs, () => serverKnobs);
}

// Each class reads the property of its mode (`getDataGateProperty`). The
// names are whole strings, so that Tailwind finds them.
const dataGateClasses: Record<LabDataMode, string> = {
  decided: "contents [visibility:var(--lab-data-decided,visible)]",
  improved: "contents [visibility:var(--lab-data-improved,visible)]",
  today: "contents [visibility:var(--lab-data-today,visible)]",
};

/**
 * The class of an element around content that reads the fixtures. The element
 * has no box of its own.
 *
 * The server does not know the saved data mode, so it renders a lab page in
 * the default mode. When the saved mode is another one, the inline script
 * hides the content of the default mode before the first paint, and the
 * content shows when the client has rendered it again in the saved mode. So a
 * page never shows the data of the wrong mode.
 */
export function useDataGate(): string {
  const { data } = useKnobs();
  return dataGateClasses[data];
}
