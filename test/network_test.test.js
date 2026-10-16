import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";
import { admin_network_test } from "../server/service/worker/network_test.js";
import { handle_admin_request } from "../admin.js";
import { create_worker } from "../router.js";

register("./support/quickjs_wasm_hook.js", import.meta.url);
const { default: api } = await import("../api.js");
const env = { ADMIN_PASSWORD: "test-admin", API: { getByName() { assert.fail("网络测试不经过 DO"); } } };
const request = (body = {}, options = {}) => new Request("https://app.example/admin/api/network-test", {
  method: "POST", headers: { Authorization: "Bearer test-admin" },
  body: JSON.stringify({ url: "https://example.com/", ...body }), ...options,
});

test("网络测试经过管理员鉴权，后台会话和管理员 Token 均不转发给目标网站", async t => {
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(url, "https://example.com/");
    assert.equal(options.method, "GET");
    assert.equal(options.redirect, "manual");
    const headers = new Headers(options.headers);
    assert.equal(headers.has("authorization"), false);
    assert.equal(headers.has("cookie"), false);
    return new Response("<script>alert(1)</script>", { status: 403, headers: { "X-Test": "upstream" } });
  });
  assert.equal((await api.fetch(request({}, { headers: {} }), env)).status, 401);
  assert.equal((await api.fetch(request({}, { method: "GET", body: undefined }), env)).status, 405);
  const worker = create_worker({ api, admin: handle_admin_request });
  const login = await worker.fetch(new Request("https://app.example/admin/auth/login", {
    method: "POST", body: JSON.stringify({ password: "test-admin" }),
  }), env);
  const cookie = login.headers.get("Set-Cookie").split(";")[0];
  const response = await worker.fetch(request({}, { headers: { Cookie: cookie } }), env);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  const value = await response.json();
  assert.equal(value.status, 403);
  assert.equal(value.headers["x-test"], "upstream");
  assert.equal(value.body, "<script>alert(1)</script>");
  assert.equal(value.error, "");
  assert.equal(value.requests.length, 1);
  assert.ok(value.elapsed_ms >= value.headers_ms);
});

test("网络测试在出网前校验地址、请求头、超时和请求体", async t => {
  t.mock.method(globalThis, "fetch", () => assert.fail("无效请求不得出网"));
  for (const url of ["file:///etc/passwd", "http://localhost/", "http://127.1/", "http://10.0.0.1/",
    "http://169.254.169.254/", "https://metadata.google.internal/", "http://[::1]/", "https://example.com:8080/", "https://user:pass@example.com/"]) {
    assert.equal((await admin_network_test(request({ url }))).status, 400, url);
  }
  for (const body of [{ timeout_ms: 0 }, { timeout_ms: 60001 }, { timeout_ms: "1000" }, { timeout_ms: 1000.5 },
    { headers: [] }, { headers: null }, { headers: { Host: "other.example" } }, { headers: { Referer: "x\r\nCookie: secret" } },
    { headers: { Accept: 1 } }]) {
    assert.equal((await admin_network_test(request(body))).status, 400, JSON.stringify(body));
  }
  for (const body of ["null", "[]", "invalid"]) {
    assert.equal((await admin_network_test(request({}, { body }))).status, 400);
  }
  assert.equal((await admin_network_test(request({ padding: "x".repeat(32768) }))).status, 413);
});

test("逐跳记录重定向，跨域删除凭证，返回原域也不恢复", async t => {
  const seen = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    seen.push(new Headers(options.headers));
    if (seen.length === 1) return new Response(null, { status: 302, headers: { Location: "/same" } });
    if (seen.length === 2) return new Response(null, { status: 307, headers: { Location: "https://other.example/next" } });
    if (seen.length === 3) return new Response(null, { status: 301, headers: { Location: "https://example.com/back" } });
    return new Response("正文");
  });
  const value = await (await admin_network_test(request({ headers: {
    "User-Agent": "test-agent", Referer: "https://example.com/", Cookie: "explicit-cookie", Authorization: "Bearer explicit-token",
  } }))).json();
  assert.deepEqual(value.requests.map(entry => entry.status), [302, 307, 301, 200]);
  assert.equal(value.body, "正文");
  assert.equal(value.url, "https://example.com/back");
  assert.equal(seen[0].get("cookie"), "explicit-cookie");
  assert.equal(seen[1].get("authorization"), "Bearer explicit-token");
  for (const headers of seen.slice(2)) {
    assert.equal(headers.has("cookie"), false);
    assert.equal(headers.has("authorization"), false);
    assert.equal(headers.get("user-agent"), "test-agent");
  }
});

test("重定向目标也必须通过公网校验，并且有跳数限制", async t => {
  for (const location of ["http://127.0.0.1/secret", "javascript:alert(1)", "https://example.com/loop", ""]) {
    let calls = 0;
    t.mock.method(globalThis, "fetch", async () => {
      calls++;
      return new Response(null, { status: 302, headers: location ? { Location: location } : {} });
    });
    const value = await (await admin_network_test(request())).json();
    assert.ok(value.error);
    assert.equal(value.status, 302);
    assert.equal(calls, location.endsWith("/loop") ? 6 : 1);
  }
});

test("正文以字节限制预览，超限取消流；GBK 响应仍能解码", async t => {
  let cancelled = false;
  t.mock.method(globalThis, "fetch", async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(65537).fill(65)); },
    cancel() { cancelled = true; },
  })));
  const value = await (await admin_network_test(request())).json();
  assert.equal(value.truncated, true);
  assert.equal(value.body_bytes, 65536);
  assert.equal(value.body, "A".repeat(65536));
  assert.equal(cancelled, true);
  t.mock.method(globalThis, "fetch", async () => new Response(new Uint8Array([0xd6, 0xd0, 0xce, 0xc4]), { headers: { "Content-Type": "text/html; charset=gbk" } }));
  assert.equal((await (await admin_network_test(request())).json()).body, "中文");
});

test("连接失败、收到响应头前超时以及读取正文超时保留各阶段诊断", async t => {
  t.mock.method(globalThis, "fetch", async () => { throw new Error("connection reset"); });
  const failed = await (await admin_network_test(request())).json();
  assert.equal(failed.code, "UPSTREAM_FETCH_FAILED");
  assert.equal(failed.requests[0].status, null);
  assert.match(failed.error, /connection reset/);
  t.mock.method(AbortSignal, "timeout", ms => {
    assert.equal(ms, 1000);
    return AbortSignal.abort(new DOMException("timeout", "TimeoutError"));
  });
  t.mock.method(globalThis, "fetch", async (_, { signal }) => { throw signal.reason; });
  const timeout = await (await admin_network_test(request({ timeout_ms: 1000 }))).json();
  assert.equal(timeout.code, "UPSTREAM_TIMEOUT");
  assert.equal(timeout.headers_ms, null);
  t.mock.method(globalThis, "fetch", async () => new Response(new ReadableStream({
    start(controller) { controller.error(new Error("body timeout")); },
  })));
  const body_timeout = await (await admin_network_test(request({ timeout_ms: 1000 }))).json();
  assert.equal(body_timeout.code, "UPSTREAM_TIMEOUT");
  assert.equal(body_timeout.status, 200);
  assert.equal(body_timeout.requests[0].status, 200);
  assert.notEqual(body_timeout.headers_ms, null);
});
