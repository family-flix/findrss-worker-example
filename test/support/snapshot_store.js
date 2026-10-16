import { DatabaseSync } from "node:sqlite";
import { API_SCHEMA_SQL } from "../../server/repository/schema.js";
import { RepositoryRssRouteCache } from "../../server/repository/rss_route_cache.js";
import { create_memory_bucket } from "@findrss/object-store";
import { create_api_object_store } from "../../server/infra/object_store.js";

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
  const bucket = create_memory_bucket();
  const object_store = create_api_object_store({ API_STORAGE: bucket });
  return { db, sql, storage, bucket, object_store, repo: new RepositoryRssRouteCache({ sql, storage }) };
}
