import { describe, expect, it } from "vitest";
import {
  archiveClosedRuns,
  readHistoryManifest,
  readRunHistory,
  readVerifiedHistoryObject,
  writeHistoryStep,
  type HistoryProgress,
} from "./history.ts";
import { historySections, parseHistoryPage } from "./history-format.ts";
import { captured, context, TestDatabase } from "./test-fixtures.ts";

function completedTasks(database: TestDatabase, count: number, resultSize = 0) {
  const insertRow = database.connection.prepare(
    "INSERT INTO visonaut_comparison_rows(id,comparison_id,item_key,variant_key,ordinal,candidate_capture_id,tuple_json,outcome,result_json) VALUES(?,'comparison-run',?,'light',?,'capture-run','{}','changed',?)",
  );
  const insertTask = database.connection.prepare(
    "INSERT INTO work_tasks(id,kind,payload,state,attempts,max_attempts,available_at,result,created_at,updated_at) VALUES(?,'compare',?,'complete',1,2,0,?,0,0)",
  );
  database.connection.exec("BEGIN");
  try {
    for (let index = 0; index < count; index++) {
      const id = `task-${String(index).padStart(6, "0")}`;
      const result = JSON.stringify({
        outcome: "changed",
        changedPixels: 1,
        ratio: 0.01,
        engineVersion: "engine",
        codecVersion: "codec",
        detail: 'é\\\"'.repeat(resultSize),
      });
      insertRow.run(id, id, index + 1, result);
      insertTask.run(id, JSON.stringify({ taskId: id }), result);
    }
    database.connection.exec("COMMIT");
  } catch (error) {
    database.connection.exec("ROLLBACK");
    throw error;
  }
}

async function sectionPages(input: { count: number; maximumBytes: number; resultSize?: number }) {
  using database = new TestDatabase();
  const fixture = context(database);
  await captured(fixture.context);
  completedTasks(database, input.count, input.resultSize);
  fixture.context.budget.maximumObjectBytes = input.maximumBytes;
  const progress: HistoryProgress = {
    section: historySections.indexOf("tasks"),
    cursor: "",
    pages: [],
  };
  const ids: string[] = [];
  let root: { key: string; digest: string; bytes: number } | null = null;
  for (let step = 0; step < input.count * 2 + 5; step++) {
    const result = await writeHistoryStep(fixture.context, {
      runId: "run",
      generation: "packing",
      progress,
      limit: 2,
      async onPage(section, rows) {
        if (section === "tasks") ids.push(...rows.map((row) => String(row.id)));
      },
    });
    expect(result.pagesWritten).toBeLessThanOrEqual(2);
    root = result.root;
    if (root) break;
  }
  expect(root).not.toBeNull();
  expect(ids).toEqual(
    Array.from({ length: input.count }, (_, index) => `task-${String(index).padStart(6, "0")}`),
  );
  expect(progress.verifiedPages).toBe(progress.pages.length);
  expect(progress.pages.every((page) => page.bytes <= input.maximumBytes)).toBe(true);
  return progress;
}

describe("bounded archive row packing", () => {
  it("packs small completed tasks while preserving the exact continuation cursor", async () => {
    const progress = await sectionPages({ count: 205, maximumBytes: 1024 * 1024 });
    expect(progress.pages.map((page) => page.rows)).toEqual([200, 5]);
    expect(progress.pages.map((page) => page.lastCursor)).toEqual(["task-000199", "task-000204"]);
  });

  it("splits larger escaped UTF-8 rows by encoded bytes without skipping a row", async () => {
    const progress = await sectionPages({ count: 9, maximumBytes: 4096, resultSize: 80 });
    expect(progress.pages.length).toBeGreaterThan(1);
    expect(progress.pages.some((page) => page.rows > 1)).toBe(true);
    expect(progress.pages.reduce((total, page) => total + page.rows, 0)).toBe(9);
  });

  it("bounds wide command reads before packing and resumes every remaining row", async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    await captured(fixture.context);
    fixture.context.budget.maximumObjectBytes = 2 * 1024 * 1024;
    const insert = database.connection.prepare(
      "INSERT INTO visonaut_commands(id,request_json,actor_id,session_id,kind,comparison_id,previous_json,result_json,created_at) VALUES(?,'{}','actor','session','approve','comparison-run',?,'{}',0)",
    );
    for (let index = 0; index < 5; index++) {
      insert.run(`command-${index}`, JSON.stringify({ notes: "é".repeat(200_000) }));
    }
    const progress: HistoryProgress = {
      section: historySections.indexOf("commands"),
      cursor: "",
      pages: [],
    };
    const commands: string[] = [];
    for (let step = 0; step < 10 && commands.length < 5; step++) {
      await writeHistoryStep(fixture.context, {
        runId: "run",
        generation: "commands",
        progress,
        limit: 1,
        async onPage(section, rows) {
          if (section === "commands") commands.push(...rows.map((row) => String(row.id)));
        },
      });
    }
    expect(commands).toEqual(["command-0", "command-1", "command-2", "command-3", "command-4"]);
    expect(
      progress.pages.filter((page) => page.section === "commands").map((page) => page.rows),
    ).toEqual([2, 2, 1]);
    expect(progress.pages.every((page) => page.bytes <= 1024 * 1024)).toBe(true);
  });

  it("hydrates derived-image history from dense pages without losing image identities", async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    const service = await captured(fixture.context);
    const insert = database.connection.prepare(
      "INSERT INTO visonaut_images(id,run_id,digest,object_key,content_type,bytes,width,height,role,validated,bytes_present) VALUES(?,'run','digest',?,'image/png',80,10,10,'mask',1,1)",
    );
    for (let index = 0; index < 205; index++) {
      const id = `mask-${String(index).padStart(4, "0")}`;
      insert.run(id, `derived/run/${id}`);
    }
    await service.retireRun({ runId: "run", now: fixture.context.now() });
    fixture.context.budget.objectsPerStep = 1000;
    for (let step = 0; step < 10; step++) {
      const report = await archiveClosedRuns(fixture.context);
      expect(report.attention).toEqual([]);
      if (report.completed.includes("run")) break;
      expect(step).toBeLessThan(9);
    }
    const history = await readRunHistory(fixture.context, "run");
    expect(
      history?.manifest.pages.filter((page) => page.section === "images").map((page) => page.rows),
    ).toEqual([200, 6]);
    expect(history?.sections.images?.map((row) => row.id)).toEqual([
      "image-run",
      ...Array.from({ length: 205 }, (_, index) => `mask-${String(index).padStart(4, "0")}`),
    ]);
  });

  it("bounds command work across all candidate runs in one invocation", async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    const insert = database.connection.prepare(
      "INSERT INTO visonaut_commands(id,request_json,actor_id,session_id,kind,comparison_id,previous_json,result_json,created_at) VALUES(?,'{}','actor','session','approve',?,'{}','{}',0)",
    );
    for (const runId of ["first", "second", "third"]) {
      const service = await captured(fixture.context, runId);
      for (let index = 0; index < 500; index++) {
        insert.run(`${runId}-${String(index).padStart(4, "0")}`, `comparison-${runId}`);
      }
      await service.retireRun({ runId, now: fixture.context.now() });
    }
    fixture.context.budget.objectsPerStep = 1000;
    fixture.context.budget.tasksPerStep = 3;
    const completed = new Set<string>();
    for (let step = 0; step < 40; step++) {
      const before = database.preparedQueries;
      const report = await archiveClosedRuns(fixture.context);
      expect(report.attention).toEqual([]);
      expect(database.preparedQueries - before).toBeLessThan(1000);
      for (const runId of report.completed) {
        completed.add(runId);
      }
      if (completed.size === 3) break;
      expect(step).toBeLessThan(39);
    }
    for (const runId of completed) {
      const root = await readHistoryManifest(fixture.context, runId);
      expect(root?.manifest.counts.commands).toBe(500);
    }
    expect(completed.size).toBe(3);
  });

  it("refuses a single oversized row without advancing the archive cursor", async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    await captured(fixture.context);
    completedTasks(database, 1, 300);
    fixture.context.budget.maximumObjectBytes = 1024;
    const progress: HistoryProgress = {
      section: historySections.indexOf("tasks"),
      cursor: "",
      pages: [],
    };
    await expect(
      writeHistoryStep(fixture.context, {
        runId: "run",
        generation: "oversized",
        progress,
        limit: 20,
        async onPage() {},
      }),
    ).rejects.toThrow("A history row exceeds");
    expect(progress.cursor).toBe("");
    expect(progress.pages).toEqual([]);
  });

  it("archives 35,820 completed comparison tasks below the 4,096 page limit", async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    const service = await captured(fixture.context);
    completedTasks(database, 35_820);
    await service.retireRun({ runId: "run", now: fixture.context.now() });
    fixture.context.budget.objectsPerStep = 1000;
    for (let step = 0; step < 500; step++) {
      const report = await archiveClosedRuns(fixture.context);
      expect(report.attention).toEqual([]);
      if (report.completed.includes("run")) break;
      expect(step).toBeLessThan(499);
    }
    const root = await readHistoryManifest(fixture.context, "run");
    if (!root) throw new Error("Archive did not complete");
    expect(root.manifest.counts.tasks).toBe(35_820);
    expect(root.manifest.pages.filter((page) => page.section === "tasks")).toHaveLength(180);
    expect(root.manifest.pages.length).toBeLessThan(4096);
    const taskIds: string[] = [];
    for (const reference of root.manifest.pages) {
      if (reference.section !== "tasks") continue;
      const page = parseHistoryPage(
        await readVerifiedHistoryObject(fixture.context, reference),
        root.manifest,
        reference,
      );
      taskIds.push(...page.rows.map((row) => String(row.id)));
    }
    expect(taskIds).toHaveLength(35_820);
    expect(new Set(taskIds).size).toBe(35_820);
    expect(taskIds[0]).toBe("task-000000");
    expect(taskIds.at(-1)).toBe("task-035819");
    expect((await service.run("run")).detail_archived).toBe(1);
    expect(
      database.connection.prepare("SELECT COUNT(*) AS count FROM work_tasks").get()?.count,
    ).toBe(0);
  }, 30_000);
});
