import { async_map } from "../server/lib/async_array.js";
import assert from "node:assert/strict";
import test from "node:test";
import { webcrypto } from "node:crypto";
import { create_memory_bucket } from "@findrss/object-store";
import { ServiceDiscovery } from "../server/service/application/discovery.js";
import { create_api_object_store } from "../server/infra/object_store.js";
import { DISCOVERY_CATALOG_KEY } from "../server/lib/discovery_catalog.js";
import { stored_html } from "../server/infra/discovery_compression.js";
globalThis.crypto ||= webcrypto;
const png = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0X8AAAAASUVORK5CYII=", "base64"));
const request = body => new Request("https://internal/source", {
  method: "POST",
  body: JSON.stringify(body)
});
function fixture() {
  const bucket = create_memory_bucket(),
    metadata = new Map();
  const sources = new Map(),
    snapshots = new Map(),
    avatars = new Map();
  const repo = {
    tags: {
      list: () => ["脚本标签"]
    },
    discovery: {
      async list(filters) {
        assert.equal(filters.include_disabled, false);
        assert.equal(filters.limit, 1000);
        return await async_map([...sources.values()].filter(row => row.enabled), async row => ({
          ...row,
          ...snapshots.get(row.id),
          avatar_object_key: (await avatars.get(row.id))?.object_key
        }));
      },
      find: async id => sources.has(id) ? {
        ...(await sources.get(id)),
        avatar_object_key: (await avatars.get(id))?.object_key
      } : undefined,
      exists: id => sources.has(id),
      count: () => sources.size,
      feed_url_taken: url => [...sources.values()].some(row => row.feed_url === url),
      feed_url_taken_by_other: (url, id) => [...sources.values()].some(row => row.id !== id && row.feed_url === url),
      insert: row => sources.set(row.id, row),
      update: async row => sources.set(row.id, {
        ...(await sources.get(row.id)),
        ...row
      }),
      async delete(id) {
        await sources.delete(id);
        snapshots.delete(id);
        await avatars.delete(id);
      },
      avatar_get: async id => await avatars.get(id),
      avatar_put(id, content_type, bytes, now, object_key) {
        avatars.set(id, {
          content_type,
          bytes,
          object_key
        });
      },
      avatar_delete: async id => await avatars.delete(id),
      async set_avatar_ts(id, time) {
        (await sources.get(id)).avatar_updated_at = time;
      },
      snapshot_next_at: () => null,
      snapshot_get: id => snapshots.get(id),
      snapshot_delete: id => snapshots.delete(id),
      snapshot_attempt() {},
      snapshot_save(id, url, articles, now) {
        snapshots.set(id, {
          articles_json: JSON.stringify(articles),
          snapshot_saved_at: now,
          saved_at: now
        });
      }
    }
  };
  const storage = {
    transaction: fn => fn(),
    get: async key => metadata.get(key),
    put: async (key, value) => metadata.set(key, value),
    delete: async key => metadata.delete(key)
  };
  let alarms = 0;
  const dependencies = {
    repo,
    storage,
    object_store: create_api_object_store({
      API_STORAGE: bucket
    }),
    render_catalog: JSON.stringify,
    schedule_alarm: async () => {
      alarms++;
    },
    load_snapshot: async () => [{
      title: "新文章"
    }]
  };
  const service = new ServiceDiscovery(dependencies);
  return {
    service,
    dependencies,
    sources,
    snapshots,
    bucket,
    metadata,
    get alarms() {
      return alarms;
    },
    async published() {
      return JSON.parse(await stored_html(await dependencies.object_store.get(DISCOVERY_CATALOG_KEY)));
    }
  };
}
const row = index => ({
  id: String(index),
  title: "源" + index,
  feed_url: "https://example.com/feed/" + index,
  description: "",
  website: "",
  category: "technology",
  tags_json: '["文章"]',
  enabled: 1,
  require_token: 0,
  source_type: "website"
});
test("目录升级标记只补写缺失项，重复发布和重建不重写已完成的升级", async t => {
  const f = fixture();
  const put = t.mock.method(f.dependencies.storage, "put", async (key, value) => f.metadata.set(key, value));
  const migration_writes = () => put.mock.calls.filter(call => /^discovery_catalog_.*_v1$/.test(call.arguments[0])).length;
  await f.service.ensure_catalog();
  assert.equal(migration_writes(), 5);
  await f.service.publish_catalog();
  await new ServiceDiscovery(f.dependencies).publish_catalog();
  assert.equal(migration_writes(), 5);
  await f.metadata.delete("discovery_catalog_public_sources_v1");
  await new ServiceDiscovery(f.dependencies).ensure_catalog();
  assert.equal(migration_writes(), 6);
  assert.equal(await f.metadata.get("discovery_catalog_public_sources_v1"), true);
});
test("首次发布读取完整 1000 条目录，排除下架源和非公开源，不混入管理字段", async () => {
  const f = fixture();
  for (let index = 0; index < 1000; index++) f.sources.set(String(index), row(index));
  (await f.sources.get("0")).enabled = 0;
  (await f.sources.get("1")).require_token = 1;
  f.snapshots.set("1", {
    articles_json: '[{"title":"私密文章"}]',
    snapshot_saved_at: 100
  });
  await f.service.ensure_catalog();
  const published = await f.published();
  assert.equal(published.sources.length, 998);
  assert.equal(published.sources.at(-1).id, "999");
  assert.equal(published.sources.some(source => source.id === "1"), false);
  assert.doesNotMatch(JSON.stringify(published), /私密文章/);
  assert.deepEqual(published.sources[0].snapshot, {
    saved_at: 0,
    articles: []
  });
  assert.deepEqual(published.tags, ["脚本标签"]);
  assert.deepEqual(published.sources[0].tags, ["文章", "科技"]);
  const object = await f.dependencies.object_store.get(DISCOVERY_CATALOG_KEY);
  assert.equal(object.httpMetadata.contentEncoding, "gzip");
  assert.ok(object.size < Buffer.byteLength(JSON.stringify(published)));
  assert.equal("cache" in published.sources[0], false);
  const writes = f.bucket.calls.put;
  await f.service.ensure_catalog();
  assert.equal(f.bucket.calls.put, writes);
});
test("增删改、快照和头像变化均发布，切换公开性只改变目录展示并保留快照", async () => {
  const f = fixture();
  const created = await f.service.create_discovery_source(request({
    title: "源",
    feed_url: "https://example.com/feed",
    tags: ["文章"],
    require_token: false
  }));
  const id = created.data.source.id;
  assert.equal((await f.published()).sources[0].id, id);
  await f.service.refresh_discovery_snapshot(id);
  assert.equal((await f.published()).sources[0].snapshot.articles[0].title, "新文章");
  await f.service.put_discovery_avatar(new Request("https://internal/avatar", {
    method: "PUT",
    body: png
  }), id);
  assert.match((await f.published()).sources[0].avatar_url, /^\/public\/avatar\//);
  await f.service.delete_discovery_avatar(id);
  assert.equal((await f.published()).sources[0].avatar_url, "");
  await f.service.update_discovery_source(request({
    title: "改名",
    require_token: true
  }), id);
  // 改为非公开后整条源从公开目录移除，旧文章也随之消失。
  assert.equal((await f.published()).sources.length, 0);
  await f.service.update_discovery_source(request({
    require_token: false
  }), id);
  const republished = (await f.published()).sources[0];
  assert.equal(republished.title, "改名");
  assert.deepEqual(republished.snapshot.articles, [{
    title: "新文章"
  }]);
  await f.service.update_discovery_source(request({
    enabled: false
  }), id);
  assert.equal((await f.published()).sources.length, 0);
  await f.service.delete_discovery_source(id);
  assert.equal(f.sources.size, 0);
  assert.equal((await f.published()).sources.length, 0);
});
test("旧头像静态目录升级时重新发布一次并使用 R2 公开对象 URL", async () => {
  const f = fixture();
  f.sources.set("avatar", row("avatar"));
  await f.service.put_discovery_avatar(new Request("https://internal/avatar", {
    method: "PUT",
    body: png
  }), "avatar");
  await f.metadata.delete("discovery_catalog_public_avatars_v1");
  const writes = f.bucket.calls.put;
  const restarted = new ServiceDiscovery(f.dependencies);
  await restarted.ensure_catalog();
  assert.equal(f.bucket.calls.put, writes + 1);
  assert.match((await f.published()).sources[0].avatar_url, /^\/public\/avatar\/avatar\/[a-f0-9-]+$/);
  assert.equal(await f.metadata.get("discovery_catalog_public_avatars_v1"), true);
  await restarted.ensure_catalog();
  assert.equal(f.bucket.calls.put, writes + 1);
});
test("已有静态目录升级为脚本标签目录时重新发布一次，源的手填标签不进入目录", async () => {
  const f = fixture();
  f.sources.set("a", row("a"));
  await f.service.ensure_catalog();
  await f.metadata.delete("discovery_catalog_script_tags_v1");
  f.dependencies.repo.tags.list = () => ["新脚本标签"];
  const writes = f.bucket.calls.put;
  const restarted = new ServiceDiscovery(f.dependencies);
  await restarted.ensure_catalog();
  assert.equal(f.bucket.calls.put, writes + 1);
  assert.deepEqual((await f.published()).tags, ["新脚本标签"]);
  await restarted.ensure_catalog();
  assert.equal(f.bucket.calls.put, writes + 1);
});
test("旧静态目录升级时重新发布一次并移除其中的非公开源", async () => {
  const f = fixture();
  f.sources.set("public", row("public"));
  f.sources.set("private", {
    ...row("private"),
    require_token: 1
  });
  await f.service.ensure_catalog();
  await f.dependencies.object_store.put(DISCOVERY_CATALOG_KEY, JSON.stringify({
    sources: [...f.sources.values()]
  }));
  await f.metadata.delete("discovery_catalog_public_sources_v1");
  const writes = f.bucket.calls.put;
  const restarted = new ServiceDiscovery(f.dependencies);
  await restarted.ensure_catalog();
  assert.deepEqual((await f.published()).sources.map(source => source.id), ["public"]);
  assert.equal(await f.metadata.get("discovery_catalog_public_sources_v1"), true);
  assert.equal(f.bucket.calls.put, writes + 1);
  await restarted.ensure_catalog();
  await new ServiceDiscovery(f.dependencies).ensure_catalog();
  assert.equal(f.bucket.calls.put, writes + 1);
});
test("合并发布避免慢写覆盖后续编辑，失败清理旧产物且重启后按间隔重试", async t => {
  let now = Date.now();
  t.mock.method(Date, "now", () => now);
  const f = fixture();
  f.sources.set("a", {
    ...row("a")
  });
  const put = await f.dependencies.object_store.put.bind(f.dependencies.object_store);
  let finish, started;
  const first_entered = new Promise(resolve => {
    started = resolve;
  });
  f.dependencies.object_store.put = async (...args) => {
    await new Promise(resolve => {
      finish = resolve;
      started();
    });
    return put(...args);
  };
  const first = f.service.publish_catalog();
  await first_entered;
  (await f.sources.get("a")).title = "更新";
  const second = f.service.publish_catalog();
  const second_entered = new Promise(resolve => {
    started = resolve;
  });
  finish();
  await second_entered;
  finish();
  await Promise.all([first, second]);
  assert.equal((await f.published()).sources[0].title, "更新");
  f.dependencies.object_store.put = put;
  f.bucket.fail_next({
    op: "put"
  });
  await assert.rejects(f.service.publish_catalog(), {
    status: 503
  });
  assert.equal(await f.dependencies.object_store.get(DISCOVERY_CATALOG_KEY), null);
  assert.equal(await f.metadata.get("discovery_catalog_dirty"), true);
  assert.ok((await f.service.next_snapshot_at()) >= Date.now());
  assert.ok(f.alarms > 0);
  const restarted = new ServiceDiscovery(f.dependencies);
  await restarted.ensure_catalog();
  assert.equal(await f.dependencies.object_store.get(DISCOVERY_CATALOG_KEY), null);
  now += 60000;
  await restarted.ensure_catalog();
  assert.equal((await f.published()).sources[0].title, "更新");
  assert.equal(f.metadata.has("discovery_catalog_dirty"), false);
});
test("没有 R2 时保持可读目录，写入不依赖静态发布", async () => {
  const f = fixture();
  f.service.object_store = null;
  await f.service.ensure_catalog();
  await f.service.create_discovery_source(request({
    title: "源",
    feed_url: "https://example.com/feed",
    require_token: false
  }));
  assert.equal((await f.service.public_catalog()).sources.length, 1);
  assert.equal(f.bucket.calls.put, 0);
});
test("首次 R2 检查失败按间隔重试，空目录也能补建", async t => {
  let now = Date.now();
  t.mock.method(Date, "now", () => now);
  const f = fixture();
  f.bucket.fail_next({
    op: "head"
  });
  await assert.rejects(f.service.ensure_catalog(), /head failed/);
  assert.ok(f.alarms > 0);
  assert.ok((await f.service.next_snapshot_at()) >= Date.now());
  await f.service.ensure_catalog();
  assert.equal(await f.dependencies.object_store.get(DISCOVERY_CATALOG_KEY), null);
  now += 60000;
  await f.service.ensure_catalog();
  assert.deepEqual((await f.published()).sources, []);
});
test("自动刷新在一分钟内合并目录发布，重启恢复截止时间，人工权限变更立即生效", async t => {
  let now = 2_000_000;
  t.mock.method(Date, "now", () => now);
  const f = fixture();
  for (let index = 0; index < 100; index++) f.sources.set(String(index), row(index));
  await f.service.ensure_catalog();
  const writes = f.bucket.calls.put;
  for (let index = 0; index < 100; index++) await f.service.refresh_discovery_snapshot(String(index), "", {
    automatic: true
  });
  assert.equal(f.bucket.calls.put, writes);
  assert.equal(await f.metadata.get("discovery_catalog_due_at"), now + 60000);
  await f.service.ensure_catalog();
  assert.equal(f.bucket.calls.put, writes);
  const restarted = new ServiceDiscovery(f.dependencies);
  await restarted.ensure_catalog();
  assert.equal(await restarted.next_snapshot_at(), now + 60000);
  now += 60000;
  await restarted.ensure_catalog();
  assert.equal(f.bucket.calls.put, writes + 1);
  assert.equal((await f.published()).sources[0].snapshot.articles[0].title, "新文章");
  assert.equal(f.metadata.has("discovery_catalog_dirty"), false);
  f.service = restarted;
  await f.service.refresh_discovery_snapshot("0", "", {
    automatic: true
  });
  const before_permission = f.bucket.calls.put;
  await f.service.update_discovery_source(request({
    require_token: true
  }), "0");
  assert.equal(f.bucket.calls.put, before_permission + 1);
  assert.equal((await f.published()).sources.some(source => source.id === "0"), false);
  assert.equal(f.metadata.has("discovery_catalog_due_at"), false);
  await f.service.refresh_discovery_snapshot("1", "", {
    automatic: true
  });
  assert.equal(await f.metadata.get("discovery_catalog_due_at"), now + 60000);
});
test("一次并发发布合并后续请求，发布期间收紧权限最终撤回旧内容", async () => {
  const f = fixture();
  f.sources.set("a", row("a"));
  const render = f.service.render_catalog;
  let resume, entered;
  const waiting = new Promise(resolve => {
    entered = resolve;
  });
  let first = true;
  f.service.render_catalog = async value => {
    if (first) {
      first = false;
      entered();
      await new Promise(resolve => {
        resume = resolve;
      });
    }
    return render(value);
  };
  const pending = f.service.publish_catalog();
  await waiting;
  (await f.sources.get("a")).require_token = 1;
  const requests = Array.from({
    length: 100
  }, async () => f.service.publish_catalog());
  resume();
  await Promise.all([pending, ...requests]);
  assert.equal(f.bucket.calls.put, 2);
  assert.deepEqual((await f.published()).sources, []);
});
