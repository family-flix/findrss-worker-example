import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_LOG_DEPTH,
  MAX_LOG_METADATA_LENGTH,
  redact_log_value,
  serialize_log_metadata,
} from "../server/lib/log_redact.js";

test("键名命中敏感词时整值替换，不看值本身长什么样", () => {
  const redacted = redact_log_value({
    authorization: "Bearer api_call_abc",
    cookie: "session=1",
    password: "hunter2",
    passwd: "hunter2",
    secret: "s",
    token: "t",
    api_token: "t",
    accessToken: "t",
    "x-findrss-token": "t",
    refresh_secret_value: "t",
  });
  for (const [key, value] of Object.entries(redacted)) {
    assert.equal(value, "[redacted]", `${key} 应被脱敏`);
  }
});

test("camelCase 先归一成 snake_case 再匹配，取值不受影响", () => {
  assert.deepEqual(redact_log_value({ myAuthToken: "x" }), { myAuthToken: "[redacted]" });
  assert.deepEqual(redact_log_value({ myAuthTokens: "x" }), { myAuthTokens: "x" });
});

test("非敏感键原样保留，普通标量与 null 直接返回", () => {
  assert.deepEqual(redact_log_value({ method: "get", count: 3, flag: true }), {
    method: "get",
    count: 3,
    flag: true,
  });
  assert.equal(redact_log_value(null), null);
  assert.equal(redact_log_value("plain"), "plain");
  assert.equal(redact_log_value(7), 7);
  assert.equal(redact_log_value(undefined), undefined);
});

test("数组与嵌套对象逐层脱敏，敏感键在任意深度都命中", () => {
  assert.deepEqual(redact_log_value([{ token: "a" }, "b", [["c"]]]), [
    { token: "[redacted]" },
    "b",
    [["c"]],
  ]);
  assert.deepEqual(redact_log_value({ outer: { inner: { api_secret: "s" } } }), {
    outer: { inner: { api_secret: "[redacted]" } },
  });
});

test("深度封顶：超过上限回 [max depth]，循环引用因此不抛错", () => {
  let deep = "leaf";
  for (let index = 0; index < MAX_LOG_DEPTH; index += 1) deep = { next: deep };
  const redacted = redact_log_value(deep);
  let node = redacted;
  let levels = 0;
  while (node && typeof node === "object") {
    node = node.next;
    levels += 1;
  }
  assert.equal(levels, MAX_LOG_DEPTH);
  assert.equal(node, "[max depth]");

  /** @type {Record<string, unknown>} */
  const cyclic = { token: "x" };
  cyclic.self = cyclic;
  const cyclic_redacted = redact_log_value(cyclic);
  assert.equal(cyclic_redacted.token, "[redacted]");
  assert.notEqual(cyclic_redacted.self, undefined);
});

test("serialize_log_metadata 输出合法 JSON，缺省 metadata 归一成 {}", () => {
  assert.equal(serialize_log_metadata(undefined), "{}");
  assert.equal(serialize_log_metadata(null), "{}");
  assert.equal(serialize_log_metadata({ token: "x", ok: 1 }), '{"token":"[redacted]","ok":1}');
  assert.deepEqual(JSON.parse(serialize_log_metadata({ a: [1, 2] })), { a: [1, 2] });
});

test("序列化失败不抛错，降级成 serialization_error", () => {
  const raw = serialize_log_metadata({ big: BigInt(1) });
  const parsed = JSON.parse(raw);
  assert.equal(typeof parsed.serialization_error, "string");
  assert.ok(parsed.serialization_error.length > 0);
});

test("超过长度上限时只留 preview，并记住原始长度", () => {
  const raw = serialize_log_metadata({ blob: "x".repeat(MAX_LOG_METADATA_LENGTH + 1000) });
  const parsed = JSON.parse(raw);
  assert.equal(parsed.truncated, true);
  assert.ok(parsed.original_length > MAX_LOG_METADATA_LENGTH);
  assert.equal(typeof parsed.preview, "string");
  assert.ok(parsed.preview.length <= MAX_LOG_METADATA_LENGTH);
  // 截断后的整串仍然受上限约束，不会把超长值又写回去
  assert.ok(raw.length <= MAX_LOG_METADATA_LENGTH + 200);
});

test("刚好在上限内时不截断", () => {
  const value = { blob: "y".repeat(1024) };
  assert.deepEqual(JSON.parse(serialize_log_metadata(value)), value);
});
