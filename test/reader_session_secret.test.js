import assert from "node:assert/strict";
import test from "node:test";

import { reader_session_secret } from "../server/infra/reader_session_secret.js";
import { sign_reader_session, verify_reader_session } from "../server/infra/reader_auth.js";

test("配了 READER_SESSION_SECRET 就用它", () => {
  assert.equal(
    reader_session_secret({ READER_SESSION_SECRET: "new-secret", DEVICE_TOKEN: "old" }),
    "new-secret",
  );
});

test("没配时回退 DEVICE_TOKEN（升级前签发的会话继续有效）", () => {
  assert.equal(reader_session_secret({ DEVICE_TOKEN: "old" }), "old");
  assert.equal(reader_session_secret({ DEVICE_TOKEN: "old", READER_SESSION_SECRET: "" }), "old");
  assert.equal(reader_session_secret({ DEVICE_TOKEN: "old", READER_SESSION_SECRET: undefined }), "old");
  // 只认字符串，别把布尔/对象当成密钥
  assert.equal(reader_session_secret({ DEVICE_TOKEN: "old", READER_SESSION_SECRET: null }), "old");
  assert.equal(reader_session_secret({ DEVICE_TOKEN: "old", READER_SESSION_SECRET: 42 }), "old");
});

test("两个都没有时返回空串，调用方据此拒绝签发", () => {
  assert.equal(reader_session_secret({}), "");
  assert.equal(reader_session_secret({ READER_SESSION_SECRET: "" }), "");
  assert.equal(reader_session_secret(undefined), "");
  assert.equal(reader_session_secret({ DEVICE_TOKEN: 123 }), "");
});

test("新部署只配置 ADMIN_PASSWORD 即可签发会话，旧部署仍优先使用原密钥", () => {
  assert.equal(reader_session_secret({ ADMIN_PASSWORD: "admin" }), "admin");
  assert.equal(reader_session_secret({ DEVICE_TOKEN: "old", ADMIN_PASSWORD: "admin" }), "old");
});

test("回退路径下签名与验签闭环，换到新密钥后旧会话失效", async () => {
  const identity = { user_id: "6f1c5f0a-1111-4222-8333-444455556666", access_token_id: "a71b" };

  // 升级前：只有 DEVICE_TOKEN
  const before = { DEVICE_TOKEN: "device-token" };
  const signed_before = await sign_reader_session(reader_session_secret(before), identity);
  assert.notEqual(
    await verify_reader_session(reader_session_secret(before), signed_before.session),
    null,
  );

  // 只加 secret 不改密钥：新旧部署靠回退互相认得
  const after = { DEVICE_TOKEN: "device-token", READER_SESSION_SECRET: "device-token" };
  assert.notEqual(
    await verify_reader_session(reader_session_secret(after), signed_before.session),
    null,
  );

  // 真正轮换密钥后，旧票据必须失效
  const rotated = { DEVICE_TOKEN: "device-token", READER_SESSION_SECRET: "rotated" };
  assert.equal(
    await verify_reader_session(reader_session_secret(rotated), signed_before.session),
    null,
  );
});
