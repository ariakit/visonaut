---
"@visonaut/web": patch
---

Dropped the unused D1 tables `operations_run_archives`, `operations_comparison_archives`, `visonaut_summary_conversion_pages`, `visonaut_closed_summary_rows`, and `visonaut_closed_summary_decisions`, and the view `operations_ready_history_archives`, with migration 0046. No code read or wrote them any more, and production held no archive.
