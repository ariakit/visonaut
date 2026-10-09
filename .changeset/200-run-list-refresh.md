---
"@visonaut/web": patch
---

The run list refreshes on its own

The Queue and History now read the run list again with no action of the person.

- **When.** The list reads again when the tab becomes visible, and each minute while it is visible. While a run is capturing or comparing, it reads each 15 seconds. A hidden tab sends no request.

- **A failed read.** When a refresh fails, the page keeps the list. A band above it says `Could not refresh runs` with the age of the list and the cause, and it has the button `Try again`. Before this update, a failed read replaced the list with an error screen.

- **No access.** A read that the service refuses because the session ended, or because the account has no access, still replaces the list at once.
