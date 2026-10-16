import { DatabaseSync } from "node:sqlite";
import { API_SCHEMA_SQL } from "../../server/repository/schema.js";
import { RepositoryRssRouteCache } from "../../server/repository/rss_route_cache.js";

export function snapshot_store() {
  const db = new DatabaseSync(":memory:");
  db.exec(API_SCHEMA_SQL);
  const sql = { exec(text, ...args) {
    const statement = db.prepare(text);
    const rows = /^\s*(SELECT|PRAGMA)/i.test(text) ? statement.all(...args) : (statement.run(...args), []);
    return { toArray: () => rows };
  } };
  const storage = { transactionSync(task) {
    db.exec("BEGIN");
    try { const result = task(); db.exec("COMMIT"); return result; }
    catch (error) { db.exec("ROLLBACK"); throw error; }
  } };
  return { db, sql, storage, repo: new RepositoryRssRouteCache({ sql, storage }) };
}
