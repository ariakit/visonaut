---
"@visonaut/web": patch
---

One D1 round trip for the Service status read

The Service status read (`/api/operations`) now sends its three reads in one D1 batch. In the local D1 fixture, one status request makes 1 D1 round trip instead of 3, which is 67% fewer. The request reads the same number of rows and sends the same answer.
