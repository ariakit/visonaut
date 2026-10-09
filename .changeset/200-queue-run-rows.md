---
"@visonaut/web": patch
---

The Queue has one row for each run

The Queue now shows the next run to review as one card, and each other run as one row of 61 pixels. On the card of a run with a title, the number opens the pull request on GitHub and the commit opens the commit on GitHub. Before this update, each run to review was a card of 240 pixels, and the page stated each count two or three times.

- **Rows.** A row is one link that covers the row. It has the state as a colored mark, the pull request title, the number, the attempt from the second attempt, the age, and the state in words. A run with no title has its number as the label, and a run of the main branch or of the merge queue has its kind and its commit.

- **Groups.** The runs to review come first. The runs that are capturing or comparing are under `Running`, and the runs that need a new capture or that failed are under `Needs attention`.

- **Counts.** A run to review says its open changes and its rejected variants, for example `17 changes · 1 rejected`, with a bar for the approved, rejected, and open variants.

- **States.** A state has the one name of the settled vocabulary: `Needs review`, `Rejected`, `Capturing`, `Comparing`, `Rerun needed`, and `Failed`.

- **Loading and errors.** While the list loads, the page shows the shape of the list. When the first read fails, a band says `Could not load runs` with the cause and the Error ID, and the header stays.

- **Removed.** The three counters, the button `Refresh runs`, and the link `View history` are removed from the Queue. The list reads again on its own, and the header has the link to History.
