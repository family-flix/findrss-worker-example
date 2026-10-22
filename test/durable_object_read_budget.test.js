import assert from "node:assert/strict";
import test from "node:test";
import { RepositoryDiscoverySource } from "../server/repository/discovery_source.js";
import { RepositoryRssRouteCache } from "../server/repository/rss_route_cache.js";
import { RepositoryCall } from "../server/repository/call.js";
import { ServiceMaintenance } from "../server/service/durable_object/maintenance.js";
import { RETENTION_MILLISECONDS } from "../server/lib/constants.js";
import { API_SCHEMA_SQL } from "../server/repository/schema.js";
import { snapshot_store } from "./support/snapshot_store.js";

function source(id, fields = {}) {
  return { id, title: id, description: "", website: "", feed_url: "https://example.com/" + id,
    category: "", tags_json: "[]", enabled: 1, require_token: 0, sort_order: 0,
    source_type: "website", created_at: 1, updated_at: 1, ...fields };
}

test("一千个源逐个更新调度和读取路由目录，共用一次数据库扫描", t => {
  const store = snapshot_store();
  t.after(() => store.db.close());
  let now = 1_000_000, reads = 0;
  t.mock.method(Date, "now", () => now);
  const repo = new RepositoryDiscoverySource({ sql: { exec(query, ...args) {
    if (/SELECT d\.\*, s\.attempted_at/.test(query)) reads++;
    return store.sql.exec(query, ...args);
  } } });
  for (let index = 0; index < 1000; index++) repo.insert(source(String(index)));
  assert.equal(repo.snapshot_schedule().length, 1000);
  for (let index = 0; index < 1000; index++) {
    const id = String(index);
    repo.snapshot_attempt(id, "https://example.com/" + id, now);
    repo.snapshot_adaptive(id, 600);
    const row = repo.snapshot_schedule().find(row => row.id === id);
    assert.equal(row.snapshot_attempted_at, now);
    assert.equal(row.adaptive_interval, 600);
    assert.equal(repo.list_public_routes().length, 500);
    assert.equal(repo.list_private_routes().length, 0);
    assert.equal(repo.list_social_routes().length, 0);
  }
  assert.equal(reads, 1);
  repo.snapshot_schedule()[0].enabled = 0;
  assert.equal(repo.snapshot_schedule()[0].enabled, 1);
  now += 300000;
  repo.snapshot_schedule();
  assert.equal(reads, 2);
  const restarted = new RepositoryDiscoverySource(store);
  assert.equal(restarted.snapshot_schedule().find(row => row.id === "999").snapshot_attempted_at, 1_000_000);
});

test("源增删、公开转私密、停用、地址和社媒变更立即更新缓存，外部维护五分钟内同步", t => {
  const store = snapshot_store();
  t.after(() => store.db.close());
  let now = 1_000_000;
  t.mock.method(Date, "now", () => now);
  const repo = new RepositoryDiscoverySource(store);
  repo.insert(source("a"));
  repo.snapshot_attempt("a", "https://example.com/a", now);
  assert.equal(repo.list_public_routes().length, 1);
  repo.insert(source("b"));
  assert.equal(repo.snapshot_schedule().length, 2);
  repo.update(source("a", { require_token: 1, social_url: "https://social.example/a", credit_cost: 5 }));
  assert.deepEqual(repo.list_public_routes().map(row => row.id), ["b"]);
  assert.equal(repo.list_private_routes()[0].credit_cost, 5);
  assert.equal(repo.list_social_routes()[0].social_url, "https://social.example/a");
  repo.update(source("b", { enabled: 0 }));
  assert.equal(repo.list_public_routes().length, 0);
  repo.update(source("a", { feed_url: "https://example.com/new" }));
  assert.equal(repo.snapshot_schedule()[0].snapshot_attempted_at, null);
  // 旧抓取与编辑交错时，不可将旧地址的 attempted_at 填到新地址。
  repo.snapshot_attempt("a", "https://example.com/a", now + 1);
  assert.equal(repo.snapshot_schedule()[0].snapshot_attempted_at, null);
  repo.snapshot_attempt("a", "https://example.com/new", now + 2);
  assert.equal(repo.snapshot_schedule()[0].snapshot_attempted_at, now + 2);
  repo.snapshot_delete("a");
  assert.equal(repo.snapshot_schedule()[0].snapshot_attempted_at, null);
  store.sql.exec("UPDATE discovery_sources SET enabled = 1 WHERE id = 'b'");
  now += 300000;
  assert.equal(repo.snapshot_schedule().length, 2);
  repo.delete("a");
  assert.deepEqual(repo.snapshot_schedule().map(row => row.id), ["b"]);
});

test("列表总数和来源类型复用缓存，筛选隔离、写入与外部维护均能刷新", t => {
  const store = snapshot_store();
  t.after(() => store.db.close());
  let now = 1000000, reads = 0;
  t.mock.method(Date, "now", () => now);
  const repo = new RepositoryDiscoverySource({ sql: { exec(query, ...args) {
    if (/SELECT (COUNT\(\*\)|DISTINCT source_type)/.test(query)) reads++;
    return store.sql.exec(query, ...args);
  } } });
  repo.insert(source("a"));
  const all = { include_disabled: true }, visible = { include_disabled: false };
  const check = (total, public_count, types) => {
    assert.equal(repo.count_filtered(all), total);
    assert.equal(repo.count_filtered(visible), public_count);
    assert.deepEqual(repo.list_types().map(row => row.source_type), types);
  };
  check(1, 1, ["website"]);
  check(1, 1, ["website"]);
  assert.equal(reads, 3);
  repo.list_types()[0].source_type = "mutated";
  repo.insert(source("b", { require_token: 1, source_type: "weibo" }));
  check(2, 1, ["website", "weibo"]);
  repo.update(source("b", { enabled: 0, source_type: "website" }));
  check(2, 1, ["website"]);
  repo.delete("b");
  check(1, 1, ["website"]);
  store.sql.exec("UPDATE discovery_sources SET enabled = 0 WHERE id = 'a'");
  check(1, 1, ["website"]);
  now += 300000;
  check(1, 0, ["website"]);
  now = 0;
  check(1, 0, ["website"]);
  assert.equal(reads, 18);
});

test("最近调用及分页订阅源使用匹配排序的索引", t => {
  const store = snapshot_store();
  t.after(() => store.db.close());
  const plans = [];
  const sql = { exec(query, ...args) {
    plans.push(store.db.prepare("EXPLAIN QUERY PLAN " + query).all(...args).map(row => row.detail).join("\n"));
    return store.sql.exec(query, ...args);
  } };
  const calls = new RepositoryCall({ sql });
  calls.list("", "", 50);
  assert.match(plans.at(-1), /calls_recent/);
  calls.list("publisher", "", 50);
  assert.match(plans.at(-1), /calls_publisher_recent/);
  calls.list("publisher", "completed", 50);
  assert.match(plans.at(-1), /calls_publisher_recent/);
  const sources = new RepositoryDiscoverySource({ sql });
  sources.list({ include_disabled: true, limit: 20 });
  assert.match(plans.at(-1), /discovery_sources_recent/);
  sources.list({ include_disabled: false, limit: 20 });
  assert.match(plans.at(-1), /discovery_sources_public_order/);
});

test("未登记源的 RSS 调度复用扫描，尝试时间、排序、删除、新登记与重启保持一致", t => {
  const store = snapshot_store();
  t.after(() => store.db.close());
  let reads = 0;
  const repo = new RepositoryRssRouteCache({ sql: { exec(query, ...args) {
    if (query.startsWith("SELECT * FROM rss_public_feeds ORDER BY")) reads++;
    return store.sql.exec(query, ...args);
  } } });
  for (const key of ["a", "b"]) repo.register_public(key, "/" + key, [], "https://example.com/rss/" + key, 100);
  repo.public_schedule();
  for (let index = 1; index <= 1000; index++) {
    repo.public_attempt("a", index);
    assert.equal(repo.public_schedule()[0].key, "b");
  }
  assert.equal(reads, 1);
  repo.public_schedule()[0].attempted_at = 2000;
  assert.equal(repo.public_schedule()[0].attempted_at, 0);
  repo.delete_public("b");
  assert.deepEqual(repo.public_schedule().map(row => row.key), ["a"]);
  repo.register_public("c", "/c", [], "https://example.com/rss/c", 100);
  assert.deepEqual(repo.public_schedule().map(row => row.key), ["c", "a"]);
  assert.equal(new RepositoryRssRouteCache(store).public_schedule()[1].attempted_at, 1000);
});

test("历史任务每小时清理且失败可重试，缓存过期检查继续执行，不清理托管日志", () => {
  const calls = [], cache = [];
  let fail = false;
  const repo = {
    calls: { delete_completed_before: cutoff => { if (fail) throw new Error("cleanup failed"); calls.push(cutoff); } },
    devices: { delete_logs_before() { assert.fail("不能清理旧日志表"); } },
    script_logs: { delete_before() { assert.fail("不能清理旧日志表"); } },
    rss_route_cache: { delete_expired: now => cache.push(now) },
  };
  const service = new ServiceMaintenance({ repo });
  for (const now of [0, 5000, 3599999, 3600000]) service.prune_retention(now);
  assert.deepEqual(calls, [-RETENTION_MILLISECONDS, 3600000 - RETENTION_MILLISECONDS]);
  assert.equal(cache.length, 4);
  fail = true;
  assert.throws(() => service.prune_retention(7200000), /cleanup failed/);
  fail = false;
  service.prune_retention(7200001);
  assert.equal(calls.at(-1), 7200001 - RETENTION_MILLISECONDS);
});

test("历史调用清理和普通缓存的过期、计数、淘汰使用对应索引", t => {
  const store = snapshot_store();
  t.after(() => store.db.close());
  store.db.exec(API_SCHEMA_SQL); // 已有数据库重复部署也能补索引。
  const plans = [];
  const sql = { exec(query, ...args) {
    plans.push(store.db.prepare("EXPLAIN QUERY PLAN " + query).all(...args).map(row => row.detail).join("\n"));
    return store.sql.exec(query, ...args);
  } };
  new RepositoryCall({ sql }).delete_completed_before(1000);
  assert.match(plans.at(-1), /calls_retention.*status=\?.*completed_at<\?/);
  const cache = new RepositoryRssRouteCache({ sql });
  cache.delete_expired(1000);
  assert.match(plans.at(-1), /rss_route_cache_temporary_expiry.*expires_at<\?/);
  cache.count();
  assert.match(plans.at(-1), /COVERING INDEX rss_route_cache_temporary_expiry/);
  cache.delete_oldest(10);
  assert.match(plans.at(-1), /rss_route_cache_temporary_created/);
  assert.doesNotMatch(plans.at(-1), /TEMP B-TREE/);
});

test("任务计数随插入、批量状态变化、删除和事务回滚保持准确，重启无需扫描历史", t => {
  const store = snapshot_store();
  t.after(() => store.db.close());
  const counts = () => new RepositoryCall(store).count_by_status();
  const expected = () => store.sql.exec("SELECT status,COUNT(*) AS count FROM calls GROUP BY status ORDER BY status").toArray();
  const check = () => assert.deepEqual(counts(), expected());
  for (let index = 0; index < 20; index++) store.sql.exec(
    "INSERT INTO calls(id,method,publisher_device_id,args_json,status,created_at,updated_at) VALUES (?,'test','device','{}','queued',1,1)", String(index));
  assert.equal(new RepositoryCall(store).count_queued(), 20);
  check();
  store.sql.exec("UPDATE calls SET status = 'running' WHERE CAST(id AS INTEGER) % 2 = 0"); check();
  store.sql.exec("UPDATE calls SET status = 'completed' WHERE status = 'running'"); check();
  store.sql.exec("UPDATE calls SET status = 'queued' WHERE status = 'queued'"); check();
  store.sql.exec("DELETE FROM calls WHERE status = 'completed'"); check();
  assert.throws(() => store.storage.transactionSync(() => {
    store.sql.exec("UPDATE calls SET status = 'failed'");
    store.sql.exec("DELETE FROM calls");
    throw new Error("rollback");
  }), /rollback/);
  check();
  assert.equal(new RepositoryCall(store).count_queued(), 10);
  store.sql.exec("DELETE FROM calls"); check();
  assert.equal(new RepositoryCall(store).count_queued(), 0);
});

test("缓存删除直接按键回收旧分块，不重复扫描仍被引用的所有分块", t => {
  const store = snapshot_store();
  t.after(() => store.db.close());
  for (const [key, expires] of [["temporary", 10], ["public-snapshot:permanent", 999999999]]) {
    store.sql.exec("INSERT INTO rss_route_cache(key,output_json,invoked,expires_at,created_at) VALUES (?,'{}',0,?,1)", key, expires);
    store.sql.exec("INSERT INTO rss_route_cache_chunks(key,chunk_index,body) VALUES (?,0,'body')", key);
  }
  new RepositoryRssRouteCache(store).delete_expired(100);
  assert.deepEqual(store.sql.exec("SELECT key FROM rss_route_cache_chunks").toArray().map(row => row.key), ["public-snapshot:permanent"]);
  store.sql.exec("DELETE FROM rss_route_cache");
  assert.deepEqual(store.sql.exec("SELECT key FROM rss_route_cache_chunks").toArray(), []);
});
