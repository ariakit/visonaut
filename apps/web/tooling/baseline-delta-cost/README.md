# Baseline and changes D1 cost probe

Run this local evidence probe from the repository root:

```sh
pnpm exec vitest run --config apps/web/tooling/baseline-delta-cost/vitest.config.ts
```

The `.cost.ts` file is excluded from the normal test suite. Miniflare needs a localhost socket. Each scenario uses a separate temporary native D1 database with the committed migrations. The probe uses the declared Miniflare dependency and disposes each database after the measurement.

The probe measures the service calls from shard commit through main baseline promotion. Both storage modes start with the same accepted dense baseline. The dense mode stores every capture and comparison row, then records each snapshot member. The sparse mode stores changed rows and a full inventory pointer, then verifies that pointer. The one-change scenarios include one explicit approval command.

Migration and baseline setup, run reservation, image registration, R2 operations, and the review target lookup are excluded. The inventory pointer represents previously verified R2 input. These results measure service D1 costs. They do not measure the complete upload workflow or establish production monthly billing.

The default output is the ignored `artifacts/baseline-delta-cost` directory. `summary.json` records each phase, total native rows read and written, runtime versions, and frozen source hashes. `statements.json.gz` retains each SQL statement and its native D1 row metadata, including index writes. The probe fails if the source hashes change during the run.

The [recorded summary](recorded/summary.json) and [compressed SQL metadata](recorded/statements.json.gz) were collected with this probe. To refresh those files:

```sh
BASELINE_DELTA_COST_OUTPUT=apps/web/tooling/baseline-delta-cost/recorded \
  pnpm exec vitest run --config apps/web/tooling/baseline-delta-cost/vitest.config.ts
```

Inspect the full statement evidence with:

```sh
gzip -dc apps/web/tooling/baseline-delta-cost/recorded/statements.json.gz
```

The recorded native costs are:

| Storage mode | Captures | Changed captures | Image owners | Rows written | Rows read |
| ------------ | -------: | ---------------: | -----------: | -----------: | --------: |
| Dense        |        1 |                0 |            1 |           84 |       273 |
| Dense        |      100 |                0 |            1 |        1,866 |    12,053 |
| Sparse       |        1 |                0 |            1 |           66 |       221 |
| Sparse       |      100 |                0 |            1 |           66 |       716 |
| Sparse       |        2 |                1 |            2 |           90 |       322 |
| Sparse       |      100 |                1 |            2 |           90 |     1,008 |

At 100 unchanged captures, the sparse path saves 1,800 writes (96.46%) in the measured phases. With one changed capture and two image owners, the write count stays at 90 when the complete inventory grows from 2 to 100 captures. The number of image owners matters because retention pins must protect their source runs.
