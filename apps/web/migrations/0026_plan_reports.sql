ALTER TABLE pre_run_checks ADD COLUMN plan_visual_required INTEGER CHECK(plan_visual_required IN (0,1));
ALTER TABLE pre_run_checks ADD COLUMN plan_reported_at INTEGER;
ALTER TABLE pre_run_checks ADD COLUMN plan_job_id TEXT;
ALTER TABLE pre_run_checks ADD COLUMN plan_workflow_sha TEXT;
