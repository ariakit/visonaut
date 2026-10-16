---
"@visonaut/web": patch
"@visonaut/service": patch
---

Added the pixelmatch 8 engine of the new CLI to the engines that Submit accepts. A Submit of an earlier CLI with the engine `playwright-pixelmatch-1.63.0` is still accepted. Each review row now records the engine of its Submit, and the review shows that engine. Before, each row recorded the engine of the service release.
