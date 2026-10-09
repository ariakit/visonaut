---
"@visonaut/web": patch
---

Run list and pull request page data

The service now returns more of the data that the pages need:

- **Run list.** Each closed run has the reason that it closed. A closed run that sealed also has the state that it had before it closed. The answer also has the count of open service alerts and the login of the viewer.

- **History.** A closed run now shows why it closed: `Replaced`, `Closed`, `Removed from queue`, `Retired`, or `Expired`. A run that closed before the service stored the reason shows `No longer active`. Before this update, each closed run showed "Replaced by a newer run".

- **Pull request page.** The answer has the title of the pull request, its head commit, the workflow attempt, and the link to that attempt on GitHub. It has the state `not-required` when the Plan selected no visual capture, and the new state `replaced` when the run closed before its screenshots were complete. A request without a check answers for the newest head commit of the pull request.

- **Fewer reads.** The history query reads about 6.6 times fewer database rows in a local D1 fixture with 2,000 runs (38,540 rows before, 5,844 after), and it returns the same rows.
