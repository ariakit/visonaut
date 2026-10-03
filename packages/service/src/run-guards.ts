import { assertion } from "./database.ts";
import type { Database } from "./database.ts";
import type { ProjectRow, RunRow } from "./types.ts";

export function projectGuard(database: Database, project: ProjectRow) {
  return assertion(
    database,
    "EXISTS (SELECT 1 FROM visonaut_projects WHERE id = ? AND revision = ?)",
    [project.id, project.revision],
  );
}

export function activeGuard(database: Database, run: RunRow) {
  return assertion(
    database,
    "EXISTS (SELECT 1 FROM visonaut_runs WHERE id = ? AND active = 1 AND revision = ?)",
    [run.id, run.revision],
  );
}
