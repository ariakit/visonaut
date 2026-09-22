CREATE INDEX ariviso_main_promotion_scan ON ariviso_runs(created_at, id)
  WHERE active = 1 AND kind = 'main' AND state != 'accepted';

CREATE INDEX ariviso_copying_snapshot_scan ON ariviso_snapshots(created_at, id)
  WHERE state = 'copying';
