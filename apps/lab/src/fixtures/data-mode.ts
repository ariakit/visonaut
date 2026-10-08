// The data mode of the fixtures. The maintainer sets it with the Data control
// in the Look menu of the lab. Each preview gets it in its URL as `data`.

import { createContext, createElement, useContext } from "react";
import type { ReactNode } from "react";
import { getKnobs, useKnobs } from "../lab/knob-store.ts";
import { labDataModes } from "../lab/knobs.ts";
import type { DataMode } from "./types.ts";

/** The three data modes, the default first. */
export const dataModes: DataMode[] = labDataModes;

/** The names of the modes, as the Data control has them. */
export const dataModeLabels: Record<DataMode, string> = {
  decided: "Decided API",
  today: "API today",
  improved: "All proposed fields",
};

const DataModeContext = createContext<DataMode | null>(null);

/**
 * The data mode for the calling component. Every fixture hook reads it, so a
 * variant follows the Data control without code of its own.
 */
export function useDataMode(): DataMode {
  const pinned = useContext(DataModeContext);
  const { data } = useKnobs();
  return pinned ?? data;
}

/**
 * The data mode outside React, for example in an event handler. It does not
 * follow later changes, and on the server it is always the default. In a
 * component, call `useDataMode`.
 */
export function getDataMode(): DataMode {
  return getKnobs().data;
}

export interface DataModeProviderProps {
  /** Without a mode, the children follow the Data control. */
  mode?: DataMode | null;
  children?: ReactNode;
}

/**
 * Pins the data mode for one part of the tree. Use it to show the same
 * component in each mode side by side. A page variant does not need it.
 */
export function DataModeProvider({ mode = null, children }: DataModeProviderProps) {
  return createElement(DataModeContext.Provider, { value: mode }, children);
}
