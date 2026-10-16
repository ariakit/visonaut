---
"@visonaut/web": patch
---

Repaired small points of the Queue and History pages

- A read of the run list that gets no answer now ends after 30 seconds. The page keeps its list, and the next read of the interval can start.
- A later read of the interval that works no longer moves the focus to the page content after a "Try again" that failed.
- The build keeps each font as a file, so the policy of the page does not block a font.
- A failed read of the run list for a document request now writes one log line with the safe cause.
- The text that tells a maintainer to check the database size limit now names the Status page and not "Service attention".
- Sign-in uses three routes of the sign-in library. The error route of the library is closed, because a failed sign-in already returns to the app.
