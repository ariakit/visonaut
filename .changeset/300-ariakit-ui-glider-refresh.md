---
"@visonaut/web": patch
---

Updated the copied Ariakit UI primitives to the version with the glider fix

The hover and selected gliders of the nav and the button rows now use selectors that limit style invalidation in Chrome, so a pointer move between two rows or the removal of a tooltip is meant to make Chrome recalculate fewer elements in a long list, such as an open review folder. The rows look and behave the same.
