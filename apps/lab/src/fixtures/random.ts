// Deterministic helpers. Fixtures never call `Math.random` or `Date.now`, so
// the server render and the browser render always produce the same data.

/** 32-bit FNV-1a hash of a string. */
export function hash(value: string): number {
  let result = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    result ^= value.charCodeAt(i);
    result = Math.imul(result, 0x01000193);
  }
  return result >>> 0;
}

export interface Random {
  /** A float in [0, 1). */
  next(): number;
  /** An integer in [minimum, maximum]. */
  integer(minimum: number, maximum: number): number;
  /** One element of a non-empty list. */
  pick<T>(list: readonly T[]): T;
  /** True with the given probability. */
  chance(probability: number): boolean;
}

/** A seeded mulberry32 generator. The same seed always gives the same values. */
export function createRandom(seed: string): Random {
  let state = hash(seed);
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
  const integer = (minimum: number, maximum: number) =>
    minimum + Math.floor(next() * (maximum - minimum + 1));
  const pick = <T>(list: readonly T[]): T => {
    const item = list[integer(0, list.length - 1)];
    if (item === undefined) throw new Error("Cannot pick from an empty list.");
    return item;
  };
  return { next, integer, pick, chance: (probability) => next() < probability };
}

/** A lowercase hexadecimal string, for example a commit SHA or a digest. */
export function hex(seed: string, length: number): string {
  const random = createRandom(`hex:${seed}`);
  let result = "";
  while (result.length < length) {
    result += random.integer(0, 0xffff).toString(16).padStart(4, "0");
  }
  return result.slice(0, length);
}

/** A version 4 shaped identifier, like the run and comparison identifiers. */
export function uuid(seed: string): string {
  const value = hex(`uuid:${seed}`, 32);
  const variant = ((parseInt(value.slice(16, 17), 16) & 0x3) | 0x8).toString(16);
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-4${value.slice(13, 16)}-${variant}${value.slice(17, 20)}-${value.slice(20, 32)}`;
}
