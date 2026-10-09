---
"@visonaut/web": patch
---

Colored the error text and used the text color scale for muted text

Error text, the warning icon, and the success icon had a color class that matched no rule, so they kept the body color. They now take their color from the text system. Muted text now uses the text color scale instead of `opacity`, so it keeps a readable contrast. The variant strip of the review page has its bar glider again.
