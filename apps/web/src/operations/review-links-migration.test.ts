import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import { readTestMigrations } from "../../../../tooling/test-migrations.ts";

const dropName = "0042_drop_review_links.sql";

function migrate(database: DatabaseSync, filter: (name: string) => boolean) {
  for (const migration of readTestMigrations().filter(({ name }) => filter(name))) {
    database.exec(migration.sql);
  }
}

it("removes the mirror checks and closes their alerts, and keeps the check of a run", () => {
  using database = new DatabaseSync(":memory:");
  migrate(database, (name) => name < dropName);
  database.exec(`
    INSERT INTO operations_review_links(repository_id,pull_request_number,source_sha,external_id,check_id,request_started)
      VALUES('123',7,'head-7','visonaut:review:7:head-7','mirror',1),
        ('123',8,'head-8','visonaut:review:8:head-8',NULL,1);
    INSERT INTO work_checks(id,desired_revision,ambiguous) VALUES('mirror',2,1),('run-check',1,1);
    INSERT INTO work_status_outbox(check_id,revision,run_id,attempt,comparison_revision,source_revision,
        conclusion,details_url,state,max_attempts,available_at)
      VALUES('mirror',1,'workflow',1,0,1,'pending','https://visonaut.example/pulls/7','complete',2,1),
        ('mirror',2,'workflow',1,0,1,'success','https://visonaut.example/pulls/7','sending',2,1),
        ('run-check',1,'run',1,0,1,'pending','https://visonaut.example/runs/run','sending',2,1);
    INSERT INTO operations_events(id,kind,subject_id,code,first_seen_at,last_seen_at,resolved_at)
      VALUES('check-delivery:mirror:ambiguous','check-delivery','mirror','ambiguous',1,1,NULL),
        ('check-delivery:run-check:ambiguous','check-delivery','run-check','ambiguous',1,1,NULL),
        ('review-links:scheduler:step-failed','review-links','scheduler','step-failed',1,1,NULL),
        ('review-links:old:step-failed','review-links','old','step-failed',1,1,5);
    INSERT INTO operations_cursors(id,value) VALUES('review-links','7'),('check-attention','run-check');
  `);

  migrate(database, (name) => name === dropName);

  const rows = (sql: string) => database.prepare(sql).all();
  expect(rows("SELECT name FROM sqlite_schema WHERE name='operations_review_links'")).toEqual([]);
  expect(rows("SELECT id FROM work_checks")).toEqual([{ id: "run-check" }]);
  expect(rows("SELECT check_id,revision FROM work_status_outbox")).toEqual([
    { check_id: "run-check", revision: 1 },
  ]);
  expect(rows("SELECT id FROM operations_cursors")).toEqual([{ id: "check-attention" }]);
  expect(rows("SELECT id FROM operations_events WHERE resolved_at IS NULL")).toEqual([
    { id: "check-delivery:run-check:ambiguous" },
  ]);
  // An alert that was already closed keeps its time.
  expect(
    rows("SELECT resolved_at FROM operations_events WHERE id='review-links:old:step-failed'"),
  ).toEqual([{ resolved_at: 5 }]);
});
