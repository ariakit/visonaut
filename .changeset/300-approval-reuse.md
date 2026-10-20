---
"@visonaut/service": patch
"@visonaut/web": patch
---

Approvals from earlier runs carry over

Approvals of a pull request now carry over to its main run more reliably, and the review shows where each one came from:

- **New runner images.** An approval now copies to a later run with the same image bytes when that run used another GitHub runner image or another rendering profile. Before, each such change needed a new review.
- **Whole screenshot.** **Approve all** of a screenshot now keeps the approvals that are already in force, such as copied ones, and decides only the other variants.
- **Copy source.** A copied approval now shows the mark of an automatic approval, and the capture details say "Approved in #N" with a link to the run that it came from.
