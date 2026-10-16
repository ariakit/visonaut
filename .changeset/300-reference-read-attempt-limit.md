---
"visonaut": patch
---

Fixed Submit to retry a reference read that hangs. Before, one connection that stopped answering used the whole 30 s limit of the read and ended Submit with a timeout. Now each attempt of a reference read has a limit of 10 s, and an attempt that reaches it is retried like a network error. The read has up to 5 attempts in a deadline of 60 s, and the `Reference reads` line of the log counts the retry wait. Other requests keep their rules.
