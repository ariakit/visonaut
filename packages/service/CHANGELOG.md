# @visonaut/service

## 0.0.2

### Patch Changes

- 6219fdf: Reduced database writes for unchanged runs

  The native D1 service lifecycle fixture with 100 unchanged items now writes 96.5% fewer rows: 66 instead of 1,866. This measurement includes capture admission, comparison, and promotion; it excludes upload, image registration, and R2 operations.

  Complete capture inventories now stay in R2, while D1 stores changed items. Unchanged items remain available in visual review with their current capture settings.

  Reference-image downloads reuse verified image membership. In the native 4,000-capture/profile fixture, five sequential image requests now read the full inventory once instead of five times (80% fewer inventory reads), while authorization stays live on every request.

  Capture inventories and baseline imports preserve the test IDs used by existing submissions, including IDs qualified by shard.

  Existing deployments must import their accepted baseline into a fresh database before switching to this storage model. Keep the old database and images until complete Submit, review, and main promotion pass against the replacement.

## 0.0.1

### Patch Changes

- 7185786: Reduced service database calls for a fresh Approve or Reject from seven to three, about 57% fewer calls in the local decision test. Decision saves can reuse a verified GitHub permission for up to 10 seconds and return before the status Queue wakeup completes. Live session checks and atomic decision saves remain required. Repository permission removal can take up to 10 seconds to block another decision.
- 4a7906c: Reduced the result JSON payload on local comparison rows by approximately 82–90% in the representative unchanged and changed results with masks, from 148/268 bytes to 26 bytes per row. Review pages, history archives, and closed summaries preserve metrics, masks, and the effective review outcome. D1 row writes and R2 image operations are unchanged.
- 722048f: Reduced redundant D1 writes. Repeating identical profile storage performs 100% fewer row writes in the two-profile local regression fixture, from six to zero. Successful transaction checks and unchanged background cursors also avoid row writes, and status acknowledgements preserve earlier delivery times.
- 32c2029: Improved review navigation with bar indicators, compact variant links, and aligned image controls. Review decisions now update the screen before saving completes and restore the previous state if saving fails. Captures with no changed pixels no longer need approval solely because their capture profile changed.
- c30e77d: Fixed stale dashboard reviews and service alerts to retire only after stored state proves supersession or completed delivery. Invalidated current reviews now ask for a fresh Submit. Current failures and uncertain GitHub sends keep their alerts and evidence.
- 8ebf821: Keep Approve and Reject available while earlier decisions save. Store review decisions in the server queue and process them in order, so acknowledged decisions can finish after the window closes. Show which decisions are still sending, preserve command identity on retry, and pause baseline promotion until queued decisions finish.
- 7893072: Fixed validation and import of local comparisons with zero changed pixels. Existing unreviewed local results are corrected without changing saved decisions or promotions. Image size changes and profile changes with different pixels still require review.
