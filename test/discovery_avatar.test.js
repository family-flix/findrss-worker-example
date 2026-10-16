import assert from "node:assert/strict";
import test from "node:test";
import { create_memory_bucket } from "@findrss/object-store";
import { create_api_object_store } from "../server/infra/object_store.js";
import { ServiceDiscovery } from "../server/service/durable_object/discovery.js";
import { route } from "../durable_object_router.js";

const png = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0X8AAAAASUVORK5CYII=", "base64"));
const upload = (bytes = png) => new Request("https://admin/avatar", { method: "PUT", body: bytes });

function fixture({ with_bucket = true } = {}) {
  const bucket = create_memory_bucket();
  const sources = new Map([["src-1", { id: "src-1", title: "源", avatar_updated_at: 0 }]]);
  const avatars = new Map();
  const repo = { discovery: {
    find: id => sources.get(id),
    snapshot_get: () => undefined,
    exists: id => sources.has(id),
    delete(id) { sources.delete(id); avatars.delete(id); },
    avatar_get: id => avatars.get(id),
    avatar_put(id, content_type, bytes, updated_at, object_key = "") {
      avatars.set(id, { content_type, bytes, updated_at, object_key });
    },
    avatar_delete: id => avatars.delete(id),
    set_avatar_ts(id, ts) { sources.set(id, { ...sources.get(id), avatar_updated_at: ts }); },
  } };
  const storage = { transactionSync(fn) {
    const old_sources = new Map(sources), old_avatars = new Map(avatars);
    try { return fn(); }
    catch (error) {
      sources.clear(); avatars.clear();
      for (const [id, row] of old_sources) sources.set(id, row);
      for (const [id, row] of old_avatars) avatars.set(id, row);
      throw error;
    }
  } };
  const service = new ServiceDiscovery({ repo, storage,
    object_store: with_bucket ? create_api_object_store({ API_STORAGE: bucket }) : null });
  return { service, bucket, sources, avatars, repo };
}

test("上传到 R2，SQLite 只留指针，公开头像仍使用同源路径与图片响应", async () => {
  const { service, bucket, avatars } = fixture();
  const result = await service.put_discovery_avatar(upload(), "src-1");
  assert.match(result.source.avatar_url, /^\/api\/avatar\/src-1\?v=\d+$/);
  const row = avatars.get("src-1");
  assert.match(row.object_key, /^discovery\/avatars\/src-1\//);
  assert.equal(row.bytes.byteLength, 0);
  assert.equal(bucket.objects.size, 1);
  assert.equal(bucket.objects.get(row.object_key).httpMetadata.contentType, "image/png");
  const response = await route(new Request("https://internal/_public/discovery/avatars/src-1"), { discovery: service });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Type"), "image/png");
  assert.match(response.headers.get("Cache-Control"), /immutable/);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), png);
});

test("R2 上传失败保留原头像与 URL，不悄悄降级存 SQLite", async () => {
  const { service, bucket, avatars, sources } = fixture();
  await service.put_discovery_avatar(upload(), "src-1");
  const before = avatars.get("src-1"), source = sources.get("src-1");
  bucket.fail_next({ op: "put" });
  await assert.rejects(service.put_discovery_avatar(upload(), "src-1"), { status: 502 });
  assert.deepEqual(avatars.get("src-1"), before);
  assert.deepEqual(sources.get("src-1"), source);
  assert.equal(bucket.objects.size, 1);
});

test("元数据事务失败回滚并清理刚上传的 R2 对象", async () => {
  const { service, bucket, avatars, repo } = fixture();
  await service.put_discovery_avatar(upload(), "src-1");
  const before = avatars.get("src-1");
  repo.discovery.set_avatar_ts = () => { throw new Error("SQL failed"); };
  await assert.rejects(service.put_discovery_avatar(upload(), "src-1"), /SQL failed/);
  assert.deepEqual(avatars.get("src-1"), before);
  assert.deepEqual([...bucket.objects.keys()], [before.object_key]);
});

test("替换、移除头像和删除源都会清理对应 R2 对象", async () => {
  const { service, bucket, sources } = fixture();
  const first = await service.put_discovery_avatar(upload(), "src-1");
  const old_key = [...bucket.objects.keys()][0];
  const second = await service.put_discovery_avatar(upload(), "src-1");
  assert.notEqual(first.source.avatar_url, second.source.avatar_url);
  assert.equal(bucket.objects.has(old_key), false);
  assert.equal(bucket.objects.size, 1);
  assert.equal((await service.delete_discovery_avatar("src-1")).source.avatar_url, "");
  assert.equal(bucket.objects.size, 0);
  await assert.rejects(service.get_discovery_avatar("src-1"), { status: 404 });
  await service.put_discovery_avatar(upload(), "src-1");
  assert.deepEqual(await service.delete_discovery_source("src-1"), { removed: true, id: "src-1" });
  assert.equal(bucket.objects.size, 0);
  assert.equal(sources.has("src-1"), false);
});

test("上传期间删除源不会留下 R2 孤儿对象", async () => {
  const { service, bucket } = fixture();
  const put = bucket.put.bind(bucket);
  bucket.put = async (...args) => {
    await service.delete_discovery_source("src-1");
    return put(...args);
  };
  await assert.rejects(service.put_discovery_avatar(upload(), "src-1"), { status: 404 });
  assert.equal(bucket.objects.size, 0);
});

test("并发上传提交各自独立 key，最终头像正确且旧对象被清理", async () => {
  const { service, bucket, avatars } = fixture();
  const next_png = Uint8Array.from([...png, 2]);
  await Promise.all([service.put_discovery_avatar(upload(), "src-1"),
    service.put_discovery_avatar(upload(next_png), "src-1")]);
  assert.deepEqual([...bucket.objects.keys()], [avatars.get("src-1").object_key]);
  assert.deepEqual(new Uint8Array((await service.get_discovery_avatar("src-1")).bytes), next_png);
});

test("旧 SQLite 头像可读，重新上传后改存 R2", async () => {
  const { service, bucket, avatars } = fixture();
  avatars.set("src-1", { content_type: "image/png", bytes: png.buffer });
  assert.deepEqual(new Uint8Array((await service.get_discovery_avatar("src-1")).bytes), png);
  assert.equal(bucket.calls.get, 0);
  await service.put_discovery_avatar(upload(), "src-1");
  assert.ok(avatars.get("src-1").object_key);
  assert.equal(avatars.get("src-1").bytes.byteLength, 0);
});

test("无 R2 绑定沿用 SQLite 存储，R2 指针缺少绑定时报 503", async () => {
  const { service, bucket, avatars } = fixture({ with_bucket: false });
  await service.put_discovery_avatar(upload(), "src-1");
  assert.equal(avatars.get("src-1").object_key, "");
  assert.deepEqual(new Uint8Array((await service.get_discovery_avatar("src-1")).bytes), png);
  assert.equal(bucket.objects.size, 0);
  avatars.set("src-1", { object_key: "discovery/avatars/src-1/object" });
  await assert.rejects(service.get_discovery_avatar("src-1"), { status: 503 });
});

test("R2 读取失败与对象缺失分别回 502/404", async () => {
  const { service, bucket } = fixture();
  await service.put_discovery_avatar(upload(), "src-1");
  bucket.fail_next({ op: "get" });
  await assert.rejects(service.get_discovery_avatar("src-1"), { status: 502 });
  bucket.objects.clear();
  await assert.rejects(service.get_discovery_avatar("src-1"), { status: 404 });
});

test("头像仍校验源存在、非空、大小及图片魔数", async () => {
  const { service, bucket } = fixture();
  for (const [bytes, status] of [[new Uint8Array(), 413], [new Uint8Array(5 * 1024 * 1024 + 1), 413],
    [new TextEncoder().encode("<svg></svg>"), 415]]) {
    await assert.rejects(service.put_discovery_avatar(upload(bytes), "src-1"), { status });
  }
  await assert.rejects(service.put_discovery_avatar(upload(), "missing"), { status: 404 });
  assert.equal(bucket.calls.put, 0);
});
