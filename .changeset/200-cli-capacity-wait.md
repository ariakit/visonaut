---
"visonaut": patch
---

Submit waits at the capacity limit

`visonaut submit --shard` waits when the service answers `capacity_exceeded`, which means that the service is at its limit of active runs. It asks for a run again, up to 20 tries with 30 seconds between tries, and it stages no image before a try succeeds. Each try uses a new GitHub OIDC token. Before each wait, the CLI prints a line on standard error:

```
Visonaut is at its capacity limit (try 1 of 20). Waiting 30 seconds before the next try.
```

After 20 tries, the CLI fails with exit code `1`, and you can run the job again. The 19 waits take 9 minutes 30 seconds, and the time of the requests comes on top. The answers `database_size_exceeded` and `capture_limit_exceeded` need a person, so the CLI does not wait for them.

Give the Submit job a `timeout-minutes` of 40 or more, so that the job does not end before the CLI prints its last line.
