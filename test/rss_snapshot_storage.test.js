import assert from "node:assert/strict";
import test from "node:test";
import { RssRouteCache } from "../server/infra/rss_cache.js";
import { snapshot_store } from "./support/snapshot_store.js";

function fixture(t) {
  const store = snapshot_store();
  t.after(() => store.db.close());
  return { ...store, cache: (options = {}) => new RssRouteCache(1000, 100, {
    store: store.repo, object_store: store.object_store, ...options,
  }) };
}

const snapshot = body => ({ output: JSON.stringify({ title: body }), invoked: false,
  rendered: new Map([["rss\n", body], ["atom\n", body]]) });

test("公开和私密大快照存 R2，SQLite 只存指针；重启、清理后两种 XML 仍可读", async t => {
  const f = fixture(t);
  const writer = f.cache({ max_bytes: 1 });
  const xml = "🐈订阅内容".repeat(40000);
  const value = snapshot(xml);
  for (const key of ["public-snapshot:/large", "private-snapshot:/large"]) {
    await writer.run(key, 1000, async () => value);
    const stored = f.repo.read(key);
    assert.match(stored.object_key, /^rss\/snapshots\/[\w-]+\.json$/);
    assert.equal(stored.output_json, "");
    assert.equal(stored.rendered, undefined);
    assert.equal(stored.bytes, value.output.length + xml.length * 2);
    const row = f.db.prepare("SELECT output_json FROM rss_route_cache WHERE key = ?").get(key);
    assert.doesNotMatch(row.output_json, /订阅内容/);
    assert.ok(row.output_json.length < 300);
  }
  assert.equal(f.bucket.objects.size, 2);
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM rss_route_cache_chunks").get().n, 0);
  assert.equal(writer.stats().entries, 0);
  f.repo.delete_expired(Date.now() + 86400000);
  f.repo.delete_oldest(0);
  writer.invalidate_all();
  const reader = f.cache();
  for (const key of ["public-snapshot:/large", "private-snapshot:/large"]) {
    const gets = f.bucket.calls.get;
    assert.equal(reader.inspect(key).bytes, value.output.length + xml.length * 2);
    assert.equal(reader.inspect(key).persistent, true);
    assert.equal(f.bucket.calls.get, gets);
    const reads = await Promise.all(Array.from({ length: 10 }, () => reader.resolve(key, Date.now())));
    assert.equal(f.bucket.calls.get, gets + 1);
    assert.ok(reads.every(result => result.rendered.get("rss\n") === xml && result.rendered.get("atom\n") === xml));
    assert.equal((await reader.run(key, Date.now(), () => assert.fail("不应执行脚本"))).cached, true);
    assert.equal(f.bucket.calls.get, gets + 1);
  }
});

test("普通脚本和预览仍按 TTL 存 SQLite，旧版分块 XML 在成功刷新后迁入 R2", async t => {
  const f = fixture(t);
  const key = "private-snapshot:/legacy";
  const xml = "旧内容🐈".repeat(20000);
  const value = snapshot(xml);
  f.repo.write({ key, output_json: value.output, rendered: [...value.rendered], invoked: 0,
    created_at: 1000, saved_at: 1000, expires_at: 2000 });
  assert.ok(f.db.prepare("SELECT COUNT(*) AS n FROM rss_route_cache_chunks").get().n > 1);
  const cache = f.cache();
  assert.equal((await cache.resolve(key, Date.now())).rendered.get("rss\n"), xml);
  assert.equal(f.bucket.calls.put, 0);
  f.bucket.fail_next({ op: "put" });
  await assert.rejects(cache.run(key, Date.now(), async () => snapshot("新内容"), { force: true }), /put failed/);
  assert.equal((await f.cache().resolve(key, Date.now())).rendered.get("rss\n"), xml);
  await cache.run(key, Date.now(), async () => snapshot("新内容"), { force: true });
  assert.ok(f.repo.read(key).object_key);
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM rss_route_cache_chunks").get().n, 0);
  assert.equal((await f.cache().resolve(key, Date.now())).rendered.get("rss\n"), "新内容");
  const puts = f.bucket.calls.put;
  for (const key of ["/ordinary", "discovery-preview:example"]) {
    await cache.run(key, Date.now(), async () => snapshot("临时内容"));
    assert.equal(f.repo.read(key).object_key, undefined);
    assert.equal((await f.cache().resolve(key, Date.now())).output, snapshot("临时内容").output);
    assert.equal(await f.cache().resolve(key, Date.now() + 2000), null);
  }
  assert.equal(f.bucket.calls.put, puts);
});

test("上传或 SQLite 提交失败保留旧指针和内存，提交失败删除新对象，成功替换清理旧对象", async t => {
  const f = fixture(t);
  const key = "public-snapshot:/failure";
  const cache = f.cache();
  await cache.run(key, 1000, async () => snapshot("旧内容"));
  const old_key = f.repo.read(key).object_key;
  f.bucket.fail_next({ op: "put" });
  await assert.rejects(cache.run(key, 2000, async () => snapshot("新内容"), { force: true }), /put failed/);
  assert.equal(f.repo.read(key).object_key, old_key);
  assert.equal((await cache.resolve(key, 2000)).rendered.get("rss\n"), "旧内容");
  const write = t.mock.method(f.repo, "write", () => { throw new Error("database failed"); });
  await assert.rejects(cache.run(key, 2000, async () => snapshot("新内容"), { force: true }), /database failed/);
  write.mock.restore();
  assert.deepEqual([...f.bucket.objects.keys()], [old_key]);
  assert.equal(f.repo.read(key).object_key, old_key);
  assert.equal((await f.cache().resolve(key, 2000)).rendered.get("rss\n"), "旧内容");
  await cache.run(key, 2000, async () => snapshot("新内容"), { force: true });
  assert.notEqual(f.repo.read(key).object_key, old_key);
  assert.equal(f.bucket.objects.has(old_key), false);
  assert.equal(f.bucket.objects.size, 1);
  assert.equal((await f.cache().resolve(key, 2000)).rendered.get("rss\n"), "新内容");
});

test("R2 暂时不可读或快照损坏时不重新执行脚本；对象缺失时允许重新生成", async t => {
  const f = fixture(t);
  const key = "private-snapshot:/unavailable";
  await f.cache().run(key, 1000, async () => snapshot("原内容"));
  const object_key = f.repo.read(key).object_key;
  await assert.rejects(f.cache({ object_store: null }).resolve(key, 2000), /storage is unavailable/);
  const cache = f.cache();
  f.bucket.fail_next({ op: "get" });
  await assert.rejects(cache.run(key, 2000, () => assert.fail("不应执行脚本")), /get failed/);
  assert.equal(cache.loading.size, 0);
  assert.equal((await cache.resolve(key, 2000)).rendered.get("rss\n"), "原内容");
  for (const body of ["broken JSON", "null", "false", "0", "[]", JSON.stringify({ output_json: "{}", rendered: [["rss\n", 123]] })]) {
    await f.object_store.put(object_key, body);
    await assert.rejects(f.cache().run(key, 2000, () => assert.fail("不应执行脚本")));
    assert.equal(f.repo.read(key).object_key, object_key);
  }
  await f.object_store.delete(object_key);
  assert.equal(await f.cache().resolve(key, 2000), null);
  await f.cache().run(key, 2000, async () => snapshot("重新生成"));
  assert.equal((await f.cache().resolve(key, 2000)).rendered.get("rss\n"), "重新生成");
});

test("读取旧 R2 对象期间刷新完成，即使新快照超出内存预算，也不会回填旧版本", async t => {
  const f = fixture(t);
  const key = "public-snapshot:/race";
  const cache = f.cache({ max_bytes: 1 });
  await cache.run(key, 1000, async () => snapshot("旧内容"));
  let release, started;
  const gate = new Promise(resolve => { release = resolve; });
  const reading = new Promise(resolve => { started = resolve; });
  const get = f.object_store.get.bind(f.object_store);
  t.mock.method(f.object_store, "get", async object_key => {
    const object = await get(object_key);
    started(); await gate;
    return object;
  });
  const old_read = cache.resolve(key, 2000);
  await reading;
  await cache.run(key, 2000, async () => snapshot("新内容"), { force: true });
  release();
  assert.equal((await old_read).rendered.get("rss\n"), "新内容");
  assert.equal((await cache.resolve(key, 2000)).rendered.get("atom\n"), "新内容");
  assert.equal(f.bucket.objects.size, 1);
});

test("清理旧对象失败不影响已发布的新快照", async t => {
  const f = fixture(t);
  const cache = f.cache();
  const key = "public-snapshot:/cleanup";
  await cache.run(key, 1000, async () => snapshot("旧内容"));
  const warn = t.mock.method(console, "warn", () => {});
  f.bucket.fail_next({ op: "delete" });
  await cache.run(key, 2000, async () => snapshot("新内容"), { force: true });
  assert.equal(warn.mock.callCount(), 1);
  assert.equal((await f.cache().resolve(key, 2000)).rendered.get("rss\n"), "新内容");
});
