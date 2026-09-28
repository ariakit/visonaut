---
"@visonaut/web": patch
---

Delivered independent GitHub check updates with bounded parallel requests. In the four-check regression fixture, three PATCH requests overlapped, a 3× increase in concurrent status delivery over serial execution. Each check still keeps its own delivery fence when GitHub's response is uncertain.
