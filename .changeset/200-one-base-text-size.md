---
"@visonaut/web": patch
---

One base text size for each page

Each page sets a base text size of 14px, and controls and other text take it instead of 13px.

- The pull request page and the run page, which used 16px, now use 14px.
- The smallest texts, which were 10px and 11px, are now 12px.
- The title of the review page is now the upstream heading at 24.5px for every width, where it was 24px or 28px. Its line is a little shorter.
- A few small buttons are about 4px lower, because they no longer force a 20px line.
