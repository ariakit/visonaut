# What the maintainer said on 2026-10-07

This was a chat message, not a continuation prompt. It answered a proposal for the implementation that had four numbered points.

## His exact words

> 1. I don't know, shouldn't these be decisions in the artifact? I don't remember what they mean.
> 2. Yes, I think we should put it in a branch when we're done with the audit.
> 3. Ok
> 4. You can file the issues yourself. I just think we should group findings into fewer issues that make sense together and have a topological order for issues so we can work on some in parallel while others wait.
>
> I authorize the implementation, the GitHub writes, the two writes to production D1, and the package publication and the change in ariakit/ariakit.

## What each point answered

1. The list "What still needs your word" of the record, with 11 items. The proposal asked him to answer three of them first.
2. The lab (`apps/lab`) goes to a branch and not to `main`.
3. The contract is updated first, in its own pull requests: one moves the history, and one edits the contract lines.
4. One issue for each step, written from the record. The proposal offered drafts for his review before the filing.

## How the record reads it

- Each of the 11 items is now a decision with its evidence, or it is closed with the reason. Revision r9 has 12 new open decisions.
- The issue plan has 22 issues in 5 levels. An edge names the pull requests that must be merged, not a complete issue.
- The authorization is read narrowly. It does not name the read-only reads of production, a report in `ariakit/ariakit` of the two CSS rewrites, a change of a repository setting, or new labels. Each one is an open decision.
- The repository is public. So the filing of the issues and the push of the branch wait for the answers to D-PRE-09 and D-PRE-10.
