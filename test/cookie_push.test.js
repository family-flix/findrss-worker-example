import assert from "node:assert/strict";
import test from "node:test";
import { decrypt_cookie_push } from "../server/infra/cookie_push.js";

test("解密 Cookie aes-128-cbc-fixed 推送", async () => {
  const key_text = "0123456789abcdef";
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(key_text), { name: "AES-CBC" }, false, ["encrypt"],
  );
  const data = { cookie_data: { example: [{ name: "sid", value: "1", domain: "example.com" }] } };
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-CBC", iv: new Uint8Array(16) }, key, new TextEncoder().encode(JSON.stringify(data)),
  );
  const payload = btoa(String.fromCharCode(...new Uint8Array(encrypted)));
  assert.deepEqual(
    await decrypt_cookie_push(
      { uuid: "device", encrypted: payload, crypto_type: "aes-128-cbc-fixed" },
      "device",
      key_text,
    ),
    data.cookie_data.example,
  );
  await assert.rejects(
    decrypt_cookie_push({ uuid: "wrong", encrypted: payload, crypto_type: "aes-128-cbc-fixed" }, "device", key_text),
    /UUID/,
  );
});

test("明文 none 支持 cookies 与分组 cookie_data，同时出现时不重复导入", async () => {
  const cookie = { name: "sid", value: "fixture", domain: ".weibo.com" };
  for (const body of [
    { cookies: [cookie], crypto_type: "none" },
    { cookie_data: { ".weibo.com": [cookie] }, crypto_type: "none" },
    { cookies: [cookie], cookie_data: { ".weibo.com": [cookie] }, crypto_type: "none" },
    { cookies: [cookie] },
  ]) assert.deepEqual(await decrypt_cookie_push(body, "", ""), [cookie]);
  await assert.rejects(decrypt_cookie_push({ cookies: null, crypto_type: "none" }, "", ""), /数组/);
  await assert.rejects(decrypt_cookie_push({ cookie_data: { example: null }, crypto_type: "none" }, "", ""), /数组/);
});
