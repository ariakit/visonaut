---
"@visonaut/web": patch
---

Failed decisions and capture counts in the Service status

The Service status read (`/api/operations`) now has two more fields. They come from the same D1 batch, so the request still makes 1 D1 round trip and writes no row.

- **`deadReviewTasks`.** The count of the queued decisions that failed each attempt in the last 7 days, and the time of the newest one. A restore of the database does not count.
- **`captures`.** The run with the largest capture count among the 20 newest runs that have one, with the capture limit of the service. It is `null` when no run has a capture count.

```json
{
  "deadReviewTasks": { "count": 1, "newestAt": 1790000000000 },
  "captures": { "runId": "run-id", "count": 3832, "limit": 11000 }
}
```
