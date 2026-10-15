import assert from "node:assert/strict";
import test from "node:test";

import { create_memory_bucket } from "../src/index.js";

test("get miss 返回 null", async () => {
  const bucket = create_memory_bucket();
  assert.equal(await bucket.get("nope"), null);
  assert.equal(await bucket.head("nope"), null);
});

test("put 记录真实字节数与 httpMetadata", async () => {
  const bucket = create_memory_bucket();
  await bucket.put("k", "中文", { httpMetadata: { contentType: "image/png" } });
  const object = await bucket.get("k");
  assert.equal(object.size, 6);
  assert.equal(object.httpMetadata.contentType, "image/png");
  assert.equal(await object.text(), "中文");
});

test("arrayBuffer 往返", async () => {
  const bucket = create_memory_bucket();
  await bucket.put("k", new Uint8Array([1, 2, 3]));
  const object = await bucket.get("k");
  assert.deepEqual([...new Uint8Array(await object.arrayBuffer())], [1, 2, 3]);
});

test("delete([]) 抛错（模拟 R2 10027）", async () => {
  const bucket = create_memory_bucket();
  await assert.rejects(() => bucket.delete([]));
});

test("delete 超过 1000 键抛错", async () => {
  const bucket = create_memory_bucket();
  await assert.rejects(() => bucket.delete(Array.from({ length: 1001 }, (_, i) => `k${i}`)));
});

test("list 按 key 字典序，游标取上一页最后一个 key", async () => {
  const bucket = create_memory_bucket();
  for (const key of ["b", "a", "d", "c"]) await bucket.put(key, "x");
  const first = await bucket.list({ prefix: "", limit: 2 });
  assert.deepEqual(first.objects.map((o) => o.key), ["a", "b"]);
  assert.equal(first.truncated, true);
  assert.equal(first.cursor, "b");
  const second = await bucket.list({ prefix: "", cursor: first.cursor, limit: 2 });
  assert.deepEqual(second.objects.map((o) => o.key), ["c", "d"]);
  assert.equal(second.truncated, false);
  assert.equal(second.cursor, null);
});

test("list 按前缀过滤", async () => {
  const bucket = create_memory_bucket();
  await bucket.put("p/a", "x");
  await bucket.put("p/b", "x");
  await bucket.put("q/c", "x");
  const page = await bucket.list({ prefix: "p/" });
  assert.deepEqual(page.objects.map((o) => o.key), ["p/a", "p/b"]);
});

test("fail_next 只生效一次", async () => {
  const bucket = create_memory_bucket();
  await bucket.put("k", "x");
  bucket.fail_next({ op: "get" });
  await assert.rejects(() => bucket.get("k"));
  assert.equal((await bucket.get("k")).key, "k");
});

test("calls 计数", async () => {
  const bucket = create_memory_bucket();
  await bucket.put("k", "x");
  await bucket.get("k");
  await bucket.list({});
  await bucket.delete(["k"]);
  assert.deepEqual(bucket.calls, { get: 1, put: 1, delete: 1, list: 1, head: 0 });
});
