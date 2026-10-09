# Research record of feedback round 3

This folder holds the work behind revisions r4 and r5 of the audit document.

- `feedback.md`: the feedback of the maintainer that revision r4 merged. It settled D-OPS-04 and D-DATA-02.
- `sections`: the results of the editor and of the checker that brought the sections in line with revision r4. The checker also read the two new answers together with the 50 others.
- `scale`: the research for revision r5. The maintainer said on 2026-10-07 that "hundreds of thousands of screenshots" means one run of that size. The lane studied the settled design at 100,000 to 500,000 captures in one run, with an independent check, and proposed the decisions D-SCALE-01 to D-SCALE-03.

A script and a log have the suffix `.txt` after their real extension, for example `d1-scale.probe.ts.txt`. So the lint, the formatter, and the type check of the repository do not read them. Remove the suffix to run a script. The scripts ran from a scratch folder, so their paths need a change first.

Not kept: pictures, dependencies, build outputs, copies of the record, and copies of documents of other projects. The notes name the source of each one.
