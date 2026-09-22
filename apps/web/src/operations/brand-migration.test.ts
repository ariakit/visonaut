import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";

it("renames the existing service schema without losing capture references or profile checks", () => {
  const database = new DatabaseSync(":memory:");
  try {
    const directory = new URL("../../migrations/", import.meta.url);
    const migrations = readdirSync(directory)
      .filter((name) => name.endsWith(".sql"))
      .sort();
    for (const name of migrations.filter((name) => !name.startsWith("0014_"))) {
      database.exec(readFileSync(new URL(name, directory), "utf8"));
    }
    database.exec(`
      INSERT INTO ariviso_policies(digest,policy_json) VALUES('policy','{}');
      INSERT INTO ariviso_projects(id,repository_id,policy_digest) VALUES('project','repo','policy');
      INSERT INTO ariviso_runs(id,project_id,external_run_id,attempt,kind,tested_sha,lineage_key,plan_digest,plan_json,created_at)
      VALUES('run','project','external',1,'main','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','lineage','plan','{}',1);
      INSERT INTO ariviso_shards(run_id,key,profile_digest,expected_json) VALUES('run','shard','profile','{}');
      INSERT INTO ariviso_images(id,run_id,digest,object_key,content_type,bytes,width,height)
      VALUES('image','run','digest','runs/run/original','image/png',3,1,1);
      INSERT INTO ariviso_capture_profiles(digest,profile_json) VALUES('profile','{}');
      INSERT INTO ariviso_captures(id,run_id,shard_key,item_key,variant_key,ordinal,image_id,profile_digest,test_id,test_retry,metadata_json)
      VALUES('capture','run','shard','item','variant',0,'image','profile','test',0,
        '{"profile":{"$arivisoProfileDigest":"profile"}}');
    `);

    database.exec(readFileSync(new URL("0014_visonaut_brand.sql", directory), "utf8"));

    const metadata = database
      .prepare("SELECT metadata_json FROM visonaut_captures WHERE id='capture'")
      .get() as { metadata_json: string };
    expect(JSON.parse(metadata.metadata_json)).toEqual({
      profile: { $visonautProfileDigest: "profile" },
    });
    expect(
      database.prepare("SELECT name FROM sqlite_master WHERE lower(name) LIKE '%ariviso%'").all(),
    ).toEqual([]);
    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(() =>
      database.exec("UPDATE visonaut_captures SET profile_digest='missing' WHERE id='capture'"),
    ).toThrow();
    expect(database.prepare("PRAGMA integrity_check").get()).toMatchObject({
      integrity_check: "ok",
    });
  } finally {
    database.close();
  }
});
