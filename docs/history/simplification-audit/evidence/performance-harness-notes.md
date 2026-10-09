# Audit performance reproduction notes

Research date: 2026-09-29. Repo source: 7e23173 (main), worktree /Users/diegohaz/.codex/worktrees/1de3/visonaut. No product or tracked source files were edited. Final app source and styles are unchanged.

Copied apps/web/src and apps/web/tooling/review-scale to /tmp/visonaut-perf-audit. Reused installed locked dependencies from /Users/diegohaz/Developer/visonaut through node_modules links. Production build used Vite 8.3.0 and locked app versions. Vite's native config loader avoided writes through dependency symlinks.

The unchanged runner failed: variant navigation expects a selected role=tab; current UI uses role=option inside .review-variants. Each measured navigation timed out after 15 seconds.

Only final disposable harness adaptation: In fixture.jsx replace [role="tab"][aria-selected="true"] with .review-variants [role="option"][aria-selected="true"] in each measurement selector. The app source itself remains unchanged.

Build from /tmp/visonaut-perf-audit/apps/web, as the documented workspace-filter command does:
node /Users/diegohaz/Developer/visonaut/apps/web/node_modules/vite/bin/vite.js build --config tooling/review-scale/vite.config.mjs --configLoader native

Audit fixture build: CSS 255.29 kB / gzip 35.99 kB; JS 440.72 kB / gzip 134.97 kB. These are fixture sizes, not production app bundle sizes.

An initial build from the disposable repository root emitted only 38.53 kB CSS and missed Shell recipe styles. This was an invocation error, not an app or documented-harness defect. An intermediate explicit @source scan fixed that error but added more styles. It was removed before final measurement. Use only evidence-final measurements. The final browser probe confirms Shell display:grid.

Server from disposable repo root: REVIEW_SCALE_PORT=5191 node apps/web/tooling/review-scale/server.mjs
Runner from disposable repo root: REVIEW_SCALE_PORT=5191 SAMPLES=3 WARMUPS=1 TIMEOUT=10000 REVIEW_SCALE_OUTPUT=/tmp/visonaut-perf-evidence-final node --input-type=module -e 'import { chromium } from "/Users/diegohaz/Developer/visonaut/node_modules/@playwright/test/index.mjs"; import { run } from "./apps/web/tooling/review-scale/run.mjs"; await run(chromium);'

Measurements are paint opportunities after two animation frames, not hardware paint timestamps, Core Web Vitals, production latency, or statistically stable percentiles. Three fresh-context samples plus one excluded warmup per size diagnose scaling; each measured sample has four cached variant transitions. Browser data records unchanged app source hashes. The shared developer laptop was not isolated; a separate image probe overlapped part of final collection. Do not use these small samples as a controlled regression threshold.

Measurements use localhost, synthetic screenshot pixels, no real Workers/D1/R2/GitHub calls, no save/undo writes, no production compression. Do not compare with September 22 data as a regression: component source and style output changed.

probes.json uses the final fixture in dark mode. Both normal and 4x CPU cases show 16 lazy-thumbnail requests and three full image requests for reference, candidate, and hidden diff. Switching to diff performs zero further image requests. The 4x pilot records 570.2 ms render-to-image opportunity and a 486 ms long task. It does not identify a cause or represent a named mobile device. The normal pilot overlapped browser work and is used only for request-count evidence.

encoding.json records local Node gzip and Brotli quality-4 encoding of synthetic model JSON. It does not show live production headers or transfer sizes. At 35,820 captures raw JSON is 31,972,612 bytes, gzip 1,329,130 bytes, and Brotli Q4 575,988 bytes. Do not report raw bytes as production transfer bytes.
