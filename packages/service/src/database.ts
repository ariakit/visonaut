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

/**
 * A write that lost the race with another write: the state changed after its
 * read, a guard of its batch failed, and D1 stored nothing of it.
 */
export class ConcurrentWriteError extends ConflictError {}

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
  // CASE also rejects NULL without writing a row for a passing predicate.
  return statement(
    database,
    `INSERT INTO visonaut_assertions (valid) SELECT 0 WHERE CASE WHEN (${predicate}) THEN 0 ELSE 1 END`,
    values,
  );
}

export async function atomic(database: Database, statements: Statement[]) {
  try {
    return await database.batch([
      ...statements,
      // Retention still inserts passing assertions directly.
      statement(database, "DELETE FROM visonaut_assertions"),
    ]);
  } catch (error) {
    if (
      error instanceof Error &&
      /CHECK constraint failed.*valid|visonaut_assertions/.test(error.message)
    ) {
      throw new ConflictError("State changed. Refresh the comparison before trying again.");
    }
    throw error;
  }
}
