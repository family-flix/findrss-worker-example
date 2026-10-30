import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";
import { create_memory_bucket } from "@findrss/object-store";
import { public_asset_request } from "../server/service/worker/public_assets.js";
import { create_worker } from "../router.js";
import { RepositoryDiscoverySource } from "../server/repository/discovery_source.js";
import { DiscoverySourceModel } from "../server/domain/discovery_source.js";
import { snapshot_store } from "./support/snapshot_store.js";
register("./support/quickjs_wasm_hook.js", import.meta.url);
const {
  default: api
} = await import("../api.js");
const request = (path, options) => new Request("https://feeds.example" + path, options);
const avatar_key = "discovery/avatars/source-1/object-1";
const avatar_path = "/public/avatar/source-1/object-1";
const script_key = "scripts/script-1/1.2.3.js";
const script_path = "/public/" + script_key;
function fixture() {
  const bucket = create_memory_bucket();
  const env = {
    API_STORAGE: bucket,
    APPLICATION: {
      fetch() {
        assert.fail("公开 R2 对象不应访问业务服务");
      }
    }
  };
  return {
    bucket,
    env
  };
}
test("头像和版本化/哈希脚本从 R2 直接返回，支持 HEAD、一年强缓存和无凭证访问", async () => {
  const {
    bucket,
    env
  } = fixture();
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
  await bucket.put(avatar_key, png, {
    httpMetadata: {
      contentType: "image/png"
    }
  });
  await bucket.put(script_key, "export default 'source';");
  const hash_key = "scripts/script-1/objects/" + "a".repeat(64) + ".js";
  await bucket.put(hash_key, "draft source");
  const worker = create_worker({
    api,
    admin() {
      assert.fail("无需管理员会话");
    },
    discovery() {
      assert.fail("无需访问广场");
    }
  });
  for (const [path, body, type] of [[avatar_path, png, "image/png"], [script_path, "export default 'source';", "application/javascript; charset=utf-8"], ["/public/" + hash_key, "draft source", "application/javascript; charset=utf-8"]]) {
    const response = await worker.fetch(request(path), env);
    assert.equal(response.status, 200);
    assert.equal(await response.headers.get("Content-Type"), type);
    assert.equal(await response.headers.get("Cache-Control"), "public, max-age=31536000, immutable");
    assert.equal(await response.headers.get("X-Content-Type-Options"), "nosniff");
    assert.match(await response.headers.get("ETag"), /^".+"$/);
    if (typeof body === "string") assert.equal(await response.text(), body);else assert.deepEqual(new Uint8Array(await response.arrayBuffer()), body);
    const gets = bucket.calls.get;
    const head = await worker.fetch(request(path, {
      method: "HEAD"
    }), env);
    assert.equal(head.status, 200);
    assert.equal(await head.headers.get("Content-Length"), await response.headers.get("Content-Length"));
    assert.equal(await head.text(), "");
    assert.equal(bucket.calls.get, gets);
  }
});
test("公开入口仅允许两个固定目录，不暴露 RSS、目录列表、任意 key 和写操作", async () => {
  const {
    bucket,
    env
  } = fixture();
  for (const key of ["rss/snapshots/private/feed.json", "discovery/index.html", "scripts/script-1/invalid.js"]) await bucket.put(key, "private");
  for (const path of ["/public", "/public/", "/public/avatar", "/public/avatar/", "/public/scripts/", "/public/rss/snapshots/private/feed.json", "/public/scripts/script-1/invalid.js", "/public/scripts/script-1/01.2.3.js", "/public/scripts/script-1/objects/short.js", "/public/avatar/source-1/object-1/extra", "/public/avatar/source-1/%2F..%2Frss", "/public/avatar/..%5Crss/key", "/public/scripts/script-1/%2e%2e%2frss.js", "/public/file?key=rss/snapshots/private/feed.json", "/public/avatar/source-1/../../rss/snapshots/private/feed.json"]) {
    const response = await api.fetch(request(path), env);
    assert.equal(response.status, 404, path);
    assert.equal(await response.headers.get("Cache-Control"), "no-store", path);
  }
  for (const method of ["POST", "PUT", "DELETE", "OPTIONS"]) {
    const response = await api.fetch(request(avatar_path, {
      method
    }), env);
    assert.equal(response.status, 405);
    assert.equal(await response.headers.get("Allow"), "GET, HEAD");
  }
  assert.equal(bucket.calls.get, 0);
  assert.equal(bucket.calls.list, 0);
  assert.equal(bucket.calls.delete, 0);
});
test("对象缺失、R2 缺少绑定或读取失败不缓存，非光栅头像拒绝返回", async () => {
  const {
    bucket,
    env
  } = fixture();
  assert.equal((await public_asset_request(request(avatar_path), env)).status, 404);
  assert.equal((await public_asset_request(request(script_path), {})).status, 503);
  bucket.fail_next({
    op: "get"
  });
  const failed = await public_asset_request(request(avatar_path), env);
  assert.equal(failed.status, 502);
  assert.equal(await failed.headers.get("Cache-Control"), "no-store");
  assert.doesNotMatch(await failed.text(), /memory bucket/);
  await bucket.put(avatar_key, "<svg/>", {
    httpMetadata: {
      contentType: "image/svg+xml"
    }
  });
  assert.equal((await public_asset_request(request(avatar_path), env)).status, 415);
});
test("边缘缓存命中后不再读取 R2，新头像对象路径独立缓存，错误响应不进入缓存", async t => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "caches");
  const entries = new Map();
  Object.defineProperty(globalThis, "caches", {
    configurable: true,
    value: {
      default: {
        async match(key) {
          return (await entries.get(key.url))?.clone();
        },
        async put(key, response) {
          entries.set(key.url, response);
        }
      }
    }
  });
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, "caches", descriptor);else delete globalThis.caches;
  });
  const {
    bucket,
    env
  } = fixture();
  await bucket.put(avatar_key, "first", {
    httpMetadata: {
      contentType: "image/png"
    }
  });
  const pending = [];
  const first = await public_asset_request(request(avatar_path + "?ignored=1"), env, {
    waitUntil(value) {
      pending.push(value);
    }
  });
  assert.equal(await first.text(), "first");
  await Promise.all(pending);
  await bucket.delete(avatar_key);
  assert.equal(await (await public_asset_request(request(avatar_path), env)).text(), "first");
  const head = await public_asset_request(request(avatar_path, {
    method: "HEAD"
  }), env);
  assert.equal(await head.text(), "");
  assert.equal(bucket.calls.get, 1);
  assert.equal(bucket.calls.head, 0);
  await bucket.put("discovery/avatars/source-1/object-2", "second", {
    httpMetadata: {
      contentType: "image/png"
    }
  });
  assert.equal(await (await public_asset_request(request("/public/avatar/source-1/object-2"), env)).text(), "second");
  const missing = await public_asset_request(request("/public/avatar/source-1/missing"), env);
  assert.equal(missing.status, 404);
  assert.equal(entries.size, 2);
});
test("旧 SQLite 头像保留版本化公开入口，未带版本号的可变入口仅缓存一分钟", async () => {
  const calls = [];
  const env = {
    APPLICATION: (() => ({
      fetch(url) {
        calls.push(url);
        return new Response("legacy", {
          headers: {
            "Content-Type": "image/png",
            "Cache-Control": "public, max-age=31536000, immutable"
          }
        });
      }
    }))()
  };
  for (const [suffix, expected] of [["?v=123", "public, max-age=31536000, immutable"], ["", "public, max-age=60"]]) {
    const response = await public_asset_request(request("/public/avatar/source-1" + suffix), env);
    assert.equal(await response.text(), "legacy");
    assert.equal(await response.headers.get("Cache-Control"), expected);
  }
  assert.deepEqual(calls, Array(2).fill("https://internal/_public/discovery/avatars/source-1"));
});
test("SQLite 列表和详情携带头像对象 key，页面拿到 R2 直读 URL，旧头像继续可读", async t => {
  const store = snapshot_store();
  t.after(async () => await store.db.close());
  const repo = new RepositoryDiscoverySource(store);
  store.sql.exec(`INSERT INTO discovery_sources (id, title, feed_url, category, enabled, require_token, avatar_updated_at, created_at, updated_at)
    VALUES ('source-1', '源', 'https://example.com/feed', '', 1, 0, 123, 1, 1)`);
  await repo.avatar_put("source-1", "image/png", new Uint8Array(), 123, avatar_key);
  for (const row of [await repo.find("source-1"), await repo.find_enabled("source-1"), (await repo.list({
    include_disabled: true
  }))[0], (await repo.list({
    include_disabled: false
  }))[0]]) {
    const model = DiscoverySourceModel.fromRow(row);
    assert.equal(model.toValue().avatar_url, avatar_path);
    assert.equal(model.avatar().path(), avatar_path);
  }
  await repo.avatar_put("source-1", "image/png", new Uint8Array([1]), 123);
  assert.equal(DiscoverySourceModel.fromRow(await repo.find("source-1")).toValue().avatar_url, "/public/avatar/source-1?v=123");
});
