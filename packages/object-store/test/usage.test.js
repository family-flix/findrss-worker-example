import assert from "node:assert/strict";
import test from "node:test";

import { BucketStore, create_memory_bucket } from "../src/index.js";

test("usage 跨多页求和", async () => {
  const bucket = create_memory_bucket();
  const store = new BucketStore({ bucket });
  // 2500 个 3 字节对象 = 7500 字节，跨 3 页。
  for (let index = 0; index < 2500; index += 1) await store.put(`k${index.toString().padStart(4, "0")}`, "abc");
  const usage = await store.usage();
  assert.equal(usage.bytes, 7500);
  assert.equal(usage.objects, 2500);
  assert.equal(usage.truncated, false);
  assert.equal(usage.pages, 3);
});

test("usage 按前缀隔离", async () => {
  const bucket = create_memory_bucket();
  await bucket.put("bodies/local/a", "12345");
  await bucket.put("feed-icons/local/b", "12");
  const store = new BucketStore({ bucket });
  const bodies = await store.usage("bodies/local/");
  assert.equal(bodies.bytes, 5);
  assert.equal(bodies.objects, 1);
  const icons = await store.usage("feed-icons/local/");
  assert.equal(icons.bytes, 2);
});

test("usage 在 maxPages 处停下并置 truncated", async () => {
  const bucket = create_memory_bucket();
  const store = new BucketStore({ bucket });
  for (let index = 0; index < 1500; index += 1) await store.put(`k${index.toString().padStart(4, "0")}`, "abc");
  const usage = await store.usage("", { maxPages: 1 });
  assert.equal(usage.pages, 1);
  assert.equal(usage.objects, 1000);
  assert.equal(usage.truncated, true);
});

test("usage 在 maxObjects 处停下并置 truncated", async () => {
  const bucket = create_memory_bucket();
  const store = new BucketStore({ bucket });
  for (let index = 0; index < 2500; index += 1) await store.put(`k${index.toString().padStart(4, "0")}`, "abc");
  const usage = await store.usage("", { maxObjects: 1500 });
  assert.equal(usage.objects, 2000);
  assert.equal(usage.truncated, true);
});
