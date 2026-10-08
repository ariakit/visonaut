import type { DataMode } from "../types.ts";

/**
 * Caches the result of a builder for each scenario and data mode. A getter
 * then returns the same object for the same arguments, so React memoization
 * and effects stay stable.
 */
export function memoize<Value extends object>(build: (scenario: string, mode: DataMode) => Value) {
  const cache = new Map<string, Value>();
  return (scenario: string, mode: DataMode): Value => {
    const key = `${mode}:${scenario}`;
    const cached = cache.get(key);
    if (cached) return cached;
    const value = build(scenario, mode);
    cache.set(key, value);
    return value;
  };
}
