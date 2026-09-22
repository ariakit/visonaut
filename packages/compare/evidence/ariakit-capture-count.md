# Ariakit diagnostic capture count

The frozen diagnostic integration produces **3,582 successful captures** per complete three-browser cycle. Ten times this collection is **35,820 captures**. This counts only the final successful test path; retries create extra attempt artifacts.

| Browser  | Named page sections | State captures | Generic previews | Total |
| -------- | ------------------: | -------------: | ---------------: | ----: |
| Chromium |                 984 |            230 |               16 | 1,230 |
| Firefox  |                 984 |            230 |               16 | 1,230 |
| WebKit   |                 926 |            180 |               16 | 1,122 |
| Total    |               2,894 |            640 |               48 | 3,582 |

The normal page set has 463 sections. Each receives two color schemes in each browser: `463 × 2 × 3 = 2,778`. Chromium and Firefox also capture 29 list sections in forced colors: `29 × 2 × 2 = 116`. These page captures use the desktop viewport. The environment profile allowlist is not an execution multiplier.

Actual preview discovery selects four framework paths from three public examples. Each path receives two viewports and two color schemes, for 16 generic preview captures per browser.

An independent source audit parsed all 307 collected test callbacks by file and line with the repository's TypeScript parser. It counted each capture call, array loop, color-scheme loop, viewport/style expansion, and authored page section. It executed the current preview discovery and index functions. Its count agrees with a separate reconciliation against the 1,058 existing screenshot files after replacing the old grouped page captures.

The source audit is in `ariakit-source-capture-count.json`. The baseline reconciliation is in `ariakit-capture-count.json`. The integration snapshot digest is `497167b90d44f207c477becf21777470e6c05264b90ca2c66ba66a1abc9b98bc`. The count run took no screenshots and changed no integration source files.

The provisional 20,000-capture limit covers the current collection, but does not cover its tenfold size. A 40,000 successful-capture limit would cover that target with room for 4,180 additional captures. Any per-run byte, retry, storage, and cost limits must still be based on the hosted capture outputs.
