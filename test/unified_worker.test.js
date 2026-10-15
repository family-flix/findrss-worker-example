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

test("公开目录、RSS、设备、账号接口继续调用同一 API，内部 DO 路径不对外公开", async () => {
  const { worker, env, calls } = fixture();
  for (const path of ["/api/sources", "/rss/demo?token=abc", "/v1/connect", "/reader/auth/session", "/findrss-logo.png"]) await worker.fetch(new Request("https://feeds.example" + path), env);
  assert.deepEqual(calls, ["/discovery/sources", "/rss/demo", "/v1/connect", "/reader/auth/session", "/findrss-logo.png"]);
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
