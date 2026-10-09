# Research record of feedback round 5

This folder holds the work behind revision r8 of the audit document.

- `feedback.md`: the feedback of the maintainer that revision r8 merged. It settled D-PERF-01, D-PERF-02, and D-PERF-03, each as the recommended option and with no note.
- `apply.mjs.txt` and `coordinator-1.mjs.txt`: the two one-time scripts that changed `content/decisions.json` and `content/record.json`. Do not run them again.
- `lab`: the scripts and results of lab round 4, which applied D-PERF-01 (the screenshot list has the bar glider only) and D-PERF-03 (the gallery and the directions page show pictures) to the lab. Its record for a reader is `apps/lab/docs/design/round-4.md`.
- `lab-review`: the scripts and results of the independent review of lab round 4.
- `sections`: the notes of the editor that wrote the text of revision r8.
- `check`: the notes of the independent checker of revision r8. It made 12 corrections, and it ran the feedback mechanics with its own script, because `check.mjs` skips some cases when no decision is open.
- `results`: the final report of each of the four agents.

The research for the three decisions is in `../perf`.

D-PERF-02 (a test of the count in `apps/web`) is not built. It is a part of the implementation.

A script, a log, and a shell file have the suffix `.txt` after their real extension, so that the lint and the formatter of the repository do not read them. The copies of the lab, the pictures, and the server logs are not kept.
