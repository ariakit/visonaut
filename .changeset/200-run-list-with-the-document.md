---
"@visonaut/web": patch
"@visonaut/security": patch
---

The run list starts with the document

The server now starts the read of the run list while it sends the document of the Queue or of History. The document sends the page shell first and the list after it, so the page needs no second request for its first list.

- **Between pages.** A move between the Queue and History reads nothing. A return to the Queue from a run shows the last list at once and reads again in the background.

- **Refresh.** A new read of the list keeps the list, the scroll position, and the focus while it runs.

- **Status.** The Status page reads only the alerts, so it also loads when the run list fails.

- **Failures.** A failed read of the run list says its cause in one sentence, with the reference of the request when the service gives one.

- **Sessions.** The read that starts with the document does not renew the session, because its answer cannot set a cookie. The next request of the page renews it. The access check is the same as for each other request.
