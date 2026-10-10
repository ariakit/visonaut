---
"@visonaut/web": patch
---

The Status page shows one card of alerts and three meters

The Status page now has one card with the verdict, `All systems normal` or the number of alerts, and one row for each open alert. Under the card, three meters show the database size, the capture runs in progress, and the largest run against the screenshot limit.

- **Alert rows.** A row has the title of the alert, the affected record, and the time of the last occurrence. Open the row to read what to do, the first-seen time, and the kind, the code, and the subject of the alert. Each alert title is a heading.

- **Words for each alert kind.** Each alert kind that the service stores now has its own words. Before this update, 13 kinds showed the same general sentence, for example the alert of a scheduler step that failed. An alert has the button `Open guide` only when the operations guide has a procedure for it: the alert of a locked check, and the alert of a restored deployment.

- **Three more alerts.** The page shows an alert when the last capacity sample of the scheduler is older than 15 minutes, when a review decision failed each attempt in the last 7 days, and when a run has 90% or more of the screenshot limit. The page finds them in its reads, and the count in the header does not include them.

- **A status that the page cannot read.** When the capacity part of the answer has an unknown form, the alerts still show, and one row says which part the page could not read. Before this update, the page showed an error and no alert.

- **Loading and errors.** While the status loads, the page shows its shape. When the first read fails, a band says `Could not load the status` with the cause and the Error ID. When a later read fails, the status stays under a band that says `Could not refresh the status`.

- **Screen readers.** The page says its state one time, and then each alert that enters or leaves the list one time. When an alert closes while its row has the focus, the focus stays in the page.

- **Removed.** The heading `Service status.`, the intro text, the button `Refresh alerts`, the link `Open the operations and recovery guide` under the list, and the line `No external notifications are sent.` are removed. The page reads again each minute, and the button `More info` of the card has the sentences about the refresh and the notifications.
