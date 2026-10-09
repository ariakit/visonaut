# Research record of feedback round 2

This folder holds the work behind revision r3 of the audit document: the feedback of the maintainer (`feedback.md`), and one folder for each research lane with its notes, its result, the result of its independent check, and its measurement scripts with the recorded output.

- `ops-04`: API keys against the OIDC token of GitHub Actions for decision D-OPS-04.
- `data-02`: a capture list for hundreds of thousands of screenshots for decision D-DATA-02.
- `sections`: the results of the editor and of the checker that brought the other sections in line with revision r3.

A script, a log, and a file that was fetched from another repository have the suffix `.txt` after their real extension, for example `pages.probe.ts.txt`. So the lint, the formatter, and the type check of the repository do not read them. Remove the suffix to run a script. The scripts ran from a scratch folder, so their paths need a change first.

Not kept: pictures, dependencies, copies of source code and documents of other projects, and the raw list of the pull requests of `ariakit/ariakit`. The notes name the source of each one.
