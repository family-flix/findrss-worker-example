import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_KEY_LENGTH,
  ObjectStoreError,
  is_valid_key,
  join_key,
  key_prefix,
  normalize_key,
} from "../src/index.js";

/** 断言非法 key 会以稳定的 code 抛出。 */
function assert_invalid(value) {
  assert.throws(
    () => normalize_key(value),
    (error) => error instanceof ObjectStoreError && error.code === "invalid_key",
  );
  assert.equal(is_valid_key(value), false);
}

test("接受普通相对 key", () => {
  assert.equal(normalize_key("a"), "a");
  assert.equal(normalize_key("bodies/local/abc.html"), "bodies/local/abc.html");
  assert.equal(is_valid_key("feed-icons/local/ff"), true);
});

test("拒绝非字符串与空串", () => {
  assert_invalid("");
  assert_invalid(null);
  assert_invalid(undefined);
  assert_invalid(42);
});

test("拒绝前导/尾随斜杠与空段", () => {
  assert_invalid("/a");
  assert_invalid("a/");
  assert_invalid("a//b");
});

test("拒绝 . 与 .. 段", () => {
  assert_invalid(".");
  assert_invalid("..");
  assert_invalid("a/./b");
  assert_invalid("a/../b");
  assert_invalid("../a");
});

test("拒绝反斜杠", () => {
  assert_invalid("a\\b");
});

test("拒绝控制字符", () => {
  assert_invalid("a\u0000b");
  assert_invalid("a\nb");
  assert_invalid("a\u007fb");
});

test("1024 字节边界", () => {
  assert.equal(normalize_key("a".repeat(MAX_KEY_LENGTH)).length, MAX_KEY_LENGTH);
  assert_invalid("a".repeat(MAX_KEY_LENGTH + 1));
  // 多字节按字节算，不按字符算：513 个汉字 = 1539 字节。
  assert_invalid("中".repeat(513));
});

test("join_key 丢弃空段并剥掉段首尾斜杠", () => {
  assert.equal(join_key("bodies", "local", "abc.html"), "bodies/local/abc.html");
  assert.equal(join_key("bodies/", "/local/", "abc.html"), "bodies/local/abc.html");
  assert.equal(join_key("a", null, undefined, "", "b"), "a/b");
});

test("join_key 全部为空时抛错", () => {
  assert.throws(() => join_key("", null), ObjectStoreError);
});

test("key_prefix 归一前缀", () => {
  assert.equal(key_prefix(""), "");
  assert.equal(key_prefix("/"), "");
  assert.equal(key_prefix(null), "");
  assert.equal(key_prefix("a/b"), "a/b/");
  assert.equal(key_prefix("a/b/"), "a/b/");
  assert.equal(key_prefix("/a"), "a/");
  assert.throws(() => key_prefix("a/../b"), ObjectStoreError);
  assert.throws(() => key_prefix("a//b"), ObjectStoreError);
});
