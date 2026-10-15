import assert from "node:assert/strict";
import test from "node:test";

import { RegisteredUserModel } from "../server/domain/registered_user.js";

test("RegisteredUserModel 归一并校验注册登录字段", () => {
  assert.equal(RegisteredUserModel.normalize_email(" Reader@Example.COM "), "reader@example.com");
  assert.equal(RegisteredUserModel.valid_email("reader@example.com"), true);
  assert.equal(RegisteredUserModel.valid_email("reader@example"), false);
  assert.equal(RegisteredUserModel.valid_password("12345678"), true);
  assert.equal(RegisteredUserModel.valid_password("1234567"), false);
  assert.equal(RegisteredUserModel.default_name("a.b+tag@example.com"), "a.b+tag");
  assert.equal(RegisteredUserModel.default_name("x".repeat(200) + "@example.com").length, 128);
});

test("RegisteredUserModel 区分注册用户身份与 access token 的同名列", () => {
  assert.deepEqual(
    RegisteredUserModel.fromIdentityRow({
      id: "token-1",
      name: "设备凭证",
      user_id: "user-1",
      user_name: "Alice",
      email: "alice@example.com",
      password_hash: "secret",
    }).toValue(),
    { id: "user-1", name: "Alice", email: "alice@example.com" },
  );
});

test("RegisteredUserModel 的管理视图归一积分聚合值且不泄露密码哈希", () => {
  const model = RegisteredUserModel.fromRow({
    id: "user-1",
    name: "Alice",
    email: "alice@example.com",
    email_verified_at: 10,
    password_hash: "secret",
    token_count: "2",
    active_token_count: "1",
    credit_balance: "30",
    total_credits_used: "4",
  });
  assert.equal(model.admin_list_value().token_count, 2);
  assert.equal(model.admin_list_value().credit_balance, 30);
  assert.equal(model.admin_detail_value().has_password, true);
  assert.equal(JSON.stringify(model).includes("secret"), false);
  assert.equal(JSON.stringify(model.admin_detail_value()).includes("secret"), false);
});

test("RegisteredUserModel 没有邮箱凭据时不会误判为已验证", () => {
  const value = RegisteredUserModel.fromRow({ id: "user-1", name: "Alice" }).admin_detail_value();
  assert.equal(value.email, null);
  assert.equal(value.email_verified, false);
  assert.equal(value.email_verified_at, null);
  assert.equal(value.has_password, false);
});
