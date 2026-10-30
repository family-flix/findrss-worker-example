// 建表 DDL 的静态护栏（没有 sqlite harness：durable_object.js 依赖 `cloudflare:workers`）。
//
// 抓两类回归：
//  1. 表集合漂移——加/删表却没同步 API_TABLE_NAMES。
//  2. **索引跑在它依赖的列之前**。`CREATE TABLE IF NOT EXISTS` 对已存在的表是 no-op、不会补列，
//     所以带 PRAGMA 守卫的 ALTER 与依赖它们的索引必须留在 constructor 里按原顺序执行。
//     把索引搬进 API_SCHEMA_SQL 在老库上会 `no such column`——新库永远复现不出来。
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { API_SCHEMA_SQL, API_TABLE_NAMES } from "../server/repository/schema.js";
const api_dir = join(dirname(fileURLToPath(import.meta.url)), "..");

/** @returns {string[]} DDL 里实际声明的表名。 */
function declared_tables() {
  return [...API_SCHEMA_SQL.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map(match => match[1]);
}

/**
 * 每张表的列定义文本。
 * @returns {Map<string, string>}
 */
function table_bodies() {
  const bodies = new Map();
  for (const match of API_SCHEMA_SQL.matchAll(/CREATE TABLE IF NOT EXISTS (\w+) \(([\s\S]*?)\n  \);/g)) {
    bodies.set(match[1], match[2]);
  }
  return bodies;
}

/** @returns {{ name: string, table: string, columns: string[], where: string }[]} */
function declared_indexes() {
  const indexes = [];
  const pattern = /CREATE (?:UNIQUE )?INDEX IF NOT EXISTS (\w+)\s+ON (\w+)\(([^)]*)\)([^;]*);/g;
  for (const match of API_SCHEMA_SQL.matchAll(pattern)) {
    indexes.push({
      name: match[1],
      table: match[2],
      columns: match[3].split(",").map(column => column.trim().split(/\s+/)[0]).filter(Boolean),
      where: match[4]
    });
  }
  return indexes;
}
test("表集合与本模块声明一致，且恰好 47 张", () => {
  assert.deepEqual(declared_tables(), [...API_TABLE_NAMES]);
  assert.equal(API_TABLE_NAMES.length, 47);
  assert.ok(Object.isFrozen(API_TABLE_NAMES));
});
test("DDL 里的每个索引只引用同一份 DDL 里定义过的列", async () => {
  const bodies = table_bodies();
  const indexes = declared_indexes();
  assert.ok(indexes.length >= 15, `索引数量异常：${indexes.length}`);
  for (const index of indexes) {
    const body = await bodies.get(index.table);
    assert.ok(body, `${index.name} 指向未声明的表 ${index.table}`);
    for (const column of index.columns) {
      assert.match(body, new RegExp(`(^|\\s)${column}\\s`), `${index.name} 引用了 ${index.table} 里不存在的列 ${column}`);
    }
    for (const column of index.where.matchAll(/(?<![.\w'"])([a-z_][a-z0-9_]*)\s+(?:IS|NOT|=|<>|<|>)/gi)) {
      assert.match(body, new RegExp(`(^|\\s)${column[1]}\\s`), `${index.name} 的 WHERE 引用了 ${index.table} 里不存在的列 ${column[1]}`);
    }
  }
});
test("依赖 ALTER 补列或已停用的索引不得进 API_SCHEMA_SQL", () => {
  for (const name of ["calls_access_token", "calls_coalesce", "access_tokens_user", "scripts_path", "rss_route_cache_expiry"]) {
    assert.equal(declared_indexes().some(index => index.name === name), false, `${name} 依赖 ALTER 补的列 / 迁移循环，必须留在 constructor 里`);
  }
});
test("业务表通过部署 SQL 初始化，Worker 和 WebSocket DO 不执行启动 DDL", () => {
  const migration = readFileSync(join(api_dir, "migrations/0001_application.sql"), "utf8");
  for (const table of [...API_TABLE_NAMES, "application_settings", "jobs", "schedules", "transaction_guard"]) assert.match(migration, new RegExp("CREATE TABLE(?: IF NOT EXISTS)? " + table + "\\s*\\("));
  for (const file of ["server/application.js", "server/infra/realtime_do.js"]) assert.doesNotMatch(readFileSync(join(api_dir, file), "utf8"), /CREATE TABLE|ALTER TABLE|transactionSync|ctx\.storage/);
});
