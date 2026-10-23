import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { createCipheriv, createHash } from "node:crypto";
import { register } from "node:module";
import { API_SCHEMA_SQL } from "../server/repository/schema.js";
import { RepositoryCookiePushSettings } from "../server/repository/cookie_push_settings.js";
import { ServiceCookiePushSettings } from "../server/service/durable_object/cookie_push_settings.js";
import { create_script_agent_credentials } from "../server/infra/script_agent_credentials.js";
import { handle_admin_request } from "../admin.js";
import { create_worker } from "../router.js";
register("./support/quickjs_wasm_hook.js", import.meta.url);
const { ServiceScript } = await import("../server/service/durable_object/scripts.js");
const { route } = await import("../durable_object_router.js");
const { default: api } = await import("../api.js");
const worker = create_worker({ api, admin: handle_admin_request });

function fixture(context) {
  const digest = crypto.subtle.digest.bind(crypto.subtle);
  context.mock.method(crypto.subtle, "digest", async (algorithm, input) =>
    algorithm === "MD5" ? Uint8Array.from(createHash("md5").update(input).digest()).buffer : digest(algorithm, input));
  const db = new DatabaseSync(":memory:");
  db.exec(API_SCHEMA_SQL);
  context.after(() => db.close());
  const repo = new RepositoryCookiePushSettings({ sql: { exec(text, ...args) {
    const statement = db.prepare(text);
    if (text.startsWith("SELECT")) return { toArray: () => statement.all(...args) };
    statement.run(...args); return { toArray: () => [] };
  } } });
  const credentials = create_script_agent_credentials("test-admin");
  const settings = new ServiceCookiePushSettings({ repo, credentials });
  let saved;
  const scripts = Object.create(ServiceScript.prototype);
  const app = { cookie_push_settings: settings, scripts };
  scripts.app = app;
  scripts.repo = { rss_cookies: { get: () => saved || [], put: cookies => { saved = cookies; } } };
  scripts.invalidate_routes = () => {};
  const env = { ADMIN_PASSWORD: "test-admin", API: { getByName: () => ({ fetch: request => route(request, app) }) } };
  const send = (method = "GET", body, authorized = true, path = "/admin/api/settings/cookies") => worker.fetch(new Request("https://local" + path, {
    method, headers: authorized ? { Authorization: "Bearer test-admin" } : {},
    ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
  }), env);
  return { repo, settings, credentials, send, fetch: request => worker.fetch(request, env), saved: () => saved };
}

test("统一 Worker 入口通过后台登录会话读取、保存 Cookie 解密设置，不进入静态资源路由", async context => {
  const f = fixture(context);
  const url = "https://local/admin/api/settings/cookies";
  assert.equal((await f.fetch(new Request(url))).status, 401);
  const login = await f.fetch(new Request("https://local/admin/auth/login", {
    method: "POST", body: JSON.stringify({ password: "test-admin" }),
  }));
  assert.equal(login.status, 200);
  const Cookie = login.headers.get("Set-Cookie").split(";")[0];
  const read = () => f.fetch(new Request(url, { headers: { Cookie } }));
  const initial = await read();
  assert.equal(initial.status, 200);
  assert.deepEqual(await initial.json(), { uuid: "", configured: false, updated_at: 0 });
  const saved = await f.fetch(new Request(url, {
    method: "PUT", headers: { Cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ uuid: "123", password: "secret" }),
  }));
  assert.equal(saved.status, 200);
  const settings = await saved.json();
  assert.equal(settings.configured, true);
  assert.equal(settings.uuid, "123");
  assert.deepEqual(await (await read()).json(), settings);
});

test("后台 Cookie 解密设置鉴权、派生加密保存、不回显秘密，保存后立即用于两种推送模式", async context => {
  const f = fixture(context);
  assert.equal((await f.send("GET", undefined, false)).status, 401);
  assert.equal((await f.send("PUT", { uuid: "123", password: "secret" }, false)).status, 401);
  assert.equal(f.repo.get(), undefined);
  assert.deepEqual(await (await f.send()).json(), { uuid: "", configured: false, updated_at: 0 });
  const password = " 密码 with spaces ";
  const response = await f.send("PUT", { uuid: " 123 ", password });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("Cache-Control"), /no-store/);
  const public_settings = await response.json();
  assert.equal(public_settings.uuid, "123");
  assert.equal(public_settings.configured, true);
  const key = createHash("md5").update("123-" + password).digest("hex").slice(0, 16);
  assert.equal(await f.credentials.decrypt(f.repo.get().encrypted_key), key);
  assert.doesNotMatch(JSON.stringify(f.repo.get()), /密码 with spaces/);
  assert.equal(f.repo.get().encrypted_key.includes(key), false);
  assert.deepEqual(Object.keys(public_settings).sort(), ["configured", "updated_at", "uuid"]);
  assert.deepEqual(await (await f.send()).json(), public_settings);
  const cookies = [{ name: "sid", value: "saved", domain: ".example.com" }];
  for (const crypto_type of ["aes-128-cbc-fixed", "aes-256-cbc", "legacy"]) {
    const salt = Buffer.from("12345678");
    const blocks = [];
    for (let index = 0; index < 3; index++) blocks.push(createHash("md5").update(Buffer.concat([blocks.at(-1) || Buffer.alloc(0), Buffer.from(key), salt])).digest());
    const key_iv = Buffer.concat(blocks);
    const fixed = crypto_type === "aes-128-cbc-fixed";
    const cipher = createCipheriv(fixed ? "aes-128-cbc" : "aes-256-cbc", fixed ? Buffer.from(key) : key_iv.subarray(0, 32), fixed ? Buffer.alloc(16) : key_iv.subarray(32));
    const ciphertext = Buffer.concat([...(fixed ? [] : [Buffer.from("Salted__"), salt]), cipher.update(JSON.stringify(cookies)), cipher.final()]);
    const result = await f.send("POST", { uuid: "123", crypto_type, data: ciphertext.toString("base64") }, true, "/api/cookies/update");
    assert.equal(result.status, 200, JSON.stringify(await result.json()));
    assert.equal(f.saved()[0].value, "saved");
  }
  const retained = f.repo.get().encrypted_key;
  assert.equal((await f.send("PUT", { uuid: "123", password: "" })).status, 200);
  assert.equal(f.repo.get().encrypted_key, retained);
  assert.equal((await f.send("PUT", { uuid: "changed", password: "" })).status, 400);
  assert.equal(f.repo.get().uuid, "123");
  assert.equal((await f.send("PUT", { uuid: "changed", password: "new" })).status, 200);
  assert.equal((await (await f.send()).json()).uuid, "changed");
});

test("配置校验失败不写入，明文无需配置，旧环境配置仅迁移一次，密钥丢失可重新配置", async context => {
  const f = fixture(context);
  for (const body of ["{", "null", "[]", {}, { uuid: "123" }, { uuid: "" }, { uuid: 123 },
    { uuid: "x".repeat(257), password: "x" }, { uuid: "123", password: 1 }, { uuid: "123", password: "x".repeat(4097) }]) {
    assert.equal((await f.send("PUT", body)).status, 400);
    assert.equal(f.repo.get(), undefined);
  }
  assert.equal((await f.send("PUT", "x".repeat(16385))).status, 413);
  assert.deepEqual(await f.settings.decrypt({ data: "[]" }), []);
  await assert.rejects(f.settings.decrypt({ uuid: "123", data: "ciphertext", crypto_type: "aes-128-cbc-fixed" }), /后台设置/);
  await f.settings.import_legacy("123", "invalid");
  assert.equal(f.repo.get(), undefined);
  await f.settings.import_legacy("123", "0123456789ABCDEF");
  assert.equal(await f.credentials.decrypt(f.repo.get().encrypted_key), "0123456789abcdef");
  const retained = f.repo.get().encrypted_key;
  await f.settings.import_legacy("other", "fedcba9876543210");
  assert.equal(f.repo.get().encrypted_key, retained);
  const restarted = new ServiceCookiePushSettings({ repo: f.repo, credentials: create_script_agent_credentials("different-admin") });
  assert.equal(restarted.settings().uuid, "123");
  await assert.rejects(restarted.decrypt({ uuid: "123", data: "ciphertext", crypto_type: "aes-128-cbc-fixed" }), /重新填写密码/);
  await restarted.save_settings({ uuid: "123", password: "new" });
  assert.equal(restarted.settings().configured, true);
});
