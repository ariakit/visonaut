---
"@visonaut/web": patch
"@visonaut/security": patch
"@visonaut/service": patch
---

The cause of a failure in the log of a scheduled service pass

The log of a scheduled service pass now says why a step or an item failed, with three fixed values: `errorName` is the name of the error class, `code` is the fixed code of a `SecurityError`, and `upstreamStatus` is the HTTP status number that GitHub answered. A request to GitHub that got no answer has the code and no status.

Each name and each code is on a list in the source code, and a value that is not on its list is `other`. The log gets no message text and no stack of an error.

The line `operations_pass` has the causes of each step in `causes`, with the number of errors for each cause. For example, when GitHub answers 502 to the check result of one run:

```json
{
  "event": "operations_pass",
  "failedSteps": [],
  "steps": {
    "checks": {
      "elapsedMs": 40,
      "completed": 0,
      "deferred": 0,
      "attention": 1,
      "causes": [
        {
          "errorName": "SecurityError",
          "code": "github_unavailable",
          "upstreamStatus": 502,
          "count": 1
        }
      ]
    }
  }
}
```

The lines `operation-failed`, `operations-failed`, and `baseline_promotion_step` of a pass have the same three values in `cause`. A pass that stops with an error now writes one line `operation-failed` with the operation `operations-pass`.
