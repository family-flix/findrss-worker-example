import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";
import { fetch_install_script } from "../server/infra/script_install.js";
import api from "../api.js";

register("./support/quickjs_wasm_hook.js", import.meta.url);
const { ServiceScript } = await import("../server/service/durable_object/scripts.js");
const { route } = await import("../durable_object_router.js");
const source = `export const permissions = { cookies: [{ id: "session", origin: "https://example.com", names: ["SID"], path_prefix: "/", purpose: "读取订阅内容" }] };
export const route = { path: "/install/:id", name: "安装测试", example: "/install/1", handler() { throw new Error("不能执行 handler"); } };`;

test("安装预览只解析元数据与权限，不保存或执行 handler；拒绝空白、错误和超限输入", async () => {
  const service = new ServiceScript({ repo: {}, ports: {}, app: {} });
  const preview = input => route(new Request("https://internal/_admin/scripts/install-preview", {
    method: "POST", body: JSON.stringify({ input }),
  }), { scripts: service });
  const response = await preview(source);
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.script, source);
  assert.equal(result.source_url, "");
  assert.equal(result.metadata.name, "安装测试");
  assert.equal(result.metadata.routes[0].example, "/install/1");
  assert.equal(result.metadata.permissions.cookies[0].purpose, "读取订阅内容");
  for (const input of [null, [], "", "  ", "invalid javascript", "file:///tmp/source.js"]) {
    assert.equal((await preview(input)).status, 400);
  }
  assert.equal((await preview("中".repeat(44000))).status, 413);
  const invalid = await route(new Request("https://internal/_admin/scripts/install-preview", { method: "POST", body: "{" }), { scripts: service });
  assert.equal(invalid.status, 400);
});

test("安装下载逐跳检查公网 URL，不携带管理员凭据，保留真实源码", async () => {
  const calls = [];
  const result = await fetch_install_script("https://example.com/start", async (url, options) => {
    calls.push({ url, options });
    return calls.length === 1 ? new Response(null, { status: 302, headers: { Location: "/source.js" } }) : new Response(source);
  });
  assert.equal(result.script, source);
  assert.equal(result.source_url, "https://example.com/source.js");
  assert.equal(calls[0].options.redirect, "manual");
  assert.equal(calls[0].options.headers.Authorization, undefined);
  assert.equal(calls[0].options.headers.Cookie, undefined);
  for (const url of ["http://127.0.0.1/script.js", "http://169.254.169.254/", "https://user:pass@example.com/a", "https://metadata.google.internal/", "https://example.com:8080/a", "file:///tmp/script.js"]) {
    let called = false;
    await assert.rejects(fetch_install_script(url, async () => { called = true; }), /公网/);
    assert.equal(called, false);
    await assert.rejects(fetch_install_script("https://example.com/start", async () => new Response(null, { status: 302, headers: { Location: url } })), /公网/);
  }
});

test("下载失败、HTML、空正文、重定向过多及声明/流式字节超限均不能安装", async () => {
  for (const [response, message] of [
    [() => new Response("missing", { status: 404 }), /HTTP 404/],
    [() => new Response("<!doctype html><html>页面</html>"), /HTML/],
    [() => new Response("  "), /为空/],
    [() => new Response(null), /为空/],
    [() => new Response("small", { headers: { "Content-Length": 131073 } }), /128KB/],
    [() => new Response("中".repeat(44000)), /128KB/],
    [() => new Response(null, { status: 302, headers: { Location: "/loop" } }), /重定向/],
  ]) await assert.rejects(fetch_install_script("https://example.com/source.js", async () => response()), message);
});

test("URL 安装预览返回下载源码和解析结果；外层接口要求管理员权限", async t => {
  const original_fetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = original_fetch; });
  globalThis.fetch = async () => new Response(source);
  const service = new ServiceScript({ repo: {}, ports: {}, app: {} });
  let calls = 0;
  const env = { ADMIN_PASSWORD: "test-admin", API: { getByName: () => ({ fetch(request) {
    calls++;
    assert.equal(new URL(request.url).pathname, "/_admin/scripts/install-preview");
    return route(request, { scripts: service });
  } }) } };
  const request = authorized => new Request("https://feeds.example/admin/api/scripts/install-preview", {
    method: "POST", headers: authorized ? { Authorization: "Bearer test-admin" } : {},
    body: JSON.stringify({ input: "https://example.com/script.js" }),
  });
  assert.equal((await api.fetch(request(false), env)).status, 401);
  assert.equal(calls, 0);
  const response = await api.fetch(request(true), env);
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.script, source);
  assert.equal(result.source_url, "https://example.com/script.js");
  assert.equal(result.metadata.permissions.cookies.length, 1);
});
