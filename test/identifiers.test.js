import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_ACCESS_TOKEN_LENGTH,
  MIN_ACCESS_TOKEN_LENGTH,
  access_token_hint,
  decode_identifier,
  safe_equal,
  valid_access_token,
  valid_identifier,
} from "../server/lib/identifiers.js";

test("valid_identifier 接受 UUID、带前缀的 token 与冒号分段", () => {
  assert.equal(valid_identifier("6f1c5f0a-1111-4222-8333-444455556666"), true);
  assert.equal(valid_identifier("api_call_abcd-efgh_ijkl"), true);
  assert.equal(valid_identifier("reader:local"), true);
  assert.equal(valid_identifier("a"), true);
  assert.equal(valid_identifier("a".repeat(128)), true);
});

test("valid_identifier 拒绝空串、超长、首字符非字母数字与路径穿越字符", () => {
  assert.equal(valid_identifier(""), false);
  assert.equal(valid_identifier("a".repeat(129)), false);
  assert.equal(valid_identifier("_leading"), false);
  assert.equal(valid_identifier(".leading"), false);
  assert.equal(valid_identifier("-leading"), false);
  assert.equal(valid_identifier(":leading"), false);
  assert.equal(valid_identifier("../etc/passwd"), false);
  assert.equal(valid_identifier("with space"), false);
  assert.equal(valid_identifier("with/slash"), false);
  assert.equal(valid_identifier("换行\n"), false);
});

test("decode_identifier 先解码再校验，畸形百分号编码回 null", () => {
  assert.equal(decode_identifier("api_call_abc"), "api_call_abc");
  assert.equal(decode_identifier("reader%3Alocal"), "reader:local");
  assert.equal(decode_identifier("%E4%B8%AD%E6%96%87"), null);
  assert.equal(decode_identifier("%E0%A4%A"), null);
  assert.equal(decode_identifier("../etc"), null);
  assert.equal(decode_identifier(""), null);
});

test("safe_equal 判等正确，长度不同与仅前缀相同都返回 false", () => {
  assert.equal(safe_equal("", ""), true);
  assert.equal(safe_equal("token", "token"), true);
  assert.equal(safe_equal("token", "toke"), false);
  assert.equal(safe_equal("toke", "token"), false);
  assert.equal(safe_equal("token", "tokeX"), false);
  assert.equal(safe_equal("token", "Token"), false);
  // 多字节：按 UTF-8 字节比较，长度差混进同一累积位
  assert.equal(safe_equal("密码", "密码"), true);
  assert.equal(safe_equal("密码", "密"), false);
});

test("valid_access_token 卡在 16–256 位并限制字符集", () => {
  assert.equal(valid_access_token("a".repeat(MIN_ACCESS_TOKEN_LENGTH)), true);
  assert.equal(valid_access_token("a".repeat(MAX_ACCESS_TOKEN_LENGTH)), true);
  assert.equal(valid_access_token("a".repeat(MIN_ACCESS_TOKEN_LENGTH - 1)), false);
  assert.equal(valid_access_token("a".repeat(MAX_ACCESS_TOKEN_LENGTH + 1)), false);
  assert.equal(valid_access_token(""), false);
  // 允许 base64url 与标准 base64 的字符，含 + 与 =
  assert.equal(valid_access_token("api_call_ab+cd/ef-gh_ij=="), true);
  // 不允许空白与查询串分隔符
  assert.equal(valid_access_token("api call abcdefgh"), false);
  assert.equal(valid_access_token("api_call_abc&x=1"), false);
  assert.equal(valid_access_token("api_call_ab\ncd"), false);
});

test("access_token_hint 留 api_call_ 前缀更长，末 4 位始终可见", () => {
  const api_call = "api_call_abcdefghijklmnopqrstuvwxyz";
  assert.equal(access_token_hint(api_call), api_call.slice(0, 20) + "…" + api_call.slice(-4));
  assert.equal(access_token_hint("sometoken_1234567890"), "some…7890");
});

test("access_token_hint 对短 token 不抛错（重复展示总比崩掉好）", () => {
  assert.equal(access_token_hint("ab"), "ab…ab");
  assert.equal(access_token_hint(""), "…");
});
