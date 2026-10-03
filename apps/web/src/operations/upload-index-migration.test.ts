import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { afterAll, expect, it } from "vitest";
import { applyTestMigrations, readTestMigrations } from "../../../../tooling/test-migrations.ts";

const runtime = new Miniflare(
  convertV4MiniflareOptions({
    modules: true,
    script: "export default { fetch() { return new Response('upload indexes'); } }",
    compatibilityDate: "2026-09-22",
    d1Databases: ["DB"],
  }),
);
afterAll(async () => runtime.dispose());

it("migrates existing uploads without changing records and removes two image writes", async () => {
  const database = await runtime.getD1Database("DB");
  await applyTestMigrations(database, { through: "0031_check_heads" });
  await database.batch([
    database.prepare("INSERT INTO visonaut_policies(digest,policy_json) VALUES('policy','{}')"),
    database.prepare(
      "INSERT INTO visonaut_projects(id,repository_id,policy_digest) VALUES('project','repository','policy')",
    ),
    database.prepare(
      "INSERT INTO visonaut_runs(id,project_id,external_run_id,attempt,kind,tested_sha,lineage_key,plan_digest,plan_json,created_at) VALUES('run','project','workflow',1,'main','sha','main','plan','{}',1)",
    ),
    database.prepare(
      "INSERT INTO ingest_staged_runs(id,repository_id,workflow_run_id,workflow_attempt,tested_sha,workflow_source_digest,caller_workflow_path,reusable_workflow_ref,capture_job_prefix,submit_job_name,verified_json,submitted_at,created_at) VALUES('run','repository','workflow',1,'sha','source','workflow','ref','capture','submit','{}',1,1)",
    ),
    database.prepare(
      "INSERT INTO ingest_staged_bundles(run_id,job_id,check_run_id,shard_key,job_name,verified_json,created_at) VALUES('run','complete','complete','complete','submit','{}',1),('run','pending','pending','pending','submit','{}',1)",
    ),
    database.prepare(
      "INSERT INTO ingest_staged_images(run_id,job_id,digest,media_type,bytes,width,height,image_id,object_key,quarantine_key,complete) VALUES('run','complete','existing','image/png',94,2,2,'existing-complete','runs/run/images/existing-complete','quarantine/complete',1),('run','pending','existing','image/png',94,2,2,'existing-pending','runs/run/images/existing-pending','quarantine/pending',0)",
    ),
  ]);

  const measureImageWrites = async (phase: string) => {
    const registered = await database
      .prepare(
        "INSERT INTO visonaut_images(id,run_id,digest,object_key,content_type,bytes,width,height) VALUES(?,'run',?,?,'image/png',94,2,2)",
      )
      .bind(`image-${phase}`, phase, `runs/run/images/${phase}`)
      .run();
    const declared = await database
      .prepare(
        "INSERT INTO ingest_staged_images(run_id,job_id,digest,media_type,bytes,width,height,image_id,object_key,quarantine_key) VALUES('run','complete',?,'image/png',94,2,2,?,?,?)",
      )
      .bind(phase, `staged-${phase}`, `runs/run/images/staged-${phase}`, `quarantine/${phase}`)
      .run();
    const completed = await database
      .prepare(
        "UPDATE ingest_staged_images SET complete=1 WHERE run_id='run' AND job_id='complete' AND digest=?",
      )
      .bind(phase)
      .run();
    // These native counters include index writes; fixture and migration costs
    // are separate from the three measured image operations.
    return [registered, declared, completed].map(({ meta }) => ({
      writes: meta.rows_written,
      reads: meta.rows_read,
    }));
  };
  expect(await measureImageWrites("before")).toEqual([
    { writes: 5, reads: 1 },
    { writes: 5, reads: 0 },
    { writes: 2, reads: 1 },
  ]);
  const previousImages = await database.prepare("SELECT * FROM visonaut_images ORDER BY id").all();
  const previousUploads = await database
    .prepare("SELECT * FROM ingest_staged_images ORDER BY run_id,job_id,digest")
    .all();
  const migration = readTestMigrations({ through: "0032_upload_indexes" }).at(-1);
  if (!migration) throw new Error("Expected the upload index migration.");
  const statements = migration.sql
    .split(";")
    .map((sql) => sql.trim())
    .filter(Boolean);
  await database.batch(statements.map((sql) => database.prepare(sql)));
  expect(
    (await database.prepare("SELECT * FROM visonaut_images ORDER BY id").all()).results,
  ).toEqual(previousImages.results);
  expect(
    (
      await database
        .prepare("SELECT * FROM ingest_staged_images ORDER BY run_id,job_id,digest")
        .all()
    ).results,
  ).toEqual(previousUploads.results);
  expect(await measureImageWrites("after")).toEqual([
    { writes: 4, reads: 1 },
    { writes: 4, reads: 0 },
    { writes: 2, reads: 1 },
  ]);

  expect(
    (
      await database
        .prepare(
          "SELECT image_id FROM ingest_staged_images WHERE digest='existing' AND complete=1 ORDER BY run_id",
        )
        .all()
    ).results,
  ).toEqual([{ image_id: "existing-complete" }]);
  expect(
    await database
      .prepare(
        "SELECT image_id,complete FROM ingest_staged_images WHERE run_id='run' AND job_id='pending' AND quarantine_key='quarantine/pending'",
      )
      .first(),
  ).toEqual({ image_id: "existing-pending", complete: 0 });
  const indexes = await database
    .prepare(
      "SELECT name FROM sqlite_schema WHERE type='index' AND name IN ('visonaut_images_run','visonaut_images_run_role_key','visonaut_captures_run','visonaut_rows_comparison') ORDER BY name",
    )
    .all();
  expect(indexes.results).toEqual([
    { name: "visonaut_captures_run" },
    { name: "visonaut_images_run" },
    { name: "visonaut_rows_comparison" },
  ]);
  const plan = await database
    .prepare(
      "EXPLAIN QUERY PLAN SELECT image_id FROM ingest_staged_images WHERE digest='existing' AND complete=1",
    )
    .all<{ detail: string }>();
  expect(plan.results.some(({ detail }) => detail.includes("ingest_staged_images_reuse"))).toBe(
    true,
  );
  expect((await database.prepare("PRAGMA foreign_key_check").all()).results).toEqual([]);
});
