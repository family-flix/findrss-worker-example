import assert from "node:assert/strict";
import test from "node:test";

import {
  generate_password_salt,
  generate_reader_verification_code,
  hash_reader_verification_code,
  hash_reader_password,
  sign_reader_session,
  verify_reader_password,
  verify_reader_session,
} from "../server/infra/reader_auth.js";

test("密码使用随机盐派生并可安全校验", async () => {
  const salt = generate_password_salt();
  const password_hash = await hash_reader_password("correct horse", salt);
  assert.equal(await verify_reader_password("correct horse", salt, password_hash), true);
  assert.equal(await verify_reader_password("wrong password", salt, password_hash), false);
});

test("邮箱验证码为六位随机数字，并通过服务端密钥绑定到用户", async () => {
  const code = generate_reader_verification_code();
  assert.match(code, /^\d{6}$/);
  const hash = await hash_reader_verification_code("api-secret", "user-1", code);
  assert.equal(await hash_reader_verification_code("api-secret", "user-1", code), hash);
  assert.notEqual(await hash_reader_verification_code("other-secret", "user-1", code), hash);
  assert.notEqual(await hash_reader_verification_code("api-secret", "user-2", code), hash);
});

test("reader session 可验证并拒绝篡改或过期票据", async () => {
  const now = Date.UTC(2026, 8, 14);
  const signed = await sign_reader_session(
    "reader-session-secret",
    { user_id: "user-1", access_token_id: "token-1" },
    now,
  );
  assert.deepEqual(await verify_reader_session("reader-session-secret", signed.session, now), {
    user_id: "user-1",
    access_token_id: "token-1",
    expires_at: signed.expires_at,
  });
  assert.equal(
    await verify_reader_session("reader-session-secret", signed.session + "tampered", now),
    null,
  );
  assert.equal(
    await verify_reader_session("reader-session-secret", signed.session, signed.expires_at),
    null,
  );
});
