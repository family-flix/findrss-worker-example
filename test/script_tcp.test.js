import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import { register } from "node:module";
import { ScriptCookieAccess } from "../server/infra/script_cookie_access.js";
import { mock_tcp_http } from "./support/tcp_socket_fixture.js";

register("./support/quickjs_wasm_hook.js", import.meta.url);
const { execute_script } = await import("../server/infra/script_sandbox.js");
const metadata = { path: "/tcp", name: "TCP", example: "/tcp", debug: true };
const permissions = { cookies: [{ id: "account", origin: "https://example.com", path_prefix: "/account/", names: ["session", "XSRF-TOKEN"], purpose: "测试" }] };
function run(url, options = {}, cookies = false, cookie_access, signal) {
  const script = `export const route = { async handler(ctx) {
    const options = ${JSON.stringify(options)};
    ${cookies ? 'const cookie = await ctx.cookies.get("account"); if (cookie.error) return cookie; options.cookies = cookie.data;' : ''}
    const response = await ctx.fetchText(${JSON.stringify(url)}, options);
    if (response.error) return response;
    return { title: response.data, items: [] };
  } };`;
  return execute_script(script, metadata, null, undefined, [], "", cookie_access, signal);
}
beforeEach(t => {
  const fetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = fetch; });
});

test("QuickJS 显式 TCP 传输访问任意站点，默认/显式 fetch 不建立 socket", async t => {
  const tcp = mock_tcp_http(t);
  globalThis.fetch = async () => new Response("网页正文");
  for (const url of ["https://one.example/api?q=secret", "http://two.example/api"]) {
    const result = await run(url, { transport: "tcp" });
    assert.equal(JSON.parse(result.output).title, "网页正文");
    assert.equal(result.upstream_requests[0].transport, "tcp");
    assert.doesNotMatch(JSON.stringify(result.upstream_requests), /secret/);
  }
  assert.equal(tcp.connections.length, 2);
  for (const options of [{}, { transport: "fetch" }]) {
    const result = await run("https://other.example/api", options);
    assert.equal(JSON.parse(result.output).title, "网页正文");
    assert.equal(result.upstream_requests[0].transport, "fetch");
  }
  assert.equal(tcp.connections.length, 2);
  assert.ok(tcp.connections.every(connection => connection.closed));
  for (const transport of [null, false, "grpc", "TCP", 1]) await assert.rejects(run("https://example.com", { transport }), /transport 只支持/);
  assert.equal(tcp.connections.length, 2);
});

test("TCP 复用显式 Cookie 授权、派生头和重定向规则，跨 origin 返回后也不恢复凭证", async t => {
  const tcp = mock_tcp_http(t);
  const access = new ScriptCookieAccess({ permissions, assert_grant() {}, cookies: () => [
    { name: "session", value: "private-session", domain: "example.com", path: "/", secure: true },
    { name: "XSRF-TOKEN", value: "private-xsrf", domain: "example.com", path: "/", secure: true },
    { name: "other", value: "never-send", domain: "example.com", path: "/", secure: true },
  ] });
  globalThis.fetch = async url => url.includes("/start")
    ? new Response(null, { status: 302, headers: { Location: "https://other.example/next" } })
    : url.includes("/next") ? new Response(null, { status: 302, headers: { Location: "https://example.com/account/back" } })
      : new Response("done");
  const result = await run("https://example.com/account/start", {
    transport: "tcp", headers: { Authorization: "Bearer private-auth" }, cookie_headers: { "x-xsrf-token": "XSRF-TOKEN" },
  }, true, access);
  assert.equal(JSON.parse(result.output).title, "done");
  assert.equal(tcp.connections.length, 3);
  assert.match(tcp.requests[0].headers.get("cookie"), /session=private-session/);
  assert.doesNotMatch(tcp.requests[0].headers.get("cookie"), /never-send/);
  assert.equal(tcp.requests[0].headers.get("x-xsrf-token"), "private-xsrf");
  assert.equal(tcp.requests[0].headers.get("authorization"), "Bearer private-auth");
  for (const request of tcp.requests.slice(1)) for (const header of ["cookie", "authorization", "x-xsrf-token"]) {
    assert.equal(request.headers.get(header), null);
  }
  assert.doesNotMatch(JSON.stringify(result.upstream_requests), /private-session|private-xsrf|private-auth|never-send/);
  assert.ok(result.upstream_requests.every(request => request.transport === "tcp"));
  assert.ok(tcp.connections.every(connection => connection.closed));
});

test("TCP 未授权/伪造 Cookie、请求头注入和私网重定向不会发出越界请求", async t => {
  const tcp = mock_tcp_http(t);
  globalThis.fetch = async () => assert.fail("不应发送请求");
  await assert.rejects(run("https://example.com/account/", { transport: "tcp" }, true), /Cookie 权限/);
  await assert.rejects(run("https://example.com/", { transport: "tcp", cookies: { id: "forged" } }), /Cookie 句柄无效/);
  await assert.rejects(run("https://example.com/", { transport: "tcp", headers: { Cookie: "secret" } }), /禁止直接填写 Cookie/);
  await assert.rejects(run("https://example.com/", { transport: "tcp", headers: { Referer: "a\r\nCookie: secret" } }), /请求头值无效/);
  await assert.rejects(run("http://127.0.0.1/", { transport: "tcp" }));
  assert.equal(tcp.connections.length, 0);
  globalThis.fetch = async () => new Response(null, { status: 302, headers: { Location: "http://169.254.169.254/" } });
  await assert.rejects(run("https://example.com/", { transport: "tcp" }));
  assert.equal(tcp.connections.length, 1);
  assert.equal(tcp.connections[0].closed, true);
});

test("TCP HTTP 状态沿用公开错误码，连接失败不回退到 Fetch", async t => {
  const tcp = mock_tcp_http(t);
  for (const [status, code] of [[401, "UPSTREAM_AUTH_REQUIRED"], [403, "UPSTREAM_ACCESS_DENIED"], [429, "UPSTREAM_RATE_LIMITED"], [504, "UPSTREAM_TIMEOUT"]]) {
    globalThis.fetch = async () => new Response("secret error body", { status });
    await assert.rejects(run("https://example.com/", { transport: "tcp" }), error => error.problem?.code === code && !error.message.includes("secret error body"));
  }
  assert.equal(tcp.connections.length, 4);
  globalThis.__testTcpConnect = () => { throw new Error("private upstream detail"); };
  globalThis.fetch = async () => assert.fail("TCP 失败不能自动回退 Fetch");
  await assert.rejects(run("https://example.com/", { transport: "tcp" }), error => error.problem?.code === "UPSTREAM_FETCH_FAILED" && !error.message.includes("private upstream detail"));
});

test("TCP POST 保留请求体，303 转 GET；307 跨 origin 不转发请求体", async t => {
  const tcp = mock_tcp_http(t);
  globalThis.fetch = async url => url.endsWith("/start")
    ? new Response(null, { status: 303, headers: { Location: "/done" } }) : new Response("done");
  await run("https://example.com/start", { transport: "tcp", method: "POST", body: "网页正文", headers: { "Content-Type": "text/plain" } });
  assert.equal(tcp.requests[0].method, "POST");
  assert.equal(tcp.requests[0].body, "网页正文");
  assert.equal(tcp.requests[1].method, "GET");
  assert.equal(tcp.requests[1].headers.has("content-type"), false);
  globalThis.fetch = async () => new Response(null, { status: 307, headers: { Location: "https://other.example/done" } });
  await assert.rejects(run("https://example.com/start", { transport: "tcp", method: "POST", body: "private body" }), /不允许跨 origin 重定向请求体/);
  assert.equal(tcp.connections.length, 3);
});

test("TCP 超时返回 UPSTREAM_TIMEOUT，任务取消关闭连接", async t => {
  let closed = 0;
  const previous = globalThis.__testTcpConnect;
  t.after(() => { globalThis.__testTcpConnect = previous; });
  globalThis.__testTcpConnect = () => ({
    opened: new Promise(() => {}), readable: new ReadableStream(), writable: new WritableStream(),
    async close() { closed++; },
  });
  // Node 不会因 AbortSignal.timeout 的 unref timer 保持测试进程存活。
  const guard = setTimeout(() => assert.fail("TCP 超时未生效"), 2000);
  t.after(() => clearTimeout(guard));
  await assert.rejects(run("https://example.com/", { transport: "tcp", timeout_ms: 10 }), error => error.problem?.code === "UPSTREAM_TIMEOUT");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("task cancelled")), 20);
  t.after(() => clearTimeout(timer));
  await assert.rejects(run("https://example.com/", { transport: "tcp" }, false, null, controller.signal), /task cancelled/);
  assert.equal(closed, 2);
});
