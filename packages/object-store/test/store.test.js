import assert from "node:assert/strict";
import test from "node:test";

import { BucketStore, ObjectStoreError, create_memory_bucket } from "../src/index.js";

test("put → get 往返，miss 返回 null / 空文本", async () => {
  const store = new BucketStore({ bucket: create_memory_bucket() });
  await store.put("a/b.html", "<p>hi</p>");
  assert.equal(await store.get_text("a/b.html"), "<p>hi</p>");
  assert.equal(await store.get("missing"), null);
  assert.equal(await store.get_text("missing"), "");
  assert.equal(await store.exists("missing"), false);
  assert.equal(await store.exists("a/b.html"), true);
});

test("前缀由 store 施加，调用方只给相对 key", async () => {
  const bucket = create_memory_bucket();
  const store = new BucketStore({ bucket, prefix: "ns" });
  await store.put("a", "x");
  assert.equal(bucket.objects.has("ns/a"), true);
  assert.equal(await store.get_text("a"), "x");
  assert.equal(await store.delete("a"), 1);
  assert.equal(bucket.objects.has("ns/a"), false);
});

test("put 把 ReadableStream 原样透传（同一对象身份）", async () => {
  const bucket = create_memory_bucket();
  const store = new BucketStore({ bucket });
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2, 3]));
      controller.close();
    },
  });
  await store.put("s.bin", stream);
  assert.equal(bucket.objects.get("s.bin").value, stream);
});

test("delete_many([]) 不发出任何 delete 调用", async () => {
  const bucket = create_memory_bucket();
  const store = new BucketStore({ bucket });
  assert.equal(await store.delete_many([]), 0);
  assert.equal(await store.delete_many(["", ""]), 0);
  assert.equal(bucket.calls.delete, 0);
});

test("delete_many 按 1000 分批（2500 → 3 次）", async () => {
  const bucket = create_memory_bucket();
  const store = new BucketStore({ bucket });
  const keys = Array.from({ length: 2500 }, (_, index) => `k${index}`);
  for (const key of keys) await bucket.put(key, "x");
  assert.equal(await store.delete_many(keys), 2500);
  assert.equal(bucket.calls.delete, 3);
  assert.equal(bucket.objects.size, 0);
});

test("delete_many: best_effort 吞错 vs 默认透传", async () => {
  const tolerant = create_memory_bucket();
  const keys = Array.from({ length: 1500 }, (_, index) => `k${index}`);
  for (const key of keys) await tolerant.put(key, "x");
  tolerant.fail_next({ op: "delete" }); // 第一批失败
  const lenient = new BucketStore({ bucket: tolerant });
  assert.equal(await lenient.delete_many(keys, { best_effort: true }), 1500);

  const strict = create_memory_bucket();
  for (const key of keys) await strict.put(key, "x");
  strict.fail_next({ op: "delete" });
  const store = new BucketStore({ bucket: strict });
  await assert.rejects(() => store.delete_many(keys), /delete failed/);
});

test("list 游标分页与前缀过滤", async () => {
  const bucket = create_memory_bucket();
  const store = new BucketStore({ bucket, prefix: "p" });
  for (const key of ["b", "a", "d", "c"]) await store.put(key, "x");
  await bucket.put("other/z", "x");
  const first = await store.list({ limit: 2 });
  assert.deepEqual(first.objects.map((object) => object.key), ["p/a", "p/b"]);
  assert.equal(first.truncated, true);
  const second = await store.list({ cursor: first.cursor, limit: 2 });
  assert.deepEqual(second.objects.map((object) => object.key), ["p/c", "p/d"]);
  assert.equal(second.truncated, false);
  assert.equal(second.cursor, null);

  const all = await store.list_all();
  assert.equal(all.objects.length, 4);
  assert.equal(all.truncated, false);
});

test("list_all 在 maxObjects 处截断", async () => {
  const bucket = create_memory_bucket();
  const store = new BucketStore({ bucket });
  for (const key of ["a", "b", "c"]) await store.put(key, "x");
  const page_one = await store.list_all({ maxObjects: 1, maxPages: 1 });
  // 一页内已经拿到 3 条，超出 maxObjects → 截断并裁到上限。
  assert.equal(page_one.objects.length, 1);
  assert.equal(page_one.truncated, true);
});

test("空 store 模式：每个方法都给出一致的降级形状", async () => {
  const store = new BucketStore({});
  assert.equal(store.available, false);
  assert.equal(await store.get("a"), null);
  assert.equal(await store.head("a"), null);
  assert.equal(await store.get_text("a"), "");
  assert.equal(await store.exists("a"), false);
  assert.equal(await store.put("a", "x"), 0);
  assert.equal(await store.put_text("a", "x"), 0);
  assert.equal(await store.delete("a"), 0);
  assert.equal(await store.delete_many(["a"]), 0);
  assert.deepEqual(await store.list(), { objects: [], truncated: false, cursor: null });
  assert.deepEqual(await store.list_all(), { objects: [], truncated: false, pages: 0 });
  assert.deepEqual(await store.usage(), {
    bytes: 0,
    objects: 0,
    truncated: false,
    pages: 0,
    available: false,
  });
});

test("桶存在但缺 get/put/delete/list → invalid_bucket", () => {
  assert.throws(
    () => new BucketStore({ bucket: { get() {}, put() {}, delete() {} } }),
    (error) => error instanceof ObjectStoreError && error.code === "invalid_bucket",
  );
});

/**
 * 真实 R2 的 `ListOptions` 会校验字段类型：`cursor` 只接受 string，传 `null` 直接抛
 * `Incorrect type for the 'cursor' field`。内存桶容忍 null，所以 `create_memory_bucket`
 * 永远抓不到这条——必须用一个「像真桶那样挑刺」的桶。
 */
function create_strict_bucket() {
  const inner = create_memory_bucket();
  return {
    ...inner,
    async list(options = {}) {
      if (options.cursor !== undefined && typeof options.cursor !== "string") {
        throw new TypeError("Incorrect type for the 'cursor' field on 'ListOptions'");
      }
      return inner.list(options);
    },
  };
}

test("list 无游标时省略 cursor 字段（真实 R2 不接受 null）", async () => {
  const store = new BucketStore({ bucket: create_strict_bucket() });
  await store.put("a", "x");
  await store.put("b", "y");
  assert.deepEqual((await store.list()).objects.length, 2);
  // `usage()` 从 `cursor = null` 起步，第一页就是「无游标」那条路径。
  const usage = await store.usage();
  assert.equal(usage.objects, 2);
  assert.equal(usage.truncated, false);
  // 显式传 null 也不该把 null 丢给桶。
  assert.equal((await store.list({ cursor: null })).objects.length, 2);
});

test("list 翻页时把游标原样交给桶", async () => {
  const store = new BucketStore({ bucket: create_strict_bucket() });
  for (const key of ["a", "b", "c"]) await store.put(key, "x");
  const first = await store.list({ limit: 2 });
  assert.equal(first.truncated, true);
  const second = await store.list({ cursor: first.cursor, limit: 2 });
  assert.deepEqual(second.objects.map((object) => object.key), ["c"]);
  assert.equal(second.truncated, false);
});
