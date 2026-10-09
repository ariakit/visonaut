---
"@visonaut/web": patch
---

The Queue and History show runs as rows

The Queue now shows the next run to review as one card, and each other run as one row of 61 pixels. On the card of a run with a title, the number opens the pull request on GitHub and the commit opens the commit on GitHub. Before this update, each run to review was a card of 240 pixels, and the page stated each count two or three times.

- **Rows.** A row is one link that covers the row. It has the state as a colored mark, the pull request title, the number, the attempt from the second attempt, the age, and the state in words. A run with no title has its number as the label, and a run of the main branch or of the merge queue has its kind and its commit.

- **Groups.** The runs to review come first. The runs that are capturing or comparing are under `Running`, and the runs that need a new capture or that failed are under `Needs attention`.

- **Counts.** A run to review says its open changes and its rejected variants, for example `17 changes · 1 rejected`, with a bar for the approved, rejected, and open variants.

- **States.** A state has the one name of the settled vocabulary: `Needs review`, `Rejected`, `Capturing`, `Comparing`, `Rerun needed`, and `Failed`.

- **Loading and errors.** While the list loads, the page shows the shape of the list. When the first read fails, a band says `Could not load runs` with the cause and the Error ID, and the header stays.

- **Removed.** The three counters, the button `Refresh runs`, and the link `View history` are removed from the Queue. The list reads again on its own, and the header has the link to History.

History has the same rows in place of its table.

- **Days and pull requests.** The runs are in groups by day. The runs of one pull request are one row, the row of its newest run. A button such as `2 earlier` shows the earlier runs under it.

- **Search, filter, and order.** The search field finds a run by its title, its number, or its commit. The result filter says how many runs each result has, and it counts a closed run by its last result. A new select gives the order `Newest` or `Oldest`. The three are in the URL, for example `/history?q=dialog&state=passed&sort=oldest`. A link with a number as its search text, for example `/history?q=7754`, now keeps that text.

- **Closed runs.** A closed run with a stored reason says why it closed, and its mark shows its last result when the service knows it.

- **Focus and contrast.** The search field and the two selects show a focus ring, and the placeholder of the search has a contrast of 4.5 to 1 or more.

- **Removed.** The heading, the two sentences about the 100 runs, the repository name, and the button `Refresh runs` are removed from History. One line under the list says how many runs the page shows.
