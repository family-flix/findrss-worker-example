import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";

register("./support/quickjs_wasm_hook.js", import.meta.url);
const { default: api } = await import("../api.js");

test("阅读端账号、积分和事件接口已移除，内部路由仍不对外开放", async () => {
  const calls = [];
  const env = { API: { getByName: () => ({ fetch(request) {
    calls.push(new URL(request.url).pathname);
    return Response.json({ error: "not found" }, { status: 404 });
  } }) } };
  const routes = [
    ["/reader/auth/login", "POST"],
    ["/reader/auth/register", "POST"],
    ["/reader/auth/verify-email", "POST"],
    ["/reader/auth/resend-verification", "POST"],
    ["/reader/auth/session", "GET"],
    ["/reader/credits", "GET"],
    ["/reader/credits-history", "GET"],
    ["/reader/events", "GET"],
    ["/reader/events", "POST"],
    ["/reader/redeem", "POST"],
    ["/v1/_reader/credits", "GET"],
  ];
  for (const [path, method] of routes) {
    const response = await api.fetch(new Request("https://feeds.example" + path, { method }), env);
    assert.equal(response.status, 404, method + " " + path);
  }
  assert.ok(calls.every(path => path.startsWith("/_public/feed/raw/reader/")));
  assert.equal((await api.fetch(new Request("https://feeds.example/health"), env)).status, 200);
});

test("按源批量查询后台任务校验管理员身份并保留查询参数", async () => {
  const calls = [];
  const env = { ADMIN_PASSWORD: "test-secret", API: { getByName: () => ({ fetch(request) {
    calls.push(new URL(request.url));
    return Response.json({ tasks: [] });
  } }) } };
  const request = new Request("https://feeds.example/admin/api/background-tasks?source_ids=one%2Ctwo");
  assert.equal((await api.fetch(request, env)).status, 401);
  assert.equal(calls.length, 0);
  assert.equal((await api.fetch(new Request(request, { headers: { Authorization: "Bearer test-secret" } }), env)).status, 200);
  assert.equal(calls[0].pathname, "/_admin/background-tasks");
  assert.equal(calls[0].searchParams.get("source_ids"), "one,two");
});

test("后台任务列表、清理和终止接口要求管理员身份，并将方法转发给 DO", async () => {
  const calls = [];
  const env = { ADMIN_PASSWORD: "test-secret", API: { getByName: () => ({ fetch(request) {
    calls.push([new URL(request.url).pathname, request.method]);
    return Response.json({ tasks: [] });
  } }) } };
  const routes = [["/admin/api/background-tasks", "GET"], ["/admin/api/background-tasks", "DELETE"], ["/admin/api/background-tasks/one/cancel", "POST"]];
  for (const [index, [path, method]] of routes.entries()) {
    const request = new Request("https://feeds.example" + path, { method });
    assert.equal((await api.fetch(request, env)).status, 401);
    assert.equal(calls.length, index);
    assert.equal((await api.fetch(new Request(request, { headers: { Authorization: "Bearer test-secret" } }), env)).status, 200);
  }
  assert.deepEqual(calls, [["/_admin/background-tasks", "GET"], ["/_admin/background-tasks", "DELETE"], ["/_admin/background-tasks/one/cancel", "POST"]]);
});

test("逾期补抓接口只允许管理员 POST，并向 DO 转发公开地址", async () => {
  const calls = [];
  const env = { ADMIN_PASSWORD: "test-secret", API: { getByName: () => ({ fetch(request) {
    calls.push(request);
    return Response.json({ matched_count: 3, queued_count: 2, skipped_count: 1 }, { status: 202 });
  } }) } };
  const url = "https://feeds.example/admin/api/discovery/sources/recover-overdue";
  assert.equal((await api.fetch(new Request(url, { method: "POST" }), env)).status, 401);
  const headers = { Authorization: "Bearer test-secret" };
  for (const method of ["GET", "PATCH", "DELETE"]) {
    assert.equal((await api.fetch(new Request(url, { method, headers }), env)).status, 405);
  }
  assert.equal(calls.length, 0);
  const response = await api.fetch(new Request(url, { method: "POST", headers }), env);
  assert.equal(response.status, 202);
  assert.equal((await response.json()).queued_count, 2);
  assert.equal(new URL(calls[0].url).pathname, "/_admin/discovery/sources/recover-overdue");
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].headers.get("X-Feed-Public-URL"), "https://feeds.example");
});
