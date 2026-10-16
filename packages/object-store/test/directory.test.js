import assert from "node:assert/strict";
import test from "node:test";
import { BucketStore, create_memory_bucket } from "../src/index.js";

test("delimiter 折叠子目录，分页混合文件和目录，不改变普通列表和用量统计", async () => {
  const bucket = create_memory_bucket();
  const store = new BucketStore({ bucket, prefix: "scope/" });
  for (const key of ["a/one", "a/two", "b", "c/deep/file", "d"]) await store.put(key, "abc");
  const first = await store.list({ delimiter: "/", limit: 2 });
  assert.deepEqual(first.delimited_prefixes, ["scope/a/"]);
  assert.deepEqual(first.objects.map(object => object.key), ["scope/b"]);
  assert.equal(first.truncated, true);
  const next = await store.list({ delimiter: "/", cursor: first.cursor, limit: 2 });
  assert.deepEqual(next.delimited_prefixes, ["scope/c/"]);
  assert.deepEqual(next.objects.map(object => object.key), ["scope/d"]);
  assert.equal(next.truncated, false);
  const child = await store.list({ prefix: "c/", delimiter: "/" });
  assert.deepEqual(child.delimited_prefixes, ["scope/c/deep/"]);
  assert.equal((await store.list()).objects.length, 5);
  assert.equal((await store.usage()).bytes, 15);
  assert.deepEqual(await new BucketStore().list({ delimiter: "/" }), { objects: [], truncated: false, cursor: null, delimited_prefixes: [] });
});
