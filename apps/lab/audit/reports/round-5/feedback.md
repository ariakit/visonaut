# Feedback round 4 of the maintainer (record revision r5, received 2026-10-07)

The maintainer read revision r5 of the "Visonaut Audit" record and answered its 3 open decisions. This file is the complete input of this round. Notes are quoted exactly.

| Decision                                                                                                                    | Selection                                                                                              | Note                                                             |
| --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| D-SCALE-01 Does each run of a suite with hundreds of thousands of captures capture every screenshot?                        | `complete-runs` (Each run captures every screenshot). The record recommended no option.                | "We'll optimize capture later. No need to think about this now." |
| D-SCALE-02 What does the service do with a run in which more captures changed than one transaction and one review can hold? | `changed-limit` (A stated limit of changes for one run). It was the recommended option.                | "Let's defer this to when this is a problem."                    |
| D-SCALE-03 What happens to the D1 rows of the changed captures of a closed run?                                             | `delete-with-images` (Delete the rows of a closed run with its images). It was the recommended option. | none                                                             |

## How the coordinator read the notes

- D-SCALE-01: no conflict. The record does no design work for partial runs now.
- D-SCALE-02: the selection names the form (a stated limit), and the note defers the work. The record reads them together: the form is decided, nothing is built now, and the measurement on production D1 that sets the number waits too. This is a reading of the coordinator, and the record must say so in plain words, so that the maintainer can correct it.
- D-SCALE-03: no note. The context of the decision recommended the option "for the time of step 2 of D-DATA-02 and not before". The settled answer keeps that time.

## Standing rules (still in force)

1. D1 writes that repeat with traffic must not increase. A one-time write is acceptable (confirmed 2026-10-06).
2. No backward compatibility is necessary.
3. The simpler design wins, and what is simpler for the consumer `ariakit/ariakit`.
4. Scale: "hundreds of thousands of screenshots" means one run of that size (answered 2026-10-07). No date.
5. Future customers: "in the future we might open the service to other customers and repositories."

## What the coordinator already did

`/Users/diegohaz/.claude/jobs/f65a6229/tmp/round5/apply.mjs` ran one time. It settled the 3 decisions with a settled answer and a rationale, set `incorporated`, and set the revision to r6 (2026-10-07). All 55 decisions are settled. No decision is open.
