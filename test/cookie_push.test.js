import assert from "node:assert/strict";
import test from "node:test";
import { createCipheriv, createHash } from "node:crypto";
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
      { uuid: "device", data: payload, crypto_type: "aes-128-cbc-fixed" },
      "device",
      key_text,
    ),
    data.cookie_data.example,
  );
  await assert.rejects(
    decrypt_cookie_push({ uuid: "wrong", data: payload, crypto_type: "aes-128-cbc-fixed" }, "device", key_text),
    /UUID/,
  );
  await assert.rejects(
    decrypt_cookie_push({ data: payload, crypto_type: "aes-128-cbc-fixed" }, "device", key_text), /uuid/,
  );
  await assert.rejects(
    decrypt_cookie_push({ uuid: "device", data: payload, crypto_type: "aes-128-cbc-fixed" }, "device", "invalid"), /COOKIE_PUSH_KEY/,
  );
  await assert.rejects(
    decrypt_cookie_push({ uuid: "device", data: payload, crypto_type: "aes-128-cbc-fixed" }, "device", "fedcba9876543210"), /解密失败/,
  );
  await assert.rejects(
    decrypt_cookie_push({ uuid: "device", data: "invalid!", crypto_type: "aes-128-cbc-fixed" }, "device", key_text), /解密失败/,
  );
});

test("AES-256-CBC 兼容模式解密 OpenSSL Salted__ 数据，校验格式和凭据", async (context) => {
  // Node WebCrypto 没有 Workers 提供的 MD5 扩展。
  const digest = crypto.subtle.digest.bind(crypto.subtle);
  context.mock.method(crypto.subtle, "digest", async (algorithm, input) =>
    algorithm === "MD5" ? Uint8Array.from(createHash("md5").update(input).digest()).buffer : digest(algorithm, input));
  const key_text = "0123456789abcdef";
  const cookies = [{ name: "sid", value: "中文 session", domain: ".example.com" }];
  for (const salt of [Buffer.from("12345678"), Buffer.from("fedcba98")]) {
    const blocks = [];
    for (let index = 0; index < 3; index++) {
      blocks.push(createHash("md5").update(Buffer.concat([blocks.at(-1) || Buffer.alloc(0), Buffer.from(key_text), salt])).digest());
    }
    const key_iv = Buffer.concat(blocks);
    const cipher = createCipheriv("aes-256-cbc", key_iv.subarray(0, 32), key_iv.subarray(32));
    const encrypted = Buffer.concat([Buffer.from("Salted__"), salt,
      cipher.update(JSON.stringify({ cookie_data: { example: cookies } })), cipher.final()]);
    const body = { uuid: "device", data: encrypted.toString("base64"), crypto_type: "aes-256-cbc" };
    for (const crypto_type of ["aes-256-cbc", "legacy", " AES-256-CBC "]) {
      assert.deepEqual(await decrypt_cookie_push({ ...body, crypto_type }, "device", key_text.toUpperCase()), cookies);
    }
    await assert.rejects(decrypt_cookie_push({ ...body, uuid: "wrong" }, "device", key_text), /UUID/);
    await assert.rejects(decrypt_cookie_push(body, "device", "invalid"), /COOKIE_PUSH_KEY/);
    await assert.rejects(decrypt_cookie_push(body, "device", "fedcba9876543210"), /解密失败/);
    for (const data of ["invalid!", encrypted.subarray(0, 16).toString("base64"),
      encrypted.subarray(0, -1).toString("base64"),
      Buffer.concat([Buffer.from("Invalid_"), encrypted.subarray(8)]).toString("base64")]) {
      await assert.rejects(decrypt_cookie_push({ ...body, data }, "device", key_text), /解密失败/);
    }
  }
});

test("data JSON 字符串支持 Cookie 数组、域名分组及原有内部结构", async () => {
  const cookie = { name: "sid", value: "fixture", domain: ".weibo.com" };
  for (const data of [
    [cookie],
    { ".weibo.com": [cookie] },
    { cookies: [cookie] },
    { cookie_data: { ".weibo.com": [cookie] } },
    { cookies: [cookie], cookie_data: { ".weibo.com": [cookie] } },
  ]) {
    for (const crypto_type of [undefined, "none", " NONE "]) {
      assert.deepEqual(await decrypt_cookie_push({ data: JSON.stringify(data), crypto_type }, "", ""), [cookie]);
    }
  }
  assert.deepEqual(await decrypt_cookie_push({ data: "[]" }, "", ""), []);
});

test("拒绝旧请求字段、非字符串 data、无效 JSON、无效分组和未知加密方式", async () => {
  for (const body of [null, [], {}, { cookies: [] }, { cookie_data: {} }, { encrypted: "payload" },
    ...[null, [], {}, 1, "", " "].map(data => ({ data }))]) {
    await assert.rejects(decrypt_cookie_push(body, "", ""), /data.*字符串/);
  }
  await assert.rejects(decrypt_cookie_push({ data: "{" }, "", ""), /有效 JSON/);
  for (const data of [null, 1, "text", { cookies: null }, { cookie_data: null }, { cookie_data: [] },
    { cookie_data: { example: null } }, { example: null }]) {
    await assert.rejects(decrypt_cookie_push({ data: JSON.stringify(data) }, "", ""), /数组|对象/);
  }
  for (const crypto_type of ["unknown", "", null, 1]) {
    await assert.rejects(decrypt_cookie_push({ data: "[]", crypto_type }, "", ""), /仅支持/);
  }
});
