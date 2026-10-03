import type { Miniflare } from "miniflare";
import { appendFileSync } from "node:fs";

type NativeDatabase = Awaited<ReturnType<Miniflare["getD1Database"]>>;
type NativeStatement = ReturnType<NativeDatabase["prepare"]>;

export interface D1Cost {
  sql: string;
  rows_read: number;
  rows_written: number;
}

/** Record native D1 metadata without counting fixture setup or SQL statements. */
export function measureD1(database: NativeDatabase) {
  const costs: D1Cost[] = [];
  const statements = new WeakMap<NativeStatement, { native: NativeStatement; sql: string }>();
  const record = (sql: string, meta: Pick<D1Cost, "rows_read" | "rows_written">) => {
    costs.push({ sql, rows_read: meta.rows_read, rows_written: meta.rows_written });
  };
  const wrap = (native: NativeStatement, sql: string): NativeStatement => {
    const wrapped = new Proxy(native, {
      get(target, key) {
        if (key === "bind") {
          return (...values: Parameters<NativeStatement["bind"]>) =>
            wrap(target.bind(...values), sql);
        }
        if (key === "first") {
          // D1's first() omits meta. Execute the same SQL via all() to retain it.
          return async (column?: string) => {
            const result = await target.all();
            record(sql, result.meta);
            const row = result.results[0] ?? null;
            return column === undefined ? row : (row?.[column] ?? null);
          };
        }
        if (key === "all" || key === "run") {
          return async () => {
            const result = await target[key]();
            record(sql, result.meta);
            return result;
          };
        }
        return Reflect.get(target, key);
      },
    });
    statements.set(wrapped, { native, sql });
    return wrapped;
  };
  return {
    database: new Proxy(database, {
      get(target, key) {
        if (key === "prepare") {
          return (sql: string) => wrap(target.prepare(sql), sql);
        }
        if (key === "batch") {
          return async (batch: NativeStatement[]) => {
            const entries = batch.map((entry) => {
              const measured = statements.get(entry);
              if (!measured) throw new Error("Expected a measured D1 statement.");
              return measured;
            });
            const results = await target.batch(entries.map((entry) => entry.native));
            for (let index = 0; index < results.length; index++) {
              const result = results[index];
              const entry = entries[index];
              if (!result || !entry) throw new Error("Missing native D1 batch result.");
              record(entry.sql, result.meta);
            }
            return results;
          };
        }
        return Reflect.get(target, key);
      },
    }),
    costs,
    reset() {
      costs.length = 0;
    },
    report(label: string) {
      const path = process.env.VISONAUT_D1_COST_REPORT;
      if (path) appendFileSync(path, `${JSON.stringify({ label, costs })}\n`);
    },
    totals() {
      return costs.reduce(
        (total, cost) => ({
          rows_read: total.rows_read + cost.rows_read,
          rows_written: total.rows_written + cost.rows_written,
        }),
        { rows_read: 0, rows_written: 0 },
      );
    },
  };
}
