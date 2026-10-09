# Research record of feedback round 6

This folder holds the work behind revision r10 of the audit document. With that revision, each of the 70 decisions is settled, and the audit is done.

- `feedback.md`: the 12 answers of the maintainer of 2026-10-07, in the form in which he gave them, with his one note (on D-PRE-11).
- `settled.md`: the 12 settled answers with their rationales, for a reader.
- `apply.mjs.txt`: the one-time script that settled the 12 decisions in `content/decisions.json` and `content/record.json`. Do not run it again.
- `replace-res-05.mjs.txt`, `old-values-left.mjs.txt`, `avatar-ids.mjs.txt`: the scripts for the 10 raw files of `../round-2/res-05`. The maintainer answered in the chat on 2026-10-07. He had three options (replace the values, keep the files out of the branch, or publish them as they are), and he said "Alright, let's go with 1". So the old logins and user IDs of the invented reviewers in those files are replaced.
- `edit`: the notes of the editor of revision r10.
- `check`: the notes of the independent checker of revision r10. It made 12 corrections in the sections and 3 in rationale texts.
- `results`: the final report of each of the three agents.

The filing kit (the labels, the settings, the lab branch, the script that files the issues, and the report for Ariakit UI) and the issue set are in `apps/lab/audit/private`. That folder ignores itself in git, because it holds the private briefs of 6 issues.

A script and a log have the suffix `.txt` after their real extension, so that the lint and the formatter of the repository do not read them.
