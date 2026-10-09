---
"@visonaut/web": patch
"@visonaut/service": patch
"@visonaut/security": patch
---

Reliable delivery of check results to GitHub

This update fixes three defects in the delivery of a check result to GitHub:

- **A failed read sets no lock.** When a read from GitHub fails before the service sends a result, the result goes back to the queue. The service tries again after 30 seconds, and then waits two times longer after each failed read, with a maximum of 15 minutes. Each failed read uses one attempt of that result. With the default of 5 attempts, the service stops after the fifth failed read in sequence, and a newer result of the check starts again. Before this update, one failed read locked the check until a manual repair.

- **A locked check starts no status loop.** A status pass asks for one more pass only when it completed or deferred an update.

- **A check keeps its duration.** The service sends no update when GitHub already shows the same completed result. An update of a completed check that keeps the conclusion also keeps the first end time.
