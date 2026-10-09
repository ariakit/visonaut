---
"@visonaut/web": patch
---

Each page has its own path

The Queue is at `/`, History is at `/history`, and Status is at `/status`. Before this update, History and Status were views of `/` with the search parameter `view`.

- **Old links.** A link with `/?view=history` or `/?view=service` now opens the Queue. No redirect exists.

- **History.** The search text and the result filter are in the URL, for example `/history?q=dialog&state=passed`. A reload or a shared link keeps them.
