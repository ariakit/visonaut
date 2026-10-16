---
"visonaut": patch
---

Comparison with pixelmatch 8

Submit now compares captures with pixelmatch 8, which measures color differences in the OKLab color space. Before, Submit used the YIQ metric of the pixelmatch that Playwright `1.63.0` bundles. pixelmatch 8 also blends semi-transparent pixels with a checkerboard pattern and not with white, so a change of transparency alone can count as a changed pixel. The comparison settings keep their meaning and their scale, but for the same images Submit can count other changed pixels than Playwright's `toHaveScreenshot`. If a capture depends on a tuned `threshold` or has transparent areas, examine its outcome after the upgrade.

The review rows of a run from this release record the engine `pixelmatch-8.0.0`. An approval of a row from an earlier release does not copy to a row with this engine.
