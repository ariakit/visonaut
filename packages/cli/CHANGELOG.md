# visonaut

## 0.2.0

### Minor Changes

- 9530073: Trusted workflow submission

  **BREAKING** if your workflow uses `visonaut finalize` or `--manifest`, switch to the [`visonaut` CLI](https://github.com/ariakit/visonaut/blob/main/packages/cli/README.md) upload/submit flow. `upload` stages each signed capture job, and a final signed job calls `submit` after all uploads succeed. The CLI reads `manifest.json` inside the capture directory.

  Before:

  ```sh
  visonaut upload --manifest visonaut/manifest.json
  visonaut finalize --manifest visonaut/manifest.json
  ```

  After:

  ```sh
  visonaut upload --dir visonaut
  visonaut submit --run "$GITHUB_RUN_ID"
  ```
