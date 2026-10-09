---
"@visonaut/web": patch
---

Changed the answer of a saved decision to its receipt. The answer has the stored result of the decision, the reviewer, the review state of the run with its three counts, and the run revision at the time of the answer. It has no run model. The run page applies the receipt to the model that it holds, and it reads the model again only when the run revision is not the one that it expects, for example after a decision of another reviewer. In the test of one decision, the read of a receipt makes 6 database round trips in place of 17. A conflict, a decision that failed each attempt, and Undo still answer with the model.
