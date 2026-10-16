---
"@visonaut/web": patch
---

Repaired small points of the header, the not found page, and the Status page

- The header of a pull request page that opens by its URL now names the signed-in account in place of "Account", and its Status link has the count of open alerts.
- The wordmark link of the header is no longer the current page. Only the Queue link of the nav says that.
- The document of a URL that the app does not have has one title, "Page not found · Visonaut".
- The Status page says a change of the number in an alert that stays, for example "2 review decisions failed".
- With more than 50 open alerts, an old alert that enters the list is no longer said as a new alert.
- A scheduled pass that could not measure the database no longer shows "The scheduled pass is late". The alert "Database capacity needs attention" gives the cause.
