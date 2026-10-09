# Public repository: things that are not decisions

Lane `public-repository`, 2026-10-07, after the independent check. Each item gives the words of the maintainer or the measurement that closes it, what the implementation must do, and where the record states it. The four real choices are in `decisions.json` (D-PRE-41 to D-PRE-44).

## C1. Who files the issues

**Closed by:** "You can file the issues yourself." and "I authorize the implementation, the GitHub writes, the two writes to production D1, and the package publication and the change in ariakit/ariakit."

**What the implementation does:**

- It files the issues in `ariakit/visonaut` with the GitHub account that is active in the session. The workflow skill says: "preserve the authentication identity that the caller selected". The bot identity is only for the label changes of an issue (see D-PRE-43).
- It gives each issue a title that is an instruction, with no prefix and in the form of the 20 earlier issues, for example "Reduce per-image D1 writes in local Submit" (#227, measured).
- It searches the open issues first. Measured today: the repository has 0 open issues and 1 open pull request (#253, "Version packages").
- It writes each issue body from a file and reads `.body` back after the write, as the workflow skill asks.
- For each issue about a bug, it gives the consumer use case and says that the problem is on `main` today, as the workflow skill asks.
- It never puts a token, a cookie, or a session value into an issue. The two scans of this lane found none in the record, so no text of the record needs a cut for this reason.

**Where the record states it:** section `15-your-answers.html`, list `your-answers-word`, item 11. Three parts of that item are closed by the words of 2026-10-07: the implementation, the package publication, and the change in ariakit/ariakit. Two parts of the item stay: the report to Ariakit UI of the two tested rewrites (the words of 2026-10-07 do not name it), and the date (the retention tests must exist before the first image deletion, which is not before 2026-11-03). Item 4 of the same list (the two writes to production D1) is also closed by those words. The text of the 7 findings of D-PRE-41 waits for that answer.

## C2. Fewer issues, with an order

**Closed by:** "I just think we should group findings into fewer issues that make sense together and have a topological order for issues so we can work on some in parallel while others wait."

**What the implementation does:** this is a task of the issue plan, not a choice. Each issue names the issues that it waits for. This lane gives the plan three facts:

- The fixes of 7 findings are in the first group of the order: TRUST-01, AUTH-09, AUTH-16, AUTH-07, TRUST-10, AUTH-14, and TRUST-02. The answers D-AUTH-01 and D-AUTH-05 settle them, and the record gives each the effort S. The three "after the fix" options of D-PRE-41 wait for their deploy. The answer D-AUTH-02 (one GitHub App) also depends on these fixes. Other work is first too (rows 1 to 3 of D-OPS-01, the retention tests of D-DATA-01, the contract pull requests), and these groups can run at the same time.
- The one UPDATE of D-AUTH-05 in production is a part of that first group. The words of 2026-10-07 authorize it. The fix of AUTH-16 changes a contract sentence, so it waits for the contract pull request.
- The public text of the issues for OPS-01 and STATE-03 must not name TRUST-02 as the way to cause a failed GitHub read before the fix of TRUST-02 is in production. This applies only if the answer to D-PRE-41 is one of the three "after the fix" options.

**Where the record states it:** the issue plan of this round (the coordinator has it). The record has no section for it today.

## C3. The lab goes to a branch, not to main

**Closed by:** "Yes, I think we should put it in a branch when we're done with the audit."

**What the implementation does:** it commits the lab to a branch and not to `main`, and it pushes the branch when the audit ends. In each option of D-PRE-41 and D-PRE-42, the lab code, the lab documents, and the pictures are on the public branch at that time. Two parts stay open: when the folder `apps/lab/audit` is pushed (D-PRE-41), and what the branch holds of that folder (D-PRE-42). The built page `apps/lab/public/audit/index.html` is not committed: `apps/lab/.gitignore` excludes it.

**Where the record states it:** section `70-design-lab.html`, and the fragment `code-lab-branch` of this lane in section `45-code-ci-docs.html`.

## C4. The invented people of the lab

**Closed by:** nothing is necessary from the maintainer. This is a correction, and "I authorize the implementation" covers it.

**The fact (measured with the public GitHub API on 2026-10-07, two times):** `apps/lab/src/fixtures/data/people.ts`, lines 52 to 57, has 6 invented reviewers. 3 of the 6 GitHub user IDs and 4 of the 6 logins belong to real accounts of other persons. 15 text files below `apps/lab` hold one of these logins or IDs:

- 2 code files: `src/fixtures/data/people.ts` and `src/explorations/kits/ariakit/stage/details-model.ts`.
- 3 design documents: `docs/design/components/history-filter.md`, `docs/design/components/run-row.md`, and `docs/design/reviews/components.json`.
- 2 files of the record: `audit/content/decisions.json` (1 line) and `audit/content/sections/65-resilience-a11y.html` (4 lines). They have the login of the invented reviewer "Kenji Mori", which is a real account.
- 8 files of the report `audit/reports/round-2/res-05`. One of them, `probe/results/sign-in-today.json`, holds the avatar address of one of the real accounts.

The lab draws its own avatars (`people.ts`, lines 5 to 6), so no page loads a picture of these accounts. The check viewed 5 of the 12 card pictures of pages (the dark pictures of `history`, `review`, `inbox`, `pull`, and `sign-in` in `public/cards/page`): none shows a login.

**What the implementation does, before the push of the branch:**

- It gives the 6 people logins and user IDs of no real account in the 2 code files, the 3 design documents, and the 2 files of the record, and it checks each one with `gh api users/LOGIN` and `gh api user/ID` (each must answer 404).
- It writes one sentence in `people.ts` that says that the people are invented.
- It leaves the 8 raw report files as they are, or it makes them again. Raw evidence is not edited by hand. If the answer to D-PRE-42 keeps the reports out of the branch, these 8 files are not public.
- It makes a card picture again only if that picture shows a login. 7 of the 12 card pictures of pages were not viewed: the dark picture of `status`, and the 6 light pictures, which show the same pages in the other theme.

**Limit:** a login that answers 404 today can be registered tomorrow. The sentence in `people.ts` is the part that lasts.

**Where the record states it:** the fragment `code-lab-branch` of this lane.

## C5. No secret in the files, so no secret to change

**Closed by:** a measurement, not a word of the maintainer.

**The fact:** two scripts, written by two agents, read the 1,415 text files that git would add below `apps/lab`. They found no GitHub token, no private key, no JSON Web Token, no cloud key, no Authorization value, no cookie value, and no password of a real system. The 21 values after a word such as "secret" or "token" are test values of local probes: 20 are words with hyphens, and 1 is a row of digits and letters in order. The 3 values that start like a GitHub token are test names with 16 or 17 characters. The 18 e-mail addresses are at `example.com` (7) or at a host that ends in `.example` (11), so each is invented. No picture has a text chunk or an EXIF chunk.

**What the implementation does:** nothing. If D-PRE-44 is answered with the second or the third option, GitHub does this check for each branch.

**Where the record states it:** the fragment `code-lab-branch` of this lane.

## C6. The local path of the maintainer

**Closed by:** a measurement.

**The fact:** `/Users/diegohaz` is 1,690 times in 441 files of `apps/lab`. 27 tracked files of the public repository have the same path today (`git grep -l`), for example `docs/evidence/simplification-performance/verification.json`. The login `diegohaz` is public.

**What the implementation does:** nothing. A maintainer who wants the path out of the branch says so in the notes of D-PRE-42, and a script then replaces it in the 441 files. This lane does not recommend it: raw evidence would change, and the 27 tracked files would keep the path.

## C7. A reminder for the day of the first other customer

**Closed by:** the standing rule 5 ("the service may open to other customers and repositories later"). No answer is necessary now.

**The fact:** the judgment of this lane holds while only the members of one organization can sign in (measured: 10 members, of which 6 are public, and 5 of 10 collaborators of `ariakit/ariakit` have push permission). The record says the same of TRUST-01 and TRUST-02: their severity rises if the sign-in App becomes public.

**What the implementation does:** before the service takes a second customer, a person reads `sensitive-findings.json` of this lane again, and the part "Who can do what" of section 30. Item 10 of the list `your-answers-word` (rule 2 needs your word again before the first other customer) is the same kind of reminder, and this one belongs beside it.

**Where the record states it:** section `30-access-trust.html`, part `access-who`, and the fragment `access-public-issues` of this lane.

## C8. The member count in the record

**Closed by:** a measurement. No answer is necessary.

**The fact:** section `30-access-trust.html`, line 130 and the number block at line 26, says that the organization has 10 members. That is the count for an account of a member (measured). The public count is 6 (measured). So the record gives a count that the public API does not give. It names no member.

**What the implementation does:** nothing. The count is the base of the statement "only these 10 accounts can sign in", so the record needs it. A maintainer who wants the count out of the public text says so in the notes of D-PRE-42.

**Where the record states it:** section `30-access-trust.html`, part `access-who`.
