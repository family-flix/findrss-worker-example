import assert from "node:assert/strict";
import test from "node:test";

import { LogThrottle } from "../server/infra/log_throttle.js";

test("同一个键在窗口内只放行一次，窗口过后再放行", () => {
  const throttle = new LogThrottle(1000);
  assert.equal(throttle.allow("/feed|invoke", 10_000), true);
  assert.equal(throttle.allow("/feed|invoke", 10_500), false);
  assert.equal(throttle.allow("/feed|invoke", 10_999), false);
  assert.equal(throttle.allow("/feed|invoke", 11_000), true);
});

test("不同键互不影响（各自计时）", () => {
  const throttle = new LogThrottle(1000);
  assert.equal(throttle.allow("/a|invoke", 10_000), true);
  assert.equal(throttle.allow("/a|runtime", 10_000), true);
  assert.equal(throttle.allow("/b|invoke", 10_000), true);
  assert.equal(throttle.allow("/a|invoke", 10_100), false);
  assert.equal(throttle.allow("/b|invoke", 10_100), false);
});

test("键数超上限时淘汰最久未放行的键", () => {
  const throttle = new LogThrottle(1000, 2);
  throttle.allow("a", 1000);
  throttle.allow("b", 1000);
  // 再放行 a 会把它挪到队尾（最近放行），于是 b 成为最旧的键。
  throttle.allow("a", 2000);
  throttle.allow("c", 2000);
  assert.equal(throttle.allowed_at.size, 2);
  assert.equal(throttle.allowed_at.has("b"), false);
  assert.equal(throttle.allowed_at.has("a"), true);
  assert.equal(throttle.allowed_at.has("c"), true);
  // b 被淘汰等于「忘了它」，下次直接放行。
  assert.equal(throttle.allow("b", 2100), true);
});
