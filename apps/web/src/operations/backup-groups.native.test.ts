import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "vitest";
import { TestDatabase, captured, context, ingestRecords } from "./test-fixtures.ts";

const require = createRequire(import.meta.url);
const directory = await mkdtemp(resolve(tmpdir(), "ariviso-native-group-"));
let runtime: Miniflare | undefined;
let bundleDigest = "";
let script = "";

function dumpDatabase(database: TestDatabase) {
  const tables = database.connection
    .prepare(
      "SELECT name,sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all();
  const statements: string[] = [];
  for (const table of tables) {
    if (typeof table.sql !== "string") throw new Error("Invalid SQL schema fixture.");
    statements.push(table.sql);
  }
  for (const table of tables) {
    if (typeof table.name !== "string") throw new Error("Invalid SQL table fixture.");
    const name = `"${table.name.replaceAll('"', '""')}"`;
    for (const row of database.connection.prepare(`SELECT * FROM ${name}`).all()) {
      const columns = Object.keys(row)
        .map((name) => `"${name.replaceAll('"', '""')}"`)
        .join(",");
      const values = Object.values(row)
        .map((value) => database.connection.prepare("SELECT quote(?) AS value").get(value)?.value)
        .join(",");
      statements.push(`INSERT INTO ${name}(${columns}) VALUES(${values})`);
    }
  }
  const secondary = database.connection
    .prepare(
      "SELECT sql FROM sqlite_master WHERE type IN ('view','trigger','index') AND sql IS NOT NULL ORDER BY type,name",
    )
    .all();
  for (const row of secondary) if (typeof row.sql === "string") statements.push(row.sql);
  return statements;
}

beforeAll(async () => {
  const backups = fileURLToPath(new URL("./backups.ts", import.meta.url));
  const recovery = fileURLToPath(new URL("./recovery.ts", import.meta.url));
  const historyFormat = fileURLToPath(new URL("./history-format.ts", import.meta.url));
  const history = fileURLToPath(new URL("./history.ts", import.meta.url));
  const common = fileURLToPath(new URL("./common.ts", import.meta.url));
  await writeFile(
    resolve(directory, "worker.mjs"),
    `
    import {backupDaily,restoreBackup} from ${JSON.stringify(backups)};
    import {sanitizeRestoredDatabase} from ${JSON.stringify(recovery)};
    import {digestStream} from ${JSON.stringify(common)};
    import {readHistoryManifest,readVerifiedHistoryObject} from ${JSON.stringify(history)};
    import {parseHistoryPage} from ${JSON.stringify(historyFormat)};
    const counts={sourceGets:0,backupGets:0,backupPuts:0,databaseReads:0,databaseWrites:0};
    const measuredDatabase=db=>({prepare(sql){const statement=db.prepare(sql);return {bind(...values){return wrap(statement.bind(...values));},...wrap(statement)};},async batch(statements){const results=await db.batch(statements.map(statement=>statement.original));for(const result of results){counts.databaseReads+=result.meta.rows_read;counts.databaseWrites+=result.meta.rows_written;}return results;}});
    function wrap(statement){return {original:statement,bind(...values){return wrap(statement.bind(...values));},async first(column){const result=await statement.all();counts.databaseReads+=result.meta.rows_read;counts.databaseWrites+=result.meta.rows_written;const row=result.results?.[0]??null;return column&&row?row[column]:row;},async all(){const result=await statement.all();counts.databaseReads+=result.meta.rows_read;counts.databaseWrites+=result.meta.rows_written;return result;},async run(){const result=await statement.run();counts.databaseReads+=result.meta.rows_read;counts.databaseWrites+=result.meta.rows_written;return result;}};}
    function measuredStore(store,backup=false){return {async get(key){if(backup)counts.backupGets++;else counts.sourceGets++;return store.get(key);},async put(...args){if(backup)counts.backupPuts++;return store.put(...args);},list:options=>store.list(options),delete:keys=>store.delete(keys),createMultipartUpload:(...args)=>store.createMultipartUpload(...args)};}
    let snapshotSQL='';
    let snapshotStatements=[];
    export default {async fetch(request,env){try{
      const input=await request.json();
      if(input.action==='seed'){
        await env.DB.exec('PRAGMA defer_foreign_keys=ON');
        await env.DB.batch([env.DB.prepare('PRAGMA defer_foreign_keys=ON'),...input.statements.map(sql=>env.DB.prepare(sql))]);
        snapshotStatements=input.statements;
        snapshotSQL=input.statements.map(sql=>sql+';').join('\\n');
        for(const object of input.objects)await env[object.bucket].put(object.key,Uint8Array.from(atob(object.body),c=>c.charCodeAt(0)),{httpMetadata:{contentType:object.contentType}});
        return Response.json({seeded:input.objects.length});
      }
      const context={database:measuredDatabase(env.DB),images:measuredStore(env.IMAGES),quarantine:measuredStore(env.QUARANTINE),backups:measuredStore(env.BACKUPS,true),budget:{tasksPerStep:10,objectsPerStep:1000,leaseMilliseconds:300000,maxAttempts:3,maximumObjectBytes:2097152,maximumDatabaseBytes:16777216,maximumExportEntries:100000},now:()=>input.now,comparisons:{send(){}},github:{},origin:'https://ariviso.test'};
      if(input.action==='backup'){
        for(const key of Object.keys(counts))counts[key]=0;
        const reports=[];
        for(let step=0;step<100;step++){
          const report=await backupDaily(context,{async export(){const bytes=new TextEncoder().encode(snapshotSQL);return {body:new Blob([bytes]).stream(),bytes:bytes.length};}});
          reports.push(report);
          if(report.attention.length||report.completed.length)break;
        }
        return Response.json({reports,counts});
      }
      if(input.action==='remove-live'){
        for(const bucket of ['IMAGES','QUARANTINE']){let cursor;do{const page=await env[bucket].list({cursor});await env[bucket].delete(page.objects.map(object=>object.key));cursor=page.truncated?page.cursor:undefined;}while(cursor);}
        return Response.json({removed:true});
      }
      if(input.action==='restore'){
        const restored=await restoreBackup(env.BACKUPS,input.id,{images:env.TARGET_IMAGES,quarantine:env.TARGET_QUARANTINE,
          async assertEmpty(){const tables=await env.TARGET.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'sqlite_%'").all();if(tables.results.length)throw new Error('nonempty target');if((await env.TARGET_IMAGES.list()).objects.length)throw new Error('nonempty bucket');},
          async importDatabase(body){const text=await new Response(body).text();if(text!==snapshotSQL)throw new Error('SQL fixture changed');const statements=snapshotStatements;await env.TARGET.exec('PRAGMA defer_foreign_keys=ON');await env.TARGET.batch([env.TARGET.prepare('PRAGMA defer_foreign_keys=ON'),...statements.map(sql=>env.TARGET.prepare(sql))]);},
          async reapplyCurrentRules(){await sanitizeRestoredDatabase(env.TARGET,input.now);},
          async verifyDatabaseAndReferences(){const violations=await env.TARGET.prepare('PRAGMA foreign_key_check').all();if(violations.results.length)throw new Error('broken foreign key');const images=await env.TARGET.prepare('SELECT object_key,digest,bytes FROM ariviso_images WHERE bytes_present=1').all();for(const image of images.results){const object=await env.TARGET_IMAGES.get(image.object_key);if(!object)throw new Error('missing restored image');const verified=await digestStream(object.body,2097152);if(verified.digest!==image.digest||verified.bytes!==image.bytes)throw new Error('restored image mismatch');}}
        },context.budget);
        if(input.historyRunId){
          const restoredContext={...context,database:env.TARGET,images:env.TARGET_IMAGES,quarantine:env.TARGET_QUARANTINE};
          const root=await readHistoryManifest(restoredContext,input.historyRunId);
          if(!root)throw new Error('missing restored archive');
          const uploads=[];
          for(const reference of root.manifest.pages){if(reference.section!=='uploads')continue;const page=parseHistoryPage(await readVerifiedHistoryObject(restoredContext,reference),root.manifest,reference);uploads.push(...page.rows);}
          const liveUploads=await env.TARGET.prepare('SELECT COUNT(*) AS count FROM ingest_uploads WHERE run_id=?').bind(input.historyRunId).first('count');
          return Response.json({...restored,archivedUploads:uploads,archivedDocuments:root.manifest.counts.documents,liveUploads});
        }
        return Response.json(restored);
      }
      throw new Error('unknown action');
    }catch(error){return Response.json({error:String(error),stack:error.stack},{status:500});}}};
  `,
  );
  await writeFile(
    resolve(directory, "wrangler.json"),
    JSON.stringify({
      name: "ariviso-native-backup-group-test",
      main: "worker.mjs",
      compatibility_date: "2026-09-22",
      compatibility_flags: ["nodejs_compat"],
    }),
  );
  const wrangler = resolve(dirname(require.resolve("wrangler/package.json")), "bin/wrangler.js");
  execFileSync(
    process.execPath,
    [
      wrangler,
      "deploy",
      "--dry-run",
      "--config",
      resolve(directory, "wrangler.json"),
      "--outdir",
      resolve(directory, "dist"),
    ],
    {
      env: {
        ...process.env,
        WRANGLER_SEND_METRICS: "false",
        WRANGLER_LOG_PATH: resolve(directory, "wrangler.log"),
      },
      stdio: "pipe",
      timeout: 30000,
    },
  );
  script = await readFile(resolve(directory, "dist/worker.js"), "utf8");
  bundleDigest = createHash("sha256").update(script).digest("hex");
}, 40000);
beforeEach(() => {
  runtime = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script,
      compatibilityDate: "2026-09-22",
      compatibilityFlags: ["nodejs_compat"],
      d1Databases: ["DB", "TARGET"],
      r2Buckets: ["IMAGES", "QUARANTINE", "BACKUPS", "TARGET_IMAGES", "TARGET_QUARANTINE"],
    }),
  );
});
afterEach(async () => {
  await runtime?.dispose();
});
afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

async function request(body: unknown) {
  if (!runtime) throw new Error("Native backup runtime unavailable.");
  const response = await runtime.dispatchFetch("https://ariviso.test/", {
    method: "POST",
    body: JSON.stringify(body),
  });
  const value: unknown = await response.json();
  expect(value).not.toHaveProperty("error");
  expect(response.status).toBe(200);
  return value;
}

it.each(["none", "complete", "incomplete"])(
  "uses native D1/R2 for cold and warm groups, then restores removed source bytes (compacted ingest: %s)",
  async (ingestState) => {
    const includeArchivedIngest = ingestState !== "none";
    using database = new TestDatabase();
    const fixture = context(database);
    await captured(fixture.context, "run", "main");
    // Promotion uses the Node test store, so a native stream shim is unnecessary here:
    // pre-stage the immutable destination and let its full digest verification run.
    const serviceSnapshot = "snapshot-native";
    database.connection.exec(
      `INSERT INTO ariviso_snapshots(id,project_id,run_id,comparison_id,tested_sha,state,prefix,created_at) VALUES('${serviceSnapshot}','project','run','comparison-run','${"a".repeat(40)}','accepted','baselines/${serviceSnapshot}',0);INSERT INTO ariviso_snapshot_images(snapshot_id,capture_id,image_id,object_key,digest,copied) SELECT '${serviceSnapshot}',capture.id,image.id,'baselines/${serviceSnapshot}/original',image.digest,1 FROM ariviso_captures capture JOIN ariviso_images image ON image.id=capture.image_id`,
    );
    await fixture.images.put(`baselines/${serviceSnapshot}/original`, "original-image-bytes", {
      httpMetadata: { contentType: "image/png" },
    });
    const extraObjects = Math.max(0, Number(process.env.ARIVISO_BACKUP_SCALE ?? 2) - 2);
    if (!Number.isSafeInteger(extraObjects) || extraObjects > 9998)
      throw new Error("Invalid native backup stress size.");
    for (let index = 0; index < extraObjects; index++) {
      const key = `runs/run/extra-${index}`;
      await fixture.images.put(key, "x", { httpMetadata: { contentType: "image/png" } });
      database.connection
        .prepare(
          "INSERT INTO ariviso_images(id,run_id,digest,object_key,content_type,bytes,width,height) VALUES(?,'run','2d711642b726b04401627ca9fbac32f5c8530fb1903cc4db02258717921a4881',?,'image/png',1,1,1)",
        )
        .run(`extra-${index}`, key);
    }
    let archivedRecords;
    if (includeArchivedIngest) {
      const service = await captured(fixture.context, "archived-ingest");
      archivedRecords = await ingestRecords(fixture.context, "archived-ingest");
      if (ingestState === "incomplete") {
        const imageId = crypto.randomUUID();
        const imageKey = `runs/archived-ingest/images/${imageId}`;
        database.connection
          .prepare(
            "UPDATE ingest_uploads SET complete=0,image_id=?,image_key=? WHERE run_id='archived-ingest'",
          )
          .run(imageId, imageKey);
        archivedRecords.upload = await fixture.context.database
          .prepare("SELECT * FROM ingest_uploads WHERE run_id='archived-ingest'")
          .first();
        expect(archivedRecords.upload).toMatchObject({ complete: 0, image_id: imageId });
        expect(
          database.connection.prepare("SELECT id FROM ariviso_images WHERE id=?").get(imageId),
        ).toBeUndefined();
        expect(await fixture.images.get(imageKey)).toBeNull();
      }
      await service.retireRun({ runId: "archived-ingest", now: fixture.state.time });
      const { archiveClosedRuns } = await import("./history.ts");
      for (let step = 0; step < 50; step++) {
        const report = await archiveClosedRuns(fixture.context);
        expect(report.attention).toEqual([]);
        if (report.completed.includes("archived-ingest")) break;
      }
      expect(
        database.connection
          .prepare("SELECT detail_archived FROM ariviso_runs WHERE id='archived-ingest'")
          .get(),
      ).toEqual({ detail_archived: 1 });
      expect(
        database.connection
          .prepare("SELECT COUNT(*) AS count FROM ingest_uploads WHERE run_id='archived-ingest'")
          .get(),
      ).toEqual({ count: 0 });
    }
    const stores = [
      ["IMAGES", fixture.images],
      ["QUARANTINE", fixture.quarantine],
    ] as const;
    const objects = stores.flatMap(([bucket, store]) =>
      [...store.objects].map(([key, value]) => ({
        bucket,
        key,
        body: Buffer.from(value.bytes).toString("base64"),
        contentType: value.contentType,
      })),
    );
    const expectedBytes = objects.reduce(
      (total, object) => total + Buffer.from(object.body, "base64").length,
      0,
    );
    await request({ action: "seed", statements: dumpDatabase(database), objects });
    const cold = await request({ action: "backup", now: fixture.state.time });
    expect(cold).toMatchObject({
      reports: expect.arrayContaining([expect.objectContaining({ completed: ["2026-09-22T00Z"] })]),
      counts: {
        sourceGets: includeArchivedIngest ? expect.any(Number) : 2 + extraObjects,
        backupPuts: expect.any(Number),
      },
    });
    const warm = await request({ action: "backup", now: fixture.state.time + 43200000 });
    expect(warm).toMatchObject({
      reports: expect.arrayContaining([expect.objectContaining({ completed: ["2026-09-22T12Z"] })]),
      counts: { sourceGets: 0, backupPuts: 3 },
    });
    await request({ action: "remove-live" });
    const restored = await request({
      action: "restore",
      historyRunId: includeArchivedIngest ? "archived-ingest" : undefined,
      id: "2026-09-22T12Z",
      now: fixture.state.time + 43200000,
    });
    expect(restored).toMatchObject({
      id: "2026-09-22T12Z",
      objects: objects.length,
      bytes: expectedBytes,
    });
    if (includeArchivedIngest)
      expect(restored).toMatchObject({
        archivedUploads: [archivedRecords?.upload],
        archivedDocuments: 2,
        liveUploads: 0,
      });
    if (process.env.ARIVISO_BACKUP_EVIDENCE && !includeArchivedIngest) {
      const sources = [
        "backups.ts",
        "backup-groups.ts",
        "backup-format.ts",
        "recovery.ts",
        "common.ts",
        "object-stream.ts",
        "history-format.ts",
        "backup-groups.native.test.ts",
        "../../migrations/0009_retention_history.sql",
        "../../migrations/0010_run_history.sql",
        "../../migrations/0011_backup_groups.sql",
        "../../migrations/0012_historical_comparisons.sql",
      ];
      const sourceDigests = Object.fromEntries(
        await Promise.all(
          sources.map(async (name) => [
            name,
            createHash("sha256")
              .update(await readFile(new URL(name, import.meta.url)))
              .digest("hex"),
          ]),
        ),
      );
      await writeFile(
        process.env.ARIVISO_BACKUP_EVIDENCE,
        JSON.stringify(
          {
            objectCount: 2 + extraObjects,
            bundleDigest,
            sourceDigests,
            environment:
              "Local native workerd through Miniflare; actual D1 and R2 bindings, not hosted latency evidence",
            cold,
            warm,
            restored,
          },
          null,
          2,
        ),
      );
    }
  },
  40000,
);
