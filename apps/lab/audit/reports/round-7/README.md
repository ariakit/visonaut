# Research record of round 7

This folder holds the work behind revision r9 of the audit document.

- `feedback.md`: what the maintainer said on 2026-10-07, in his exact words, and how the record reads it.
- `decisions`: one folder for each research lane. Each lane has its decision drafts with temporary identifiers, its closed points (`closed.md`), its notes, and the folder `check` of its independent checker. The lane `two-points` has no decision: its checker closed both points.
- `merged`: the 12 decisions with their final identifiers (`decisions.json`), where each one is in the document (`places.json`), the closed points of each lane, and the data files. `data/contract-changes.md` is the work list for the contract pull requests. `data/sensitive-findings.json` is the list that D-PRE-09 names.
- `edit`: the notes of the editor of revision r9.
- `check`: the notes of the independent checker of revision r9. It made 17 corrections.
- `results`: the final report of each agent.

The map between the temporary and the final identifiers:

| Temporary | Final    | Question in short                                |
| --------- | -------- | ------------------------------------------------ |
| D-PRE-01  | D-PRE-01 | Image files that no program opens before storage |
| D-PRE-02  | D-PRE-02 | The cause in the pass log                        |
| D-PRE-03  | D-PRE-03 | A screenshot name in the CI log                  |
| D-PRE-11  | D-PRE-04 | Who reads five facts from the live service       |
| D-PRE-21  | D-PRE-05 | The saved text of issue #1                       |
| D-PRE-23  | D-PRE-06 | A D1 row for a webhook that starts no work       |
| D-PRE-31  | D-PRE-07 | How the contract approves the lab design         |
| D-PRE-32  | D-PRE-08 | The report to Ariakit UI                         |
| D-PRE-41  | D-PRE-09 | When 7 findings get their steps in public        |
| D-PRE-42  | D-PRE-10 | What the public branch holds                     |
| D-PRE-43  | D-PRE-11 | Labels                                           |
| D-PRE-44  | D-PRE-12 | Secret scanning and private reports              |

The files below `decisions` use the temporary identifiers. The files below `merged`, `edit`, and `check` use the final identifiers. D-PRE-22, D-PRE-51, and D-PRE-52 were withdrawn and are not decisions.

## What is not here

- The issue set of the implementation plan, with its private briefs, is in `apps/lab/audit/private/issues`. That folder ignores itself in git, so a push does not publish it. The public text of the issues is filed on GitHub after the answer to D-PRE-09.
- The old logins and user IDs of the invented lab reviewers are replaced by a label such as `<old login 1>` in the notes of this folder, because some of them are accounts of real persons. The map is in `apps/lab/audit/private/people`.
- A script, a log, a shell file, and an HTML fragment have the suffix `.txt` after their real extension, so that the lint and the formatter of the repository do not read them. The copies of the record, the pictures, and the downloaded documentation pages are not kept.
