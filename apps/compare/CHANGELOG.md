# @visonaut/compare-worker

## 0.1.3

### Patch Changes

- Updated dependencies [5efa4ec]
- Updated dependencies [ddccdd3]
- Updated dependencies [8e06008]
- Updated dependencies [a15e27e]
- Updated dependencies [ddd23b8]
- Updated dependencies [2487e4e]
- Updated dependencies [11987b3]
- Updated dependencies [dd568c7]
- Updated dependencies [249e553]
- Updated dependencies [a99cb6f]
- Updated dependencies [b991b7e]
  - @visonaut/service@0.0.3

## 0.1.2

### Patch Changes

- Updated dependencies [6219fdf]
  - @visonaut/service@0.0.2

## 0.1.1

### Patch Changes

- bce65ea: Raised the production comparison consumer limit from one to five so queued image work for concurrent pull requests can run in parallel.
- d3332f0: Recovered exhausted comparison Queue deliveries promptly when their dead-letter receipt matches the current run. Repeated transport failures now leave a visible failed comparison instead of retrying without a limit.
- 1d1f573: Released image codec capacity before comparison result metadata is saved and completed comparisons are finalized, so that later work does not block the next image task.
- 1b9435f: Fixed baseline promotion and rollback so invalidated pull request comparisons stop using active comparison capacity. Reconciliation now frees their stale Queue slots so other reviews can proceed while those pull requests await recompare.
- 9b8750c: Queued comparison tasks now wait for an in-use image codec before retrying.
- 7e49647: Fixed ready review comparisons waiting for scheduled operations before their GitHub checks update.
- Updated dependencies [7185786]
- Updated dependencies [4a7906c]
- Updated dependencies [722048f]
- Updated dependencies [32c2029]
- Updated dependencies [c30e77d]
- Updated dependencies [8ebf821]
- Updated dependencies [7893072]
  - @visonaut/service@0.0.1
