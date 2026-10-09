# Feedback round 6

The maintainer gave this feedback on 2026-10-07 with the continuation prompt of revision r9. It has 12 of 70 decisions. The other decisions did not change. The text below is the prompt as he gave it.

D-PRE-04: Who looks at the live service to get the five facts that the record does not have?
Answer: The implementation makes each read, also in the dashboard (option `all-by-implementation`)
Notes: none

D-PRE-09: When does the public repository get the steps to use 7 findings: now, or after their fix is in production?
Answer: After the fix: short issues, and the audit folder waits (option `after-fix`)
Notes: none

D-PRE-12: Does the public repository get secret scanning alerts and a private form for security reports?
Answer: Secret scanning alerts and private vulnerability reporting, as in ariakit/ariakit (option `same-as-ariakit`)
Notes: none

D-PRE-02: When a background pass fails, the log will say where it failed. May the log also say why?
Answer: 2. Add three fixed values: error name, error code, and GitHub status (option `fixed-cause`)
Notes: none

D-PRE-06: What does the service write to D1 for a GitHub webhook that starts no work?
Answer: No row (option `no-receipt`)
Notes: none

D-PRE-03: When Submit fails because of one screenshot file, may the message of the CLI name that screenshot in the CI log?
Answer: 2. Print the item key, the variant key, and the two numbers (option `keys-in-message`)
Notes: none

D-PRE-01: A pull request can now replace the job that checks each screenshot file. Must the service check the files itself before it stores them?
Answer: 1. No new check: keep the size and the digest (option `size-and-digest-only`)
Notes: none

D-PRE-05: Where does the saved text of issue #1 go when the history moves to docs/history/?
Answer: It moves with its folder (option `move-with-folder`)
Notes: none

D-PRE-10: What does the public branch with the lab hold?
Answer: Everything below apps/lab (option `everything`)
Notes: none

D-PRE-11: Do the new issues get priority and difficulty labels?
Answer: Create p0, p1, p2, easy, and hard, and label each issue (option `priority-and-difficulty`)
Notes: You can also remove the existing labels from the repo and copy the relevant ones (the ones that make sense for this project) from the ariakit/ariakit repo, including colors. You can also create new labels if you think it makes sense. No need to ask me.

D-PRE-08: The audit tested two CSS rewrites for Ariakit UI in the lab. Does it report them in ariakit/ariakit, and in which form?
Answer: One issue in ariakit/ariakit (option `issue`)
Notes: none

D-PRE-07: The review design that you settled in the lab breaks some UI rules of the contract. How does the contract approve the design?
Answer: Write the new UI rules into the contract (option `rules-in-contract`)
Notes: none

## Where an answer differs from the recommendation

- D-PRE-04: the recommended option was `commands-by-implementation`. The maintainer selected `all-by-implementation`.
- D-PRE-07: the recommended option was `rule-by-reference`. The maintainer selected `rules-in-contract`.

Each other answer is the recommended option.
