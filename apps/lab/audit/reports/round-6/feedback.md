# Feedback round 5

The maintainer gave this feedback on 2026-10-07 with the continuation prompt of revision r7. It has 3 of 58 decisions. The other decisions did not change.

| Decision  | Question                                                                                   | Answer                                                              | Notes |
| --------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- | ----- |
| D-PERF-01 | Which gliders does the screenshot list of the review page have?                            | The bar glider only (option `bar-only`)                             | none  |
| D-PERF-02 | Does apps/web get a test for the speed of the review page when the settled design goes in? | A test of the count (option `count-test`)                           | none  |
| D-PERF-03 | Does the gallery of the lab show pictures in place of live frames?                         | Pictures in the gallery and the directions page (option `pictures`) | none  |

Each answer is the recommended option.

## What the record did with it

- It settled the three decisions as selected. All 58 decisions are settled in revision r8.
- It applied D-PERF-01 and D-PERF-03 to the lab in the same round, because both change the lab. D-PERF-02 is a test in `apps/web`, so it waits for the implementation.
- It corrected one sentence of the settled answer of D-PERF-03. The option text said that the component explorer keeps a live frame. The component explorer never had a frame: it shows each variant in the page. The choice did not change.
- A card follows the theme control, with one picture for each theme. The option text said that a card no longer follows the theme. So the answer gives up less than the option said.

## Later on the same day

After this round, the maintainer authorized the implementation and said that the open points of the record must be decisions. That is the work of the next revision. Its record is in `../round-7`.
