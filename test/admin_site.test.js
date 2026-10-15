import assert from "node:assert/strict";
import test from "node:test";

import { handle_admin_request } from "../admin.js";
const admin_worker = { fetch: (request, env) => handle_admin_request(request, env, env.API?.fetch.bind(env.API)) };

function create_env() {
  const state = { api_request: null };
  return {
    state,
    env: {
      ADMIN_PASSWORD: "test-admin-password",
      ASSETS: {
        async fetch() {
          return new Response("asset", { status: 200 });
        },
      },
      API: {
        async fetch(request) {
          state.api_request = request;
          return Response.json({ ok: true });
        },
      },
    },
  };
}

test('消息 WS 复用管理员会话，保留 Upgrade，拒绝跨站连接', async () => {
  const { env, state } = create_env();
  const response = await login(env);
  const cookie = response.headers.get('Set-Cookie').split(';')[0];
  const headers = { Cookie: cookie, Upgrade: 'websocket', Origin: 'http://127.0.0.1' };
  assert.equal((await admin_worker.fetch(new Request('http://127.0.0.1/admin/api/messages/ws', { headers }), env)).status, 200);
  assert.equal(state.api_request.headers.get('Upgrade'), 'websocket');
  assert.equal(state.api_request.headers.get('Authorization'), 'Bearer test-admin-password');
  assert.equal(state.api_request.headers.has('Cookie'), false);
  assert.equal((await admin_worker.fetch(new Request('http://127.0.0.1/admin/api/messages/ws', {
    headers: { ...headers, Origin: 'https://other.example' },
  }), env)).status, 403);
});

async function login(env, url = "http://127.0.0.1/admin/auth/login") {
  return admin_worker.fetch(
    new Request(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "test-admin-password" }),
    }),
    env,
  );
}

test("静态登录资源不再触发 HTTP Basic Auth", async () => {
  const { env } = create_env();
  const response = await admin_worker.fetch(new Request("http://127.0.0.1/"), env);
  assert.equal(response.status, 200);
  assert.equal(response.headers.has("WWW-Authenticate"), false);
});

test("直接访问 Token 页面返回后台 SPA 入口", async () => {
  const { env } = create_env();
  let asset_path;
  env.ASSETS.fetch = async request => {
    asset_path = new URL(request.url).pathname;
    return new Response("admin app");
  };
  const response = await admin_worker.fetch(new Request("http://127.0.0.1/admin/tokens"), env);
  assert.equal(response.status, 200);
  assert.equal(asset_path, "/admin/index.html");
});

test("WebSocket 升级请求返回 404 而不是落入静态资源处理", async () => {
  const { env } = create_env();
  let assets_called = false;
  env.ASSETS.fetch = async () => {
    assets_called = true;
    return new Response("asset", { status: 200 });
  };
  const response = await admin_worker.fetch(
    new Request("http://127.0.0.1/v1/connect", {
      headers: { Connection: "Upgrade", Upgrade: "websocket" },
    }),
    env,
  );
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "not found" });
  assert.equal(assets_called, false);
});

test("未登录时管理 API 返回普通 401 JSON", async () => {
  const { env } = create_env();
  const response = await admin_worker.fetch(
    new Request("http://127.0.0.1/admin/api/overview"),
    env,
  );
  assert.equal(response.status, 401);
  assert.equal(response.headers.has("WWW-Authenticate"), false);
  assert.deepEqual(await response.json(), { error: "authentication required" });
});

test("错误密码无法登录", async () => {
  const { env } = create_env();
  const response = await admin_worker.fetch(
    new Request("http://127.0.0.1/admin/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "wrong" }),
    }),
    env,
  );
  assert.equal(response.status, 401);
  assert.equal(response.headers.has("Set-Cookie"), false);
  assert.deepEqual(await response.json(), { error: "密码错误" });
});

test("登录身份固定为 admin，不采用请求中的用户名", async () => {
  const { env } = create_env();
  const response = await admin_worker.fetch(
    new Request("http://127.0.0.1/admin/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "other", password: env.ADMIN_PASSWORD }),
    }),
    env,
  );
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).user, { username: "admin" });
});

test("登录后 Session Cookie 可访问管理 API，Secret 仅由服务端转发", async () => {
  const { env, state } = create_env();
  const login_response = await login(env);
  assert.equal(login_response.status, 200);
  const set_cookie = login_response.headers.get("Set-Cookie") || "";
  assert.match(set_cookie, /^findrss_admin_session=v1\./);
  assert.match(set_cookie, /HttpOnly/);
  assert.match(set_cookie, /SameSite=Strict/);
  assert.doesNotMatch(set_cookie, /Secure/);
  const cookie = set_cookie.split(";", 1)[0];

  const session_response = await admin_worker.fetch(
    new Request("http://127.0.0.1/admin/auth/session", { headers: { Cookie: cookie } }),
    env,
  );
  assert.deepEqual(await session_response.json(), {
    logged_in: true,
    user: { username: "admin" },
  });

  const api_response = await admin_worker.fetch(
    new Request("http://127.0.0.1/admin/api/overview", { headers: { Cookie: cookie } }),
    env,
  );
  assert.equal(api_response.status, 200);
  assert.equal(state.api_request.headers.get("Authorization"), "Bearer test-admin-password");
  assert.equal(state.api_request.headers.has("Cookie"), false);

  const tampered_response = await admin_worker.fetch(
    new Request("http://127.0.0.1/admin/api/overview", {
      headers: { Cookie: cookie + "tampered" },
    }),
    env,
  );
  assert.equal(tampered_response.status, 401);
});

test("生产地址使用 Secure Cookie，退出会清除 Session", async () => {
  const { env } = create_env();
  const login_response = await login(env, "https://admin.example.com/admin/auth/login");
  assert.match(login_response.headers.get("Set-Cookie") || "", /Secure/);

  const logout_response = await admin_worker.fetch(
    new Request("https://admin.example.com/admin/auth/logout", { method: "POST" }),
    env,
  );
  assert.equal(logout_response.status, 200);
  assert.match(logout_response.headers.get("Set-Cookie") || "", /Max-Age=0/);
});
