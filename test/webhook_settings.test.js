import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";
import { snapshot_store } from "./support/snapshot_store.js";
import { RepositoryWebhookSettings } from "../server/repository/webhook_settings.js";
import { RepositoryScriptLog } from "../server/repository/script_log.js";
import { ServiceWebhookSettings } from "../server/service/durable_object/webhook_settings.js";
import { create_script_agent_credentials } from "../server/infra/script_agent_credentials.js";
import { DEFAULT_WEBHOOK_TEMPLATE } from "../server/lib/webhook_template.js";
import { handle_admin_request } from "../admin.js";
import { create_worker } from "../router.js";
register("./support/quickjs_wasm_hook.js", import.meta.url);
const { route } = await import("../durable_object_router.js");
const { default: api } = await import("../api.js");
const { ServiceScript } = await import("../server/service/durable_object/scripts.js");

function fixture(t) {
  const { db, sql } = snapshot_store();
  t.after(() => db.close());
  const repo = new RepositoryWebhookSettings({ sql });
  const credentials = create_script_agent_credentials("test-admin");
  const webhook_settings = new ServiceWebhookSettings({ repo, credentials });
  const pending = [];
  const scripts = new ServiceScript({ repo: { script_logs: new RepositoryScriptLog({ sql }) },
    app: { webhook_settings }, ports: { wait_until: promise => pending.push(promise) } });
  const worker = create_worker({ api, admin: handle_admin_request });
  const env = { ADMIN_PASSWORD: "test-admin", API: { getByName: () => ({ fetch: request => route(request, { webhook_settings }) }) } };
  const send = (method = "GET", body, authorized = true) => worker.fetch(new Request("https://local/admin/api/settings/webhook", {
    method, headers: authorized ? { Authorization: "Bearer test-admin" } : {},
    ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
  }), env);
  return { db, repo, sql, credentials, webhook_settings, scripts, pending, send,
    fetch: request => worker.fetch(request, env) };
}

test("Webhook 设置经过后台鉴权、会话路由与加密保存，Token 留空保留，URL 留空关闭", async t => {
  const f = fixture(t);
  assert.equal((await f.send("GET", undefined, false)).status, 401);
  assert.equal((await f.send("PUT", {}, false)).status, 401);
  assert.deepEqual(await (await f.send()).json(), {
    url: "", token_configured: false, template: DEFAULT_WEBHOOK_TEMPLATE, updated_at: 0,
  });
  const login = await f.fetch(new Request("https://local/admin/auth/login", {
    method: "POST", body: JSON.stringify({ password: "test-admin" }),
  }));
  const Cookie = login.headers.get("Set-Cookie").split(";")[0];
  const response = await f.fetch(new Request("https://local/admin/api/settings/webhook", {
    method: "PUT", headers: { Cookie }, body: JSON.stringify({ url: " https://notify.example/api ",
      token: "test-token", template: '{"text":"{{error_text}}"}' }),
  }));
  assert.equal(response.status, 200);
  assert.match(response.headers.get("Cache-Control"), /no-store/);
  const value = await response.json();
  assert.equal(value.url, "https://notify.example/api");
  assert.equal(value.token_configured, true);
  assert.doesNotMatch(JSON.stringify(value), /test-token|encrypted_token/);
  assert.doesNotMatch(JSON.stringify(f.repo.get()), /test-token/);
  assert.equal(await f.credentials.decrypt(f.repo.get().encrypted_token), "test-token");
  assert.deepEqual(await (await f.send()).json(), value);
  const encrypted = f.repo.get().encrypted_token;
  assert.equal((await f.send("PUT", { ...value, token: "" })).status, 200);
  assert.equal(f.repo.get().encrypted_token, encrypted);
  assert.equal((await f.send("PUT", { ...value, token: "new-token" })).status, 200);
  assert.equal(await f.credentials.decrypt(f.repo.get().encrypted_token), "new-token");
  assert.equal((await f.send("PUT", { ...value, url: "" })).status, 200);
  assert.equal(f.webhook_settings.settings().url, "");
});

test("Webhook URL、Token 与模板在写入前校验", async t => {
  const f = fixture(t);
  const valid = { url: "https://notify.example/api", token: "secret", template: '{"text":"{{message}}"}' };
  for (const body of ["{", "null", "[]", {}, { ...valid, url: null },
    ...["invalid", "ftp://host/file", "https://user:pass@host/", "https://host/#fragment", "x".repeat(4097)].map(url => ({ ...valid, url })),
    ...[null, 1, "bad\r\nheader", "x".repeat(4097)].map(token => ({ ...valid, token })),
    ...[null, "", "{", "[]", "null", '{"text":"{{unknown}}"}', "x".repeat(8193),
      JSON.stringify({ deep: JSON.parse('['.repeat(22) + '0' + ']'.repeat(22)) })].map(template => ({ ...valid, template })),
  ]) {
    assert.equal((await f.send("PUT", body)).status, 400, JSON.stringify(body).slice(0, 200));
    assert.equal(f.repo.get(), undefined);
  }
  assert.equal((await f.send("PUT", "x".repeat(16385))).status, 413);
});

test("新错误消息以 POST、Bearer Token 和替换后的 JSON 模板发送，保留转义及原有实时推送", async t => {
  const f = fixture(t), requests = [], events = [];
  t.mock.method(globalThis, "fetch", async (url, options) => { requests.push({ url, options }); return new Response("ok"); });
  f.scripts.message_listeners.add(event => events.push(event));
  f.scripts.record_log({ status: "error", message: "尚未配置" });
  assert.equal(requests.length, 0);
  await f.webhook_settings.save_settings({ url: "https://notify.example/api", token: "test-token",
    template: JSON.stringify({ text: "{{script_name}}：{{ message }}\n{{error_text}}", path: "{{path}}", time: "{{created_at}}",
      nested: [{ value: "{{message}}" }], enabled: true }) });
  const error_text = '错误："bad input"\n路径 C:\\test\\file，{{message}}';
  f.scripts.record_log({ status: "ok", message: "成功" });
  f.scripts.record_log({ status: "error", path: "/demo", message: '执行"失败"', error_text, created_at: 123,
    query: { token: "private" } });
  await Promise.all(f.pending);
  assert.equal(requests.length, 1);
  assert.equal(events.length, 2);
  const { url, options } = requests[0];
  assert.equal(url, "https://notify.example/api");
  assert.equal(options.method, "POST");
  assert.equal(options.headers.Authorization, "Bearer test-token");
  assert.equal(options.headers["Content-Type"], "application/json");
  assert.equal(options.redirect, "error");
  assert.ok(options.signal instanceof AbortSignal);
  assert.deepEqual(JSON.parse(options.body), { text: '/demo：执行"失败"\n' + error_text, path: "/demo", time: "123",
    nested: [{ value: '执行"失败"' }], enabled: true });
  assert.doesNotMatch(options.body, /private/);
  await f.scripts.delete_read_messages(new URL("https://internal/_admin/messages?read_id=1"));
  assert.equal(requests.length, 1);
  await f.webhook_settings.save_settings({ url: "", template: '{"text":"{{message}}"}' });
  f.scripts.record_log({ status: "error", message: "已关闭" });
  assert.equal(requests.length, 1);
});

test("Webhook 非 2xx、网络失败及密钥失效均不影响消息落库与实时推送，也不记录令牌", async t => {
  const f = fixture(t), events = [], warnings = [];
  const secret = "private-token";
  await f.webhook_settings.save_settings({ url: "https://notify.example/api?token=" + secret, token: secret, template: '{"text":"{{error_text}}"}' });
  t.mock.method(console, "warn", (...args) => warnings.push(args.join(" ")));
  let fail_network = false;
  t.mock.method(globalThis, "fetch", async () => {
    if (fail_network) throw new Error(secret);
    return new Response("failed", { status: 500 });
  });
  f.scripts.message_listeners.add(event => events.push(event));
  f.scripts.record_log({ status: "error", message: "first" });
  await Promise.all(f.pending);
  fail_network = true;
  f.scripts.record_log({ status: "error", message: "second" });
  await Promise.all(f.pending);
  f.webhook_settings.credentials = create_script_agent_credentials("changed-admin");
  f.scripts.record_log({ status: "error", message: "third" });
  await Promise.all(f.pending);
  assert.equal(events.length, 3);
  assert.equal((await f.scripts.list_messages(new URL("https://internal/_admin/messages"))).messages.length, 3);
  assert.equal(warnings.length, 3);
  assert.doesNotMatch(warnings.join("\n"), new RegExp(secret));
});

test("无 Token 时不附带 Authorization；超时和日志写入失败不阻断原有消息处理", async t => {
  const f = fixture(t), warnings = [], events = [];
  await f.webhook_settings.save_settings({ url: "https://notify.example/api", template: DEFAULT_WEBHOOK_TEMPLATE });
  let calls = 0, fail_timeout = false;
  t.mock.method(console, "warn", (...args) => warnings.push(args));
  t.mock.method(AbortSignal, "timeout", milliseconds => {
    assert.equal(milliseconds, 10000);
    return fail_timeout ? AbortSignal.abort(new DOMException("timeout", "TimeoutError")) : new AbortController().signal;
  });
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls++;
    assert.equal(options.headers.Authorization, undefined);
    options.signal.throwIfAborted();
    assert.equal(JSON.parse(options.body).text, "小讯RSS：未保存的脚本\n失败\n详情");
    return new Response(null, { status: 204 });
  });
  f.scripts.message_listeners.add(event => events.push(event));
  f.scripts.record_log({ status: "error", message: "失败", error_text: "详情" });
  await Promise.all(f.pending);
  fail_timeout = true;
  f.scripts.record_log({ status: "error", message: "超时" });
  await Promise.all(f.pending);
  assert.equal(calls, 2);
  assert.equal(warnings.length, 1);
  assert.equal(events.length, 2);
  t.mock.method(console, "error", () => {});
  t.mock.method(f.scripts.repo.script_logs, "insert", () => { throw new Error("storage failure"); });
  await f.scripts.record_log({ status: "error", message: "写入失败" });
  assert.equal(calls, 3);
  assert.equal(events.length, 3);
});
