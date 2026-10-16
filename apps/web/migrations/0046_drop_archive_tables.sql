-- No statement of the Worker reads or writes these tables since the archive
-- writer, the legacy summary converter, and the deletion of the summary
-- copies were removed (#336). Production held no row of the two archive
-- tables. A dropped table takes its indexes with it, and no trigger names
-- these tables. The view reads the archive tables, so it goes first.
DROP VIEW operations_ready_history_archives;
DROP TABLE operations_comparison_archives;
DROP TABLE operations_run_archives;
DROP TABLE visonaut_summary_conversion_pages;
DROP TABLE visonaut_closed_summary_decisions;
DROP TABLE visonaut_closed_summary_rows;
