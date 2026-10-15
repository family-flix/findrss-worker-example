import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";
import { feed_problem } from "../server/lib/feed_error.js";
import { RssRouteCache } from "../server/infra/rss_cache.js";
register("./support/quickjs_wasm_hook.js", import.meta.url);
const { ServiceScript } = await import("../server/service/durable_object/scripts.js");
const { route } = await import("../durable_object_router.js");

function setup(handler, { public_source = false, debug = false } = {}) {
  const row = { route: "probe", path: "/probe", enabled: 1,
    script: `export const route = { async handler(ctx) { ${handler} } };`,
    metadata_json: JSON.stringify({ path: "/probe", name: "probe", debug }) };
  const cache = new RssRouteCache(60000, 100);
  const logs = [];
  const service = new ServiceScript({ repo: {
    scripts: { list_enabled: () => [row] }, rss_cookies: { get: () => [] },
  }, ports: { route_cache: cache }, app: {} });
  service.rss_address_is_public = () => public_source;
  service.record_log = log => logs.push(log);
  return { service, cache, logs };
}
const request = (format, authenticated = true) => new Request(`https://internal/_public/feed/${format}/probe`, { headers: {
  Accept: "application/rss+xml, application/atom+xml", "X-Api-Access-Token-ID": authenticated ? "test-user" : "",
} });

test("RSS/Atom 受控错误穿过 QuickJS，Debug 开启也给阅读器返回 Problem Details", async () => {
  const { service, cache, logs } = setup('return ctx.fail("UPSTREAM_AUTH_REQUIRED", "请联系源管理员更新微博 Cookie");', { debug: true });
  for (const format of ["rss", "atom"]) {
    const response = await route(request(format), { scripts: service });
    assert.equal(response.status, 502);
    assert.equal(response.headers.get("Content-Type"), "application/problem+json");
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    const body = await response.json();
    assert.equal(body.code, "UPSTREAM_AUTH_REQUIRED");
    assert.equal(body.error, "请联系源管理员更新微博 Cookie");
    assert.equal(Object.hasOwn(body, "detail"), false);
    assert.equal(body.status, response.status);
    assert.equal(body.rss_debug.phase, "runtime");
    assert.match(body.rss_debug.error_text, /script-source/);
    assert.equal(body.stack, undefined);
  }
  assert.equal(cache.stats().entries, 0);
  assert.match(logs[0].error_text, /script-source/);
});

test("参数错误和独立示例的 FeedError 契约均保留状态码", async () => {
  for (const handler of ['return ctx.fail("INVALID_PARAMETER", "UID 必须为数字");', 'throw Object.assign(new Error("UID 必须为数字"), {name: "FeedError", code: "INVALID_PARAMETER"});']) {
    const { service } = setup(handler);
    const response = await route(request("rss"), { scripts: service });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, "INVALID_PARAMETER");
  }
});

test("普通异常和未知错误码不公开内部信息，缺 token 返回认证挑战", async () => {
  for (const handler of ['throw new Error("private fixture secret");', 'return ctx.fail("UNKNOWN_CODE", "private fixture secret");']) {
    const { service } = setup(handler);
    const response = await route(request("rss"), { scripts: service });
    assert.equal(response.status, 502);
    assert.doesNotMatch(await response.text(), /private fixture secret/);
  }
  const { service, logs } = setup('throw new Error("must not execute");', { public_source: false });
  const response = await route(request("rss", false), { scripts: service });
  assert.equal(response.status, 401);
  assert.equal(response.headers.get("WWW-Authenticate"), 'Bearer realm="FindRSS"');
  const body = await response.json();
  assert.equal(body.code, "FEED_AUTH_REQUIRED");
  assert.match(body.error, /订阅源需要有效访问凭证/);
  assert.equal(Object.hasOwn(body, "detail"), false);
  assert.equal(logs.length, 0);
});

test("公开错误文案有界且不能用原型键伪造错误代码", () => {
  assert.equal(feed_problem("toString", "x"), null);
  assert.equal(feed_problem("INVALID_PARAMETER", 42), null);
  assert.equal(feed_problem("INVALID_PARAMETER", "x".repeat(2000)).error.length, 1000);
});
