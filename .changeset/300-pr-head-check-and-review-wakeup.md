---
"@visonaut/web": patch
"@visonaut/security": patch
---

Fixed duplicate Visonaut verdicts for new pull request attempts by using one head check with a direct review link. Existing merge checks keep their required verdicts. Signed Submit completion now requests ingestion, and saved review decisions start their durable task without waiting for the shared operations consumer.
