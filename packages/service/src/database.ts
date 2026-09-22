export type SqlValue = string | number | null | ArrayBuffer;

export interface Result<T = Record<string, unknown>> {
  results?: T[];
  meta?: { changes?: number; size_after?: number };
}

export interface Statement {
  bind(...values: SqlValue[]): Statement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<Result<T>>;
  run(): Promise<Result>;
}

export interface Database {
  prepare(sql: string): Statement;
  batch(statements: Statement[]): Promise<Result[]>;
}

export class ConflictError extends Error {
  readonly code = "CONFLICT";
  constructor(
    message: string,
    readonly current?: unknown,
  ) {
    super(message);
    this.name = "ConflictError";
  }
}

export class IncompleteError extends Error {
  readonly code = "INCOMPLETE";
  constructor(message: string) {
    super(message);
    this.name = "IncompleteError";
  }
}

export function statement(database: Database, sql: string, values: SqlValue[] = []) {
  return database.prepare(sql).bind(...values);
}

// D1 rolls a batch back on CHECK failure, but not on a zero-row UPDATE.
export function assertion(database: Database, predicate: string, values: SqlValue[] = []) {
  return statement(
    database,
    `INSERT INTO ariviso_assertions (valid) VALUES (CASE WHEN (${predicate}) THEN 1 ELSE 0 END)`,
    values,
  );
}

export async function atomic(database: Database, statements: Statement[]) {
  try {
    return await database.batch([
      ...statements,
      statement(database, "DELETE FROM ariviso_assertions"),
    ]);
  } catch (error) {
    if (
      error instanceof Error &&
      /CHECK constraint failed.*valid|ariviso_assertions/.test(error.message)
    ) {
      throw new ConflictError("State changed. Refresh the comparison before trying again.");
    }
    throw error;
  }
}
