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
