#!/bin/sh
# Splices new-part.html into the section copy, applies the patches, formats, and builds.
# Run from the repository root (read-only for this lane): sh <lane>/scripts/rebuild.sh
set -eu
node /Users/diegohaz/.claude/jobs/f65a6229/tmp/round2/ops-04/scripts/splice.mjs
node /Users/diegohaz/.claude/jobs/f65a6229/tmp/round2/ops-04/scripts/apply-patches.mjs
pnpm exec oxfmt /Users/diegohaz/.claude/jobs/f65a6229/tmp/round2/ops-04/content/sections/35-state-checks.html
node apps/lab/audit/build.mjs --strict \
  --content /Users/diegohaz/.claude/jobs/f65a6229/tmp/round2/ops-04/content \
  --out /Users/diegohaz/.claude/jobs/f65a6229/tmp/round2/ops-04/out
