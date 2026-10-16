---
"@visonaut/web": patch
---

The cause of an error on more failure lines of the service

The steps of a scheduled service pass that run before its main steps now log the cause of each item that failed, and the line of a pass that stops with an error has the correlation ID of its pass.

The steps are `github-delivery-recovery`, `webhooks`, `check-aliases`, `staged`, and `staged-retention`. Before this change, the pass logged nothing when one item of these steps failed and the step went on. Now the pass writes one line `operation-failed` for each such step, with the operation of the step, the code `items-failed`, and the causes with the number of errors for each cause. A pass with no item failure writes no new line. For example, when GitHub answers 502 to the check of one alias:

```json
{
  "event": "operation-failed",
  "operation": "check-aliases",
  "code": "items-failed",
  "correlationId": "5d1c0c4e-1d4a-4a52-9a46-0c4a7c1b8f2e",
  "elapsedMilliseconds": 120,
  "causes": [
    {
      "errorName": "SecurityError",
      "code": "github_unavailable",
      "upstreamStatus": 502,
      "count": 1
    }
  ]
}
```

Each name and each code is on a list in the source code, and the log gets no message text and no stack of an error. A pass that stops with an error writes one line `operation-failed` with the operation `operations-pass`. This line now has the same `correlationId` as the other lines of the same pass. Before this change, it had an ID of its own.

The line `operation-failed` of an API request that answers 503 with the code `service_unavailable` now also has the cause of the error. This cause has only the class of the error in `errorName`, because a `SecurityError` gets its own answer and does not write this line. Before this change, this line had no cause, so the logs did not show why the request failed. For example, when a read of D1 throws:

```json
{
  "event": "operation-failed",
  "operation": "api",
  "code": "service_unavailable",
  "correlationId": "8a41f013-bdab-44fd-8e8f-12d42d25429f",
  "elapsedMilliseconds": 579,
  "cause": { "errorName": "Error" }
}
```
