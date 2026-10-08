import { references } from "./catalog-components.ts";
import { directions } from "./catalog-directions.ts";
import { pages } from "./catalog-pages.ts";
import type { Catalog } from "./types.ts";

// The catalog is the single index of the lab. A variant listed here loads from
// `src/explorations/{pages,components}/<surface id>/<variant id>.tsx`.
//
// The lab is one design, and each decision is settled: the six pages, and the
// reference surfaces of four of their parts.
export const catalog: Catalog = {
  directions,
  groups: [
    {
      name: "Pages",
      description: "The settled design, with the answers of round 1 and of round 2.",
    },
    {
      name: "Reference",
      description: "Settled parts, with the states that no page scenario reaches.",
    },
  ],
  surfaces: [...pages, ...references],
};
