import { describe, expect, it } from "vitest";
import { TestDatabase } from "../operations/test-fixtures.ts";
import { operationsStatus } from "./operations.ts";

function addProject(database: TestDatabase, id = "ariakit", repositoryId = "104133653") {
  database.connection
    .prepare("INSERT INTO ariviso_projects(id,repository_id,policy_digest) VALUES(?,?,?)")
    .run(id, repositoryId, "policy");
}

describe("private operation alerts", () => {
  it("returns only unresolved alerts in bounded stable order without changing them", async () => {
    using database = new TestDatabase();
    addProject(database);
    const insert = database.connection.prepare(
      "INSERT INTO operations_events(id,kind,subject_id,code,first_seen_at,last_seen_at,resolved_at) VALUES(?,'backup',?,'backup-failed',1,?,?)",
    );
    for (let index = 0; index < 52; index++) {
      const id = `event-${String(index).padStart(2, "0")}`;
      insert.run(id, id, 100, null);
    }
    insert.run("resolved", "resolved", 200, 201);
    const before = database.connection.prepare("SELECT * FROM operations_events ORDER BY id").all();
    const result = await operationsStatus({
      database,
      projectId: "ariakit",
      repositoryId: "104133653",
    });
    expect(result.hasMore).toBe(true);
    expect(result.events).toHaveLength(50);
    expect(result.events[0]).toEqual({
      kind: "backup",
      code: "backup-failed",
      subject: "event-00",
      firstSeenAt: 1,
      lastSeenAt: 100,
    });
    expect(result.events.at(-1)?.subject).toBe("event-49");
    expect(result.checkedAt).toBeGreaterThan(0);
    expect(
      database.connection.prepare("SELECT * FROM operations_events ORDER BY id").all(),
    ).toEqual(before);
  });

  it("refuses alerts for a different repository or multiple projects", async () => {
    using database = new TestDatabase();
    addProject(database);
    await expect(
      operationsStatus({ database, projectId: "ariakit", repositoryId: "other" }),
    ).rejects.toMatchObject({ status: 503 });
    addProject(database, "other", "other");
    await expect(
      operationsStatus({ database, projectId: "ariakit", repositoryId: "104133653" }),
    ).rejects.toMatchObject({ status: 503 });
  });

  it("returns an explicit checked empty state after alerts resolve", async () => {
    using database = new TestDatabase();
    addProject(database);
    database.connection.exec(
      "INSERT INTO operations_events VALUES('resolved','backup','day','backup-failed',1,2,1,3)",
    );
    const result = await operationsStatus({
      database,
      projectId: "ariakit",
      repositoryId: "104133653",
    });
    expect(result.events).toEqual([]);
    expect(result.hasMore).toBe(false);
  });
});
