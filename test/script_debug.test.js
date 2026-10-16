import { result_fixture_source } from "./support/result_fixture.js";
import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";
import { RssRouteCache } from "../server/infra/rss_cache.js";
import { admin_discovery_preview } from "../server/service/worker/discovery.js";
import worker_router from "../api.js";
import { create_worker } from "../router.js";
import { readFile } from "node:fs/promises";
register("./support/quickjs_wasm_hook.js", import.meta.url);
const { ServiceScript } = await import("../server/service/durable_object/scripts.js");
const { ScriptInvokeError } = await import("../server/infra/script_sandbox.js");
const { route } = await import("../durable_object_router.js");

function script(handler = 'ctx.log("开始执行"); throw new Error("boom <script>alert(1)</script>");') {
  return `export const route = { path: "/sample/:uid", name: "调试脚本", url: "example.com", maintainers: [],
    example: "/sample/123", parameters: {uid: "UID"}, description: "", debug: true, handler(ctx) { ${handler} } };`;
}
function setup(debug = false, source = script()) {
  let row = { route: "debug-script", path: "/sample/:uid", enabled: 1, script: source,
    metadata_json: JSON.stringify({ path: "/sample/:uid", name: "调试脚本", debug }) };
  const cache = new RssRouteCache(60000, 100);
  const records = [];
  const service = new ServiceScript({ repo: {
    scripts: { list: () => [], list_enabled: () => [row], find_config: () => row, find: () => row,
      count: () => 0, find_path_owner: () => undefined, find_path_owner_excluding: () => undefined,
      insert: value => { row = value; }, update: value => { row = { ...row, ...value }; } },
    rss_cookies: { get: () => [] },
  }, ports: { route_cache: cache }, app: {} });
  service.rss_address_is_public = () => false;
  service.record_log = record => records.push(record);
  return { service, cache, records, row: () => row };
}
const edit = body => new Request("https://internal/_admin/scripts/debug-script", {
  method: "PATCH", body: JSON.stringify(body),
});
const request = (format = "rss", admin = false, authenticated = true) => new Request(`https://internal/_${admin ? "admin" : "public"}/feed/${format}/sample/123?token=hidden-token&secret=hidden-secret&offset=2`, {
  headers: { Accept: "text/html", "X-Api-Access-Token-ID": authenticated ? "test-user" : "" },
});
const generate = (input, service) => route(input, { scripts: {
  serve_rss_route: (format, pathname, request) => service.serve_rss_route(format, pathname, request, { refresh: true }),
} });

test("页面 Debug 配置独立于代码：默认关闭，开关不改源码，改源码和启停保留开关", async () => {
  const { service, row } = setup();
  const created = await service.create_script(edit({ script: script(), version: "1.0.0" }));
  assert.equal(created.data.script.debug, false);
  const before = row().script;
  assert.equal((await service.update_script(edit({ debug: true }), row().route)).script.debug, true);
  assert.equal(row().script, before);
  assert.equal((await service.update_script(edit({ script: script('throw new Error("changed");'), version: "1.0.1" }), row().route)).script.debug, true);
  assert.equal((await service.update_script(edit({ enabled: false }), row().route)).script.debug, true);
  assert.equal((await service.update_script(edit({ debug: false }), row().route)).script.debug, false);
  await assert.rejects(service.update_script(edit({ debug: "true" }), row().route), error => error.status === 400);
});

test("后台生成 RSS/Atom 的 Debug 错误显示完整堆栈、上下文和日志，转义 HTML 并避免缓存", async () => {
  const { service, cache } = setup(true);
  for (const format of ["rss", "atom"]) {
    const response = await generate(request(format), service);
    assert.equal(response.status, 502);
    assert.match(response.headers.get("Content-Type"), /^text\/html/);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.match(response.headers.get("Content-Security-Policy"), /default-src 'none'/);
    const html = await response.text();
    assert.match(html, /boom &lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.match(html, /script-source\.js|script\.js/);
    assert.match(html, /开始执行/);
    assert.match(html, new RegExp(`/${format}/sample/123`));
    assert.match(html, /runtime/);
    assert.doesNotMatch(html, /<script>|hidden-secret|hidden-token/);
  }
  assert.equal(cache.stats().entries, 0);
});

test("关闭 Debug 保持原有响应，后台 JSON 返回脚本错误描述", async () => {
  const { service } = setup();
  let response = await generate(request(), service);
  assert.equal(response.status, 502);
  assert.equal((await response.json()).code, "SCRIPT_FAILED");
  const enabled = setup(true).service;
  response = await route(request("rss", true), { scripts: enabled });
  assert.match(response.headers.get("Content-Type"), /application\/json/);
  assert.match((await response.json()).error, /boom <script>alert\(1\)<\/script>/);
  service.rss_address_is_public = () => false;
  response = await route(request("rss", false, false), { scripts: service });
  assert.equal(response.status, 401);
  assert.equal((await response.json()).code, "FEED_AUTH_REQUIRED");
});

test("Debug 覆盖脚本执行前的鉴权失败，HTML 与 JSON 均显示上下文但不执行脚本", async () => {
  const { service, cache, records } = setup(true, script('throw new Error("must not execute");'));
  service.rss_address_is_public = () => false;
  for (const accept of ["text/html", "application/rss+xml"]) {
    const input = new Request(request().url, { headers: {
      Accept: accept, "X-RSS-Credential-Sources": "query,unsafe-fixture",
      "X-RSS-Credential-Status": "rejected", "X-RSS-Browser-Credentials": "present",
    } });
    const response = await route(input, { scripts: service });
    assert.equal(response.status, 401);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.equal(response.headers.get("WWW-Authenticate"), 'Bearer realm="FindRSS"');
    if (accept === "text/html") {
      const html = await response.text();
      assert.match(html, /auth|rejected/);
      assert.match(html, /脚本未执行/);
      assert.doesNotMatch(html, /hidden-token|hidden-secret|unsafe-fixture|must not execute/);
    } else {
      const payload = await response.json();
      assert.equal(payload.code, "FEED_AUTH_REQUIRED");
      assert.equal(payload.rss_debug.phase, "auth");
      assert.equal(payload.rss_debug.request.authentication.verification, "rejected");
      assert.deepEqual(payload.rss_debug.request.authentication.credential_sources, ["query"]);
      assert.equal(payload.rss_debug.request.authentication.browser_credentials_received, true);
      assert.deepEqual(payload.rss_debug.upstream_requests, []);
      assert.equal(payload.rss_debug.request.query.secret, "[redacted]");
      assert.match(payload.rss_debug.error_text, /DurableObjectError/);
    }
  }
  assert.equal(cache.stats().executions, 0);
  assert.equal(records.length, 0);
});

test("脚本预览和读取订阅源信息把日志中的错误描述透传到页面，不依赖 Debug 开关", async () => {
  for (const debug of [false, true]) {
    for (const include_feed of [false, true]) {
      const { service, records } = setup(debug, script('throw new Error("小红书笔记缺少有效的 noteId");'));
      const env = { FINDRSS_HOSTNAME: "https://api.example.com", API: { getByName: () => ({ fetch: request => route(request, { scripts: service }) }) } };
      const response = await admin_discovery_preview(env, new Request("https://admin/admin/api/discovery/preview", {
        method: "POST", body: JSON.stringify(include_feed
          ? { feed_url: "/rss/sample/123", include_feed: true, script_id: "debug-script" }
          : { feed_url: "{{hostname}}/rss/sample/123" }),
      }));
      assert.equal(response.status, 502);
      const payload = await response.json();
      assert.equal(payload.error, records[0].message);
      assert.match(payload.error, /脚本执行失败：脚本异常：小红书笔记缺少有效的 noteId/);
    }
  }
});

test("Debug 保留设备错误状态与 Pending 重试头，不把尚未完成的调用记为脚本失败", async () => {
  for (const status of [402, 409, 503, 504]) {
    const { service, records } = setup(true, script('return ctx.invoke("device.method", {});'));
    service.script_invoke = async () => { throw new ScriptInvokeError(status, "设备调用错误"); };
    const response = await generate(request(), service);
    assert.equal(response.status, status === 504 ? 503 : status);
    assert.match(response.headers.get("Content-Type"), /text\/html/);
    assert.match(await response.text(), /invoke/);
    if (status === 504) {
      assert.equal(response.headers.get("X-FindRSS-Pending"), "1");
      assert.ok(Number(response.headers.get("Retry-After")) > 0);
      assert.equal(records.length, 0);
    }
  }
});

test("Debug 开启时成功请求仍返回 RSS/Atom XML", async () => {
  const { service } = setup(true, script('return {title: "成功", items: []};'));
  assert.equal((await generate(request("rss", true), service)).status, 200);
  for (const format of ["rss", "atom"]) {
    const response = await route(request(format), { scripts: service });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("Content-Type"), /xml/);
    assert.match(await response.text(), /成功/);
  }
});

test("/debug 绕过已有缓存，展示上下文、长日志和函数返回值，每次重新执行", async () => {
  const { service, cache } = setup(true, script('ctx.log("原始 HTML", "<html>" + "正文".repeat(4000) + "末尾</html>"); return {title: "成功", items: []};'));
  await generate(request("rss", true), service);
  const before = cache.stats();
  for (let index = 0; index < 2; index++) {
    const response = await route(new Request('https://internal/_public/feed/debug/sample/123?token=hidden-token&secret=hidden-secret', {
      headers: { "X-Api-Access-Token-ID": "test-user" },
    }), { scripts: service });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('Content-Type'), /text\/html/);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    const html = await response.text();
    assert.match(html, /data-n="debug-context-column"/);
    assert.match(html, /data-n="debug-output-content"/);
    assert.match(html, /\/debug\/sample\/123/);
    assert.match(html, /末尾&lt;\/html&gt;/);
    assert.match(html, /&quot;title&quot;:&quot;成功&quot;/);
    assert.doesNotMatch(html, /hidden-token|hidden-secret|\[截断\]/);
  }
  assert.deepEqual(cache.stats(), before);
});

test("/debug 要求启用 Debug，沿用订阅鉴权，失败时即使未声明 Accept 也返回 HTML", async () => {
  const input = new Request('https://internal/_public/feed/debug/sample/123');
  assert.equal((await route(input, { scripts: setup(false).service })).status, 404);
  const { service, cache, records } = setup(true);
  service.rss_address_is_public = () => false;
  let response = await route(input, { scripts: service });
  assert.equal(response.status, 401);
  assert.match(await response.text(), /脚本未执行/);
  assert.equal(records.length, 0);
  assert.equal(cache.stats().executions, 0);
  response = await route(new Request(input, { headers: { 'X-Api-Access-Token-ID': 'account-1' } }), { scripts: service });
  assert.equal(response.status, 502);
  const html = await response.text();
  assert.match(html, /开始执行/);
  assert.match(html, /执行失败，未生成输出/);
  assert.doesNotMatch(html, /<script>/);
});

test("统一 Worker 的 /debug/weibo/:uid 走真实脚本，保留长 HTML、上游诊断与函数输出", async () => {
  const source = (await readFile(new URL('../examples/scripts/weibo.js', import.meta.url), 'utf8')).replace(/cookie_headers:\s*\{[^}]*\},?/g, '');
  const { service, cache, row } = setup(true, result_fixture_source(source));
  service.rss_address_is_public = () => true;
  Object.assign(row(), { path: '/weibo/:uid', metadata_json: JSON.stringify({ path: '/weibo/:uid', name: '微博', debug: true }) });
  const requests = [];
  const original_fetch = globalThis.fetch;
  globalThis.fetch = async url => {
    requests.push(url);
    return new Response('<html>' + '前缀'.repeat(4000) + '原始HTML末尾<script type="application/json">' +
      JSON.stringify({ statuses: [{ idstr: '1', text_raw: '最终微博正文', user: {} }] }) + '</script></html>');
  };
  try {
    const worker = create_worker({ api: worker_router, admin: {}, discovery: {} });
    const env = { API: { getByName: () => ({ fetch: input => route(input, { scripts: service }) }) } };
    for (let index = 0; index < 2; index++) {
      const response = await worker.fetch(new Request('https://feeds.example/debug/weibo/123'), env);
      assert.equal(response.status, 200);
      const html = await response.text();
      assert.match(html, /原始HTML末尾&lt;script/);
      assert.match(html, /最终微博正文/);
      assert.match(html, /&quot;items&quot;:/);
      assert.match(html, /weibo.com|\/u\/123/);
      assert.doesNotMatch(html, /<script>/);
    }
    assert.deepEqual(requests, ['https://weibo.com/u/123', 'https://weibo.com/ajax/profile/info?uid=123&scene=profile',
      'https://weibo.com/u/123', 'https://weibo.com/ajax/profile/info?uid=123&scene=profile']);
    assert.equal(cache.stats().entries, 0);
  } finally { globalThis.fetch = original_fetch; }
});
