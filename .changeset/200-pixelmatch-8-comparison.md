---
"visonaut": patch
---

Comparison with pixelmatch 8

Submit now compares captures with pixelmatch 8, which measures color differences in the OKLab color space. Before, Submit used the YIQ metric of the pixelmatch that Playwright `1.63.0` bundles. pixelmatch 8 also blends semi-transparent pixels with a checkerboard pattern and not with white, so a change of transparency alone can count as a changed pixel. The comparison settings keep their meaning and their scale, but for the same images Submit can count other changed pixels than Playwright's `toHaveScreenshot`. If a capture depends on a tuned `threshold` or has transparent areas, examine its outcome after the upgrade.

Submit no longer sends the names of its comparison engine and image codec, and it sends the CLI version in their place. The review shows this version. An approval does not depend on the engine, so an approval of a change copies to a run of this release when the images are the same.
