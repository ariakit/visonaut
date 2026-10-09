---
"@visonaut/web": patch
"@visonaut/service": patch
---

A decision that loses a race, and the limit of one review command

- **Two writes at the same time.** A decision that loses the race with another write of the project still answers HTTP 409 with the current state, and nothing of it is stored. The answer now has the code `concurrent_change`, and the run page says "Conflict. Another change was saved at the same time. Check the current state and decide again."
- **The limit of one command.** A review command with more than 200 targets now answers HTTP 400 with the code `too_many_targets`. Before, the limit was the capture limit of the service, and a larger command could fail in the database with HTTP 503. For an item with more than 200 changed variants, review the variants one at a time.
- **Fewer rows read.** The service reads the targets of a decision by their key. In the test of one target in a comparison of 801 rows, that read is 3 rows in place of 802.

```json
{
  "error": {
    "code": "concurrent_change",
    "message": "Another change was saved at the same time. Decide again."
  }
}
```
