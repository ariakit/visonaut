---
"@visonaut/web": patch
---

Changed a review read of a capture list to check the key, the size, and the digest of the stored bytes, with no second validation of the content: in local workerd, the read of the two lists of a run with 3,832 screenshots takes 88 ms instead of 552 ms. Submit, promotion, and recovery keep the complete validation.
