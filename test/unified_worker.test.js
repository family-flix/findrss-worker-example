import assert from "node:assert/strict";
import test from "node:test";
import { create_worker } from "../router.js";
import { handle_admin_request as admin } from "../admin.js";

function fixture() {
  const calls = [];
  const api = { fetch: async request => { calls.push(new URL(request.url).pathname); return Response.json({ ok: true }); } };
  const worker = create_worker({ api, admin, discovery: (request, env, api_fetch) => {
    const path = new URL(request.url).pathname;
    if (path === "/api/sources") return api_fetch("https://api/discovery/sources");
    return env.ASSETS.fetch(request);
  } });
  const env = { ADMIN_PASSWORD: "admin-secret", ASSETS: { fetch: request => {
    const path = new URL(request.url).pathname;
    return new Response(path, { status: path.startsWith("/admin/") && !path.includes(".") ? 404 : 200 });
  } } };
  return { worker, env, calls };
}

test("广场与管理后台共享静态绑定，管理 SPA 深链接留在 /admin/", async () => {
  const { worker, env } = fixture();
  for (const [path, asset] of [["/", "/index.html"], ["/admin/discovery", "/admin/index.html"], ["/admin/settings", "/admin/index.html"], ["/admin/settings/models", "/admin/index.html"], ["/admin/style.css", "/admin/style.css"]]) {
    assert.equal(await (await worker.fetch(new Request("https://feeds.example" + path), env)).text(), asset);
  }
  const redirect = await worker.fetch(new Request("https://feeds.example/admin"), env);
  assert.equal(redirect.headers.get("Location"), "https://feeds.example/admin/");
});

test("管理 API 保留会话保护，内部转发才注入 secret；Bearer 调用继续直达 API", async () => {
  const { worker, env, calls } = fixture();
  const request = path => new Request("https://feeds.example" + path);
  assert.equal((await worker.fetch(request("/admin/api/overview"), env)).status, 401);
  assert.deepEqual(calls, []);
  const login = await worker.fetch(new Request("https://feeds.example/admin/auth/login", { method: "POST", body: JSON.stringify({ password: env.ADMIN_PASSWORD }) }), env);
  const Cookie = login.headers.get("Set-Cookie").split(";")[0];
  assert.equal((await worker.fetch(new Request("https://feeds.example/admin/api/overview", { headers: { Cookie } }), env)).status, 200);
  await worker.fetch(new Request("https://feeds.example/admin/api/overview", { headers: { Authorization: "Bearer admin-secret" } }), env);
  assert.deepEqual(calls, ["/admin/api/overview", "/admin/api/overview"]);
});

test("管理 API 同步异常及异步拒绝均返回 JSON 500，覆盖会话与 Bearer 入口", async t => {
  const failure = new Error("backend initialization failed: private details");
  const log = t.mock.method(console, "error", () => {});
  const { env } = fixture();
  const api = { fetch() { throw failure; } };
  const worker = create_worker({ api, admin });
  const login = await worker.fetch(new Request("https://feeds.example/admin/auth/login", {
    method: "POST", body: JSON.stringify({ password: env.ADMIN_PASSWORD }),
  }), env);
  const Cookie = login.headers.get("Set-Cookie").split(";")[0];
  for (const fetch of [() => { throw failure; }, async () => { throw failure; }]) {
    api.fetch = fetch;
    for (const headers of [{ Cookie }, { Authorization: "Bearer admin-secret" }]) {
      for (const path of ["/admin/api", "/admin/api/overview", "/admin/api/messages/ws"]) {
        const response = await worker.fetch(new Request("https://feeds.example" + path + "?token=private", { headers }), env);
        assert.equal(response.status, 500);
        assert.match(response.headers.get("Content-Type"), /^application\/json/);
        assert.equal(response.headers.get("Cache-Control"), "no-store");
        assert.deepEqual(await response.json(), { error: "internal server error" });
        assert.deepEqual(log.mock.calls.at(-1).arguments, ["Admin API request failed", "GET", path, failure]);
      }
    }
  }
  const unauthorized = await worker.fetch(new Request("https://feeds.example/admin/api/overview"), env);
  assert.equal(unauthorized.status, 401);
  assert.equal(log.mock.callCount(), 12);
});

test("管理员直达 API 的请求体、方法、查询参数及凭证保持完整", async () => {
  const worker = create_worker({ api: { async fetch(request) {
    assert.equal(request.method, "POST");
    assert.equal(new URL(request.url).searchParams.get("mode"), "debug");
    assert.equal(request.headers.get("Authorization"), "Bearer admin-secret");
    assert.deepEqual(await request.json(), { script: "内容" });
    return Response.json({ ok: true });
  } } });
  const response = await worker.fetch(new Request("https://feeds.example/admin/api/scripts?mode=debug", {
    method: "POST", headers: { Authorization: "Bearer admin-secret", "Content-Type": "application/json" },
    body: JSON.stringify({ script: "内容" }),
  }), { ADMIN_PASSWORD: "admin-secret" });
  assert.equal(response.status, 200);
});

test("管理 API 的错误边界覆盖会话处理且保留其他路由的异常", async t => {
  const failure = new Error("session validation failed");
  t.mock.method(console, "error", () => {});
  const worker = create_worker({ admin: async () => { throw failure; } });
  const response = await worker.fetch(new Request("https://feeds.example/admin/api/overview"), {});
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: "internal server error" });
  await assert.rejects(worker.fetch(new Request("https://feeds.example/admin/settings"), {}), error => error === failure);
});

test("公开目录、RSS、设备、账号接口继续调用同一 API，内部 DO 路径不对外公开", async () => {
  const { worker, env, calls } = fixture();
  for (const path of ["/api/sources", "/rss/demo?token=abc", "/api/hot/douyin/hot", "/v1/connect", "/reader/auth/session", "/findrss-logo.png"]) await worker.fetch(new Request("https://feeds.example" + path), env);
  assert.deepEqual(calls, ["/discovery/sources", "/rss/demo", "/api/hot/douyin/hot", "/v1/connect", "/reader/auth/session", "/findrss-logo.png"]);
  assert.equal((await worker.fetch(new Request("https://feeds.example/_internal/users"), env)).status, 404);
});

test("任意已注册图片路径在广场 404 后进入 API，已有页面保持优先", async () => {
  const calls = [];
  const api = { fetch: async request => { calls.push(new URL(request.url).pathname); return new Response("image", { headers: { "Content-Type": "image/png" } }); } };
  const worker = create_worker({ api, admin, discovery: async request => new Response("page", { status: new URL(request.url).pathname === "/known" ? 200 : 404 }) });
  const env = {};
  const result = await worker.fetch(new Request("https://feeds.example/custom-image?url=x"), env);
  assert.equal(result.headers.get("Content-Type"), "image/png");
  assert.equal(await (await worker.fetch(new Request("https://feeds.example/known"), env)).text(), "page");
  await worker.fetch(new Request("https://feeds.example/api/missing"), env);
  assert.deepEqual(calls, ["/custom-image"]);
});

test("未配置订阅源域名时采用访问 origin，显式配置继续优先", async () => {
  const worker = create_worker({ api: { fetch: async (_, env) => new Response(env.FINDRSS_HOSTNAME) }, admin, discovery: {} });
  const request = new Request("https://feeds.example:8443/health");
  assert.equal(await (await worker.fetch(request, {})).text(), "https://feeds.example:8443");
  assert.equal(await (await worker.fetch(request, { FINDRSS_HOSTNAME: "custom.example" })).text(), "custom.example");
});
