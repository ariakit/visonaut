# @visonaut/service

## 0.0.1

### Patch Changes

- 7185786: Reduced service database calls for a fresh Approve or Reject from seven to three, about 57% fewer calls in the local decision test. Decision saves can reuse a verified GitHub permission for up to 10 seconds and return before the status Queue wakeup completes. Live session checks and atomic decision saves remain required. Repository permission removal can take up to 10 seconds to block another decision.
- 4a7906c: Reduced the result JSON payload on local comparison rows by approximately 82–90% in the representative unchanged and changed results with masks, from 148/268 bytes to 26 bytes per row. Review pages, history archives, and closed summaries preserve metrics, masks, and the effective review outcome. D1 row writes and R2 image operations are unchanged.
- 722048f: Reduced redundant D1 writes. Repeating identical profile storage performs 100% fewer row writes in the two-profile local regression fixture, from six to zero. Successful transaction checks and unchanged background cursors also avoid row writes, and status acknowledgements preserve earlier delivery times.
- 32c2029: Improved review navigation with bar indicators, compact variant links, and aligned image controls. Review decisions now update the screen before saving completes and restore the previous state if saving fails. Captures with no changed pixels no longer need approval solely because their capture profile changed.
- c30e77d: Fixed stale dashboard reviews and service alerts to retire only after stored state proves supersession or completed delivery. Invalidated current reviews now ask for a fresh Submit. Current failures and uncertain GitHub sends keep their alerts and evidence.
- 8ebf821: Keep Approve and Reject available while earlier decisions save. Store review decisions in the server queue and process them in order, so acknowledged decisions can finish after the window closes. Show which decisions are still sending, preserve command identity on retry, and pause baseline promotion until queued decisions finish.
- 7893072: Fixed validation and import of local comparisons with zero changed pixels. Existing unreviewed local results are corrected without changing saved decisions or promotions. Image size changes and profile changes with different pixels still require review.
