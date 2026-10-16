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

test("后台任务列表和终止接口要求管理员身份，并将方法转发给 DO", async () => {
  const calls = [];
  const env = { ADMIN_PASSWORD: "test-secret", API: { getByName: () => ({ fetch(request) {
    calls.push([new URL(request.url).pathname, request.method]);
    return Response.json({ tasks: [] });
  } }) } };
  for (const [path, method] of [["/admin/api/background-tasks", "GET"], ["/admin/api/background-tasks/one/cancel", "POST"]]) {
    const request = new Request("https://feeds.example" + path, { method });
    assert.equal((await api.fetch(request, env)).status, 401);
    assert.equal(calls.length, path.endsWith("cancel") ? 1 : 0);
    assert.equal((await api.fetch(new Request(request, { headers: { Authorization: "Bearer test-secret" } }), env)).status, 200);
  }
  assert.deepEqual(calls, [["/_admin/background-tasks", "GET"], ["/_admin/background-tasks/one/cancel", "POST"]]);
});
