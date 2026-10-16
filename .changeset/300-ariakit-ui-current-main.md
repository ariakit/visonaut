---
"@visonaut/web": patch
---

Updated the copied Ariakit UI primitives to the current Ariakit version

The pages use the Ariakit UI primitives of [ariakit/ariakit@dce9723](https://github.com/ariakit/ariakit/commit/dce9723d3575c88ab038995e4993d7a1fce94afe). The visible changes come from upstream:

- **No hover or focus glider.** A row, a nav link, or a variant mark paints its own hover surface. Only the selected control has a glider.
- **A lighter dark scheme.** The dark canvas is lighter, and the layers above it have stronger steps.
- **Brand buttons.** A brand button, for example "Sign in with GitHub" or "Review", is a little darker (`rgb(0 104 184)` in place of `rgb(0 106 187)`).

In the style test of the review page (41 changed screenshots), one arrow key recalculates the style of 71 elements in place of 76, and one approval 75 in place of 80.
