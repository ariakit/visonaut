# Measured capture scope

The measurement covers the complete currently configured Ariakit desktop visual suite at the recorded source. It does not cover every Ariakit test or every repository example. The unchanged upstream visual workflow selects Chromium and Firefox on Ubuntu and WebKit on macOS with `--grep @visual`. Its separate nonvisual jobs select desktop and mobile projects with `--grep-invert @visual`. A mobile viewport in this measurement is still a desktop browser.

The historical scope check used the unchanged upstream configuration:

```sh
CI=true VISUAL_TEST=true playwright test \
  --config app/playwright.config.ts --list \
  --project chrome firefox safari --grep @visual --reporter=json
```

It collected 307 callbacks across 33 source files, with no errors. The actual three browser reports had zero missing or extra test title paths and source filenames: 106 Chromium, 106 Firefox, and 95 WebKit. The frozen `scope.json` retains the source hashes, counts, dimensions, and private inventory digest. This package omits the raw inventory body, so the portable wrapper checks the saved parity counts but does not rerun collection or compare individual test names.

## Capture expansion

The existing [source ledger](../../../packages/compare/evidence/ariakit-source-capture-count.json) counts authored capture calls and helper expansion. Its predicted totals match all three actual passes:

| Browser  | Page sections | States | Generic previews | Total per pass |
| -------- | ------------: | -----: | ---------------: | -------------: |
| Chromium |           984 |    230 |               16 |          1,230 |
| Firefox  |           984 |    230 |               16 |          1,230 |
| WebKit   |           926 |    180 |               16 |          1,122 |
| Total    |         2,894 |    640 |               48 |          3,582 |

The 463 normal named page sections receive two color schemes in each browser. Chromium and Firefox also include the authored forced-colors page cases. State tests use their authored viewport, contrast, forced-colors, and interaction combinations. The environment allowlist does not multiply captures.

Generic preview discovery contains four framework paths from three current examples. Each path has two viewports and two color schemes, giving 16 captures per browser. The preview index excludes sandbox entries; selected sandbox tests remain covered by their authored `@visual` callbacks. Framework discovery uses React for Next.js cases. It does not automatically capture every sandbox.

| Dimension per pass  | Chromium and Firefox, each                               | WebKit                                                   |
| ------------------- | -------------------------------------------------------- | -------------------------------------------------------- |
| Framework           | React 1,226; Solid 4                                     | React 1,118; Solid 4                                     |
| Color scheme        | Light 617; dark 613                                      | Light 563; dark 559                                      |
| Contrast preference | No preference 1,224; more 6                              | No preference 1,116; more 6                              |
| Forced colors       | None 1,118; active 112                                   | None 1,118; active 4                                     |
| Viewport key        | Default 10; desktop 1,174; mobile 12; wide 22; narrow 12 | Default 10; desktop 1,066; mobile 12; wide 22; narrow 12 |
| Style key           | Default 10; light 610; dark 610                          | Default 10; light 556; dark 556                          |

These counts describe the variants that authored tests select. They are not every possible combination applied to each item. The adapter captures one prepared variant per call. The trusted executor's string globs matched the unchanged upstream collection at this revision; future collection conventions must preserve that coverage.

## Expanded workload targets

[Issue #1](https://github.com/ariakit/ariviso/issues/1) starts from 1,058 old lossless WebP images, many containing composite captures, and asks for about ten times that workload after splitting and future additions. Thus 10,580 is an expanded design target, not a collected inventory of current authored states.

The current split collection has 3,582 captures. Ten times that collection is 35,820. Current visual coverage, the 10,580 target, and the 35,820 stress scenario remain separate. Repeating measured size distributions to those larger counts is a capacity experiment. It does not add authored test coverage or establish future size distributions. Storage, compute, and sustained workload limits still require their separate platform evidence.
