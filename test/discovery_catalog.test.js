import assert from "node:assert/strict";
import test from "node:test";
import { webcrypto } from "node:crypto";
import { create_memory_bucket } from "@findrss/object-store";
import { ServiceDiscovery } from "../server/service/durable_object/discovery.js";
import { create_api_object_store } from "../server/infra/object_store.js";
import { DISCOVERY_CATALOG_KEY } from "../server/lib/discovery_catalog.js";
import { stored_html } from "../server/infra/discovery_compression.js";

globalThis.crypto ||= webcrypto;
const png = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0X8AAAAASUVORK5CYII=", "base64"));
const request = body => new Request("https://internal/source", { method: "POST", body: JSON.stringify(body) });

function fixture() {
  const bucket = create_memory_bucket(), metadata = new Map();
  const sources = new Map(), snapshots = new Map(), avatars = new Map();
  const repo = { discovery: {
    list(filters) { assert.equal(filters.include_disabled, false); assert.equal(filters.limit, 1000);
      return [...sources.values()].filter(row => row.enabled).map(row => ({ ...row, ...snapshots.get(row.id) })); },
    find: id => sources.get(id), exists: id => sources.has(id), count: () => sources.size,
    feed_url_taken: url => [...sources.values()].some(row => row.feed_url === url),
    feed_url_taken_by_other: (url, id) => [...sources.values()].some(row => row.id !== id && row.feed_url === url),
    insert: row => sources.set(row.id, row), update: row => sources.set(row.id, { ...sources.get(row.id), ...row }),
    delete(id) { sources.delete(id); snapshots.delete(id); avatars.delete(id); },
    avatar_get: id => avatars.get(id), avatar_put(id, content_type, bytes, now, object_key) { avatars.set(id, { content_type, bytes, object_key }); },
    avatar_delete: id => avatars.delete(id), set_avatar_ts(id, time) { sources.get(id).avatar_updated_at = time; },
    snapshot_next_at: () => null, snapshot_get: id => snapshots.get(id), snapshot_delete: id => snapshots.delete(id), snapshot_attempt() {},
    snapshot_save(id, url, articles, now) { snapshots.set(id, { articles_json: JSON.stringify(articles), snapshot_saved_at: now, saved_at: now }); },
  } };
  const storage = { transactionSync: fn => fn(), get: async key => metadata.get(key),
    put: async (key, value) => metadata.set(key, value), delete: async key => metadata.delete(key) };
  let alarms = 0;
  const dependencies = { repo, storage, object_store: create_api_object_store({ API_STORAGE: bucket }),
    render_catalog: JSON.stringify, schedule_alarm: async () => { alarms++; }, load_snapshot: async () => [{ title: "新文章" }] };
  const service = new ServiceDiscovery(dependencies);
  return { service, dependencies, sources, snapshots, bucket, metadata, get alarms() { return alarms; },
    async published() { return JSON.parse(await stored_html(await dependencies.object_store.get(DISCOVERY_CATALOG_KEY))); } };
}

const row = index => ({ id: String(index), title: "源" + index, feed_url: "https://example.com/feed/" + index,
  description: "", website: "", category: "technology", tags_json: '["文章"]', enabled: 1, require_token: 0, source_type: "website" });

test("首次发布读取完整 1000 条目录，排除下架源和需要凭证的文章，不混入管理字段", async () => {
  const f = fixture();
  for (let index = 0; index < 1000; index++) f.sources.set(String(index), row(index));
  f.sources.get("0").enabled = 0; f.sources.get("1").require_token = 1;
  f.snapshots.set("1", { articles_json: '[{"title":"私密文章"}]', snapshot_saved_at: 100 });
  await f.service.ensure_catalog();
  const published = await f.published();
  assert.equal(published.sources.length, 999);
  assert.equal(published.sources.at(-1).id, "999");
  assert.deepEqual(published.sources[0].snapshot, { saved_at: 0, articles: [] });
  assert.deepEqual(published.tags, ["文章", "科技"]);
  const object = await f.dependencies.object_store.get(DISCOVERY_CATALOG_KEY);
  assert.equal(object.httpMetadata.contentEncoding, "gzip");
  assert.ok(object.size < Buffer.byteLength(JSON.stringify(published)));
  assert.equal("cache" in published.sources[0], false);
  const writes = f.bucket.calls.put;
  await f.service.ensure_catalog(); assert.equal(f.bucket.calls.put, writes);
});

test("增删改、快照和头像变化均发布，收紧权限清掉旧文章", async () => {
  const f = fixture();
  const created = await f.service.create_discovery_source(request({ title: "源", feed_url: "https://example.com/feed", tags: ["文章"] }));
  const id = created.data.source.id;
  assert.equal((await f.published()).sources[0].id, id);
  await f.service.refresh_discovery_snapshot(id);
  assert.equal((await f.published()).sources[0].snapshot.articles[0].title, "新文章");
  await f.service.put_discovery_avatar(new Request("https://internal/avatar", { method: "PUT", body: png }), id);
  assert.match((await f.published()).sources[0].avatar_url, /\?v=\d+/);
  await f.service.delete_discovery_avatar(id);
  assert.equal((await f.published()).sources[0].avatar_url, "");
  await f.service.update_discovery_source(request({ title: "改名", require_token: true }), id);
  const private_source = (await f.published()).sources[0];
  assert.equal(private_source.title, "改名"); assert.deepEqual(private_source.snapshot.articles, []);
  await f.service.update_discovery_source(request({ enabled: false }), id);
  assert.equal((await f.published()).sources.length, 0);
  await f.service.delete_discovery_source(id);
  assert.equal(f.sources.size, 0);
  assert.equal((await f.published()).sources.length, 0);
});

test("串行发布避免慢写覆盖后续编辑，失败清理旧产物且重启后可重试", async () => {
  const f = fixture(); f.sources.set("a", { ...row("a") });
  const put = f.dependencies.object_store.put.bind(f.dependencies.object_store);
  let finish, started;
  const first_entered = new Promise(resolve => { started = resolve; });
  f.dependencies.object_store.put = async (...args) => {
    await new Promise(resolve => { finish = resolve; started(); });
    return put(...args);
  };
  const first = f.service.publish_catalog();
  await first_entered;
  f.sources.get("a").title = "更新";
  const second = f.service.publish_catalog();
  const second_entered = new Promise(resolve => { started = resolve; });
  finish(); await first;
  await second_entered; finish(); await second;
  assert.equal((await f.published()).sources[0].title, "更新");
  f.dependencies.object_store.put = put;
  f.bucket.fail_next({ op: "put" });
  await assert.rejects(f.service.publish_catalog(), { status: 503 });
  assert.equal(await f.dependencies.object_store.get(DISCOVERY_CATALOG_KEY), null);
  assert.equal(f.metadata.get("discovery_catalog_dirty"), true);
  assert.ok(f.service.next_snapshot_at() >= Date.now());
  assert.ok(f.alarms > 0);
  const restarted = new ServiceDiscovery(f.dependencies);
  await restarted.ensure_catalog();
  assert.equal((await f.published()).sources[0].title, "更新");
  assert.equal(f.metadata.has("discovery_catalog_dirty"), false);
});

test("没有 R2 时保持可读目录，写入不依赖静态发布", async () => {
  const f = fixture(); f.service.object_store = null;
  await f.service.ensure_catalog();
  await f.service.create_discovery_source(request({ title: "源", feed_url: "https://example.com/feed" }));
  assert.equal(f.service.public_catalog().sources.length, 1);
  assert.equal(f.bucket.calls.put, 0);
});

test("首次 R2 检查失败安排重试，空目录也能补建", async () => {
  const f = fixture();
  f.bucket.fail_next({ op: "head" });
  await assert.rejects(f.service.ensure_catalog(), /head failed/);
  assert.ok(f.alarms > 0);
  assert.ok(f.service.next_snapshot_at() >= Date.now());
  await f.service.ensure_catalog();
  assert.deepEqual((await f.published()).sources, []);
});
