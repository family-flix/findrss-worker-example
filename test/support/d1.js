import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
export function d1_fixture() {
  const sql = new DatabaseSync(":memory:");
  const directory = new URL("../../migrations/", import.meta.url);
  for (const name of readdirSync(directory).filter(name => name.endsWith(".sql")).sort()) sql.exec(readFileSync(new URL(name, directory), "utf8"));
  const prepare = query => ({
    query,
    values: [],
    bind(...values) {
      return {
        ...this,
        values,
        all: this.all,
        run: this.run
      };
    },
    async all() {
      const statement = sql.prepare(this.query);
      const values = this.values.map(value => value instanceof ArrayBuffer ? new Uint8Array(value) : value);
      if (statement.columns().length) return {
        results: statement.all(...values),
        meta: {
          changes: 0
        }
      };
      const result = statement.run(...values);
      return {
        results: [],
        meta: {
          changes: result.changes
        }
      };
    },
    run() {
      return this.all();
    }
  });
  let tail = Promise.resolve();
  const batch = async statements => {
    sql.exec("BEGIN IMMEDIATE");
    try {
      const result = [];
      for (const statement of statements) result.push(await statement.all());
      sql.exec("COMMIT");
      return result;
    } catch (error) {
      sql.exec("ROLLBACK");
      throw error;
    }
  };
  return {
    sql,
    prepare,
    batch(statements) {
      const result = tail.then(() => batch(statements));
      tail = result.catch(() => {});
      return result;
    }
  };
}
