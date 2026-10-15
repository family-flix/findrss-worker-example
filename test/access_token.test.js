import assert from "node:assert/strict";
import test from "node:test";

import { AccessTokenModel } from "../server/domain/access_token.js";

const value_of = (row, now) => AccessTokenModel.fromRow(row).toValue(now);

test("AccessTokenModel 的 status 按 revoked → expired → active 排序", () => {
  const base = {
    id: "tok-1",
    name: "设备 A",
    email: null,
    token_hint: "api_call_abc…wxyz",
    revoked_at: null,
    expires_at: null,
    created_at: 1,
    last_used_at: null,
    credit_balance: 5,
    total_credits_granted: 10,
    total_credits_used: 5,
  };
  assert.equal(value_of(base, 1000).status, "active");
  assert.equal(value_of({ ...base, expires_at: 1000 }, 1000).status, "expired");
  assert.equal(value_of({ ...base, expires_at: 2000 }, 1000).status, "active");
  // 撤销是终态，压过过期
  assert.equal(value_of({ ...base, revoked_at: 1, expires_at: 1 }, 1000).status, "revoked");
  // 行为入口与 toValue 同源
  assert.equal(AccessTokenModel(base).status(1000), "active");
});

test("AccessTokenModel 不泄露 token 本体，缺 email 时给 null", () => {
  const value = value_of(
    {
      id: "tok-1",
      name: "设备 A",
      token_hint: "hint",
      revoked_at: null,
      expires_at: null,
      created_at: 1,
      last_used_at: 2,
      credit_balance: 5,
      total_credits_granted: 10,
      total_credits_used: 5,
    },
    1000,
  );
  assert.equal(value.email, null);
  assert.equal(Object.values(value).includes(undefined), false);
  assert.equal(JSON.stringify(value).includes("api_call_"), false);
});

test("AccessTokenModel.is_active_at 与 SQL 谓词同口径", () => {
  const active = AccessTokenModel({ revoked_at: null, expires_at: null });
  assert.equal(active.is_active_at(1000), true);
  assert.equal(AccessTokenModel({ revoked_at: null, expires_at: 2000 }).is_active_at(1000), true);
  // 到期时刻起即失效（> 而非 >=）
  assert.equal(AccessTokenModel({ revoked_at: null, expires_at: 1000 }).is_active_at(1000), false);
  assert.equal(AccessTokenModel({ revoked_at: 1, expires_at: null }).is_active_at(1000), false);
  assert.equal(
    AccessTokenModel.active_sql("access_tokens."),
    "access_tokens.revoked_at IS NULL AND (access_tokens.expires_at IS NULL OR access_tokens.expires_at > ?)",
  );
});

test("AccessTokenModel.validate_lifetime 夹到 [60, 上限] 秒", () => {
  assert.deepEqual(AccessTokenModel.validate_lifetime(undefined), { ok: true, expires_in_seconds: null });
  assert.deepEqual(AccessTokenModel.validate_lifetime(3600), { ok: true, expires_in_seconds: 3600 });
  assert.deepEqual(AccessTokenModel.validate_lifetime(60), { ok: true, expires_in_seconds: 60 });
  assert.equal(AccessTokenModel.validate_lifetime(59).ok, false);
  assert.equal(AccessTokenModel.validate_lifetime("abc").ok, false);
  assert.equal(
    AccessTokenModel.validate_lifetime(AccessTokenModel.MAX_LIFETIME_SECONDS + 1).error.message,
    "invalid expires_in_seconds",
  );
  assert.deepEqual(AccessTokenModel.duplicate_reason(), {
    status: 409,
    message: "access token already exists",
  });
});
