import assert from "node:assert/strict";
import test from "node:test";

import { create_memory_bucket } from "@findrss/object-store";

import { create_api_object_store } from "../server/infra/object_store.js";

test("绑定缺席返回 null，不抛错", () => {
  // 缺少绑定的环境由调用方决定降级路径，头像沿用 SQLite。
  assert.equal(create_api_object_store(undefined), null);
  assert.equal(create_api_object_store({}), null);
  assert.equal(create_api_object_store({ API_STORAGE: null }), null);
  // env 整个是 undefined 也不能炸——工厂本身必须能在任何调用时机被调用。
  assert.equal(create_api_object_store(), null);
});

test("绑定在时给一个可用的 store，前缀由 store 施加", async () => {
  const bucket = create_memory_bucket();
  const store = create_api_object_store({ API_STORAGE: bucket });
  assert.notEqual(store, null);
  assert.equal(store.available, true);

  await store.put("probe.txt", "hello");
  // 调用方给相对 key，实际落桶的是 `prefix + key`（前缀空时为原样）。
  assert.equal(bucket.objects.has("probe.txt"), true);
  assert.equal(await store.get_text("probe.txt"), "hello");
});
