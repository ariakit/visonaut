import { readFileSync, readdirSync } from "node:fs";

const directory = new URL("../apps/web/migrations/", import.meta.url);

interface TestMigrationOptions {
  through?: string;
}

interface TestMigration {
  name: string;
  sql: string;
}

interface TestMigrationStatement {
  run(): Promise<unknown>;
}

interface TestMigrationDatabase<Statement extends TestMigrationStatement> {
  prepare(sql: string): Statement;
  batch(statements: Statement[]): Promise<unknown>;
}

export function readTestMigrations({ through }: TestMigrationOptions = {}): TestMigration[] {
  const names = readdirSync(directory)
    .filter((name) => /^\d{4}_.+\.sql$/u.test(name))
    .sort();
  const end = through?.replace(/\.sql$/u, "");
  if (end && !names.some((name) => name === `${end}.sql`)) {
    throw new Error(`Unknown test migration: ${through}`);
  }
  return names
    .filter((name) => !end || name <= `${end}.sql`)
    .map((name) => ({ name, sql: readFileSync(new URL(name, directory), "utf8") }));
}

export async function applyTestMigrations<Statement extends TestMigrationStatement>(
  database: TestMigrationDatabase<Statement>,
  options: TestMigrationOptions = {},
) {
  for (const migration of readTestMigrations(options)) {
    const statements: Statement[] = [];
    const applyStatements = async () => {
      if (!statements.length) return;
      await database.batch(statements);
      statements.length = 0;
    };
    let query = "";
    // Committed migrations end each complete statement on a line. Preserve
    // trigger bodies so their inner semicolons do not split the statement.
    for (const line of migration.sql.replace(/^--.*$/gm, "").split("\n")) {
      query += `${line}\n`;
      if (!line.trimEnd().endsWith(";")) continue;
      const statement = database.prepare(query);
      // PRAGMAs can be ineffective inside a batch transaction.
      if (/^\s*PRAGMA\b/iu.test(query)) {
        await applyStatements();
        await statement.run();
      } else {
        statements.push(statement);
      }
      query = "";
    }
    if (query.trim()) {
      throw new Error(`Unterminated statement in ${migration.name}`);
    }
    await applyStatements();
  }
}
