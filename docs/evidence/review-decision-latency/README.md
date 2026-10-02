# Review decision latency

The baseline is [`017f15c`](https://github.com/ariakit/visonaut/commit/017f15c0f910a4599fe53dd85717bdb8aa1d79b0). These results measure local database call counts and mock GitHub requests. They do not measure production latency or browser response times.

## Database calls

The service tests `persists a fresh approved command in three database round trips` and `persists a fresh rejected command in three database round trips` count standalone `first`, `all`, and `run` calls plus `batch` calls. The fixture uses a changed capture in an active pull request run. Setup and status reads are outside the count.

| Operation                                                  | Baseline | Updated |
| ---------------------------------------------------------- | -------: | ------: |
| Command replay lookup                                      |        1 |       1 |
| Comparison, run, project, target, and promotion reads      |        5 |       1 |
| Atomic decision, command, audit, revision, and outbox save |        1 |       1 |
| Total service database calls                               |        7 |       3 |

The measured reduction is `(7 - 3) / 7`, or about 57%. The read batch still executes five SQL statements. This reduces network round trips, not the number of SQL statements. The write transaction retains the existing revision and state guards.

## Authorization and wakeup

The API test `caches only decision permission and still checks origin, expiry, and other writes` submits Reject and Approve after a successful private read. Both decisions use the same permission grant and add zero GitHub permission requests. At exactly 10 seconds from the original check, another submission checks GitHub and rejects the removed permission. A separate authentication test confirms that intermediate cache hits do not extend the grant and that slow GitHub verification consumes its lifetime.

The existing opaque-promotion API test now holds the operations Queue send unresolved. It receives the saved decision response and verifies the durable status outbox before rejecting the Queue send. The request lifetime owns the send, and the scheduled operations run can process the outbox after a send failure.

## Regression proof

The new tests were also run with the original authorization, API routing, review route, and service source from the baseline. Both service call-count checks reported seven calls instead of three. The permission-reuse tests failed because the original code made live GitHub checks. The unresolved Queue send held the original route open until the test timeout. The exact implementation patch was restored after this check.

Run the relevant tests with:

```sh
pnpm test packages/service/src/service.test.ts packages/security/test/auth-d1.test.ts apps/web/src/api/api.test.ts
```

## Queue compatibility

The separate `continuous-review-decisions` work stores accepted commands in a durable server queue. This change adds no command queue and does not require that branch to merge first. Its permission optimization applies at the existing decision endpoint, and its batched service reads can also run inside the queue consumer. The queue admission route must continue to await durable command storage before acknowledging acceptance.

The client still creates its review session on the first decision. Starting it earlier would add authenticated writes for review pages where no decision is made and would overlap the concurrent client changes. Full-model fallback and status calculation remain in the synchronous route; the command queue owns moving that work into durable background processing.
