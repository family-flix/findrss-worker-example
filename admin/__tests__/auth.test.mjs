import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { initialize_admin_auth } from "../store.js";

function fixture(path, fetch = async () => Response.json({ logged_in: false })) {
  const redirects = [], requests = [];
  const location = new URL(path, "https://feeds.example");
  location.replace = url => redirects.push(url);
  const context = { URL, URLSearchParams, Request, Element: class {},
    document: { addEventListener() {} }, window: { location, async fetch(input, init) {
      requests.push({ input, init }); return fetch(input, init);
    } },
  };
  const auth = vm.runInNewContext("(" + initialize_admin_auth.toString() + ")()", context);
  assert.equal(auth, context.window.FindRSSAdminAuth);
  return { auth, redirects, requests };
}

test("store 中的认证初始化仅允许匿名访问登录页，私有页面保留原地址跳转登录", async () => {
  for (const path of ["/admin/login", "/admin/login.html"]) {
    const f = fixture(path);
    assert.equal(await f.auth.beforeReady(), true);
    assert.equal(f.redirects.length, 0);
    assert.equal(f.requests[0].init.credentials, "same-origin");
    assert.equal(f.requests[0].init.cache, "no-store");
  }
  for (const path of ["/admin/", "/admin/users?q=readers#list", "/admin/unknown", "/admin/oauth?request=one"]) {
    const f = fixture(path);
    assert.equal(await f.auth.beforeReady(), false);
    assert.deepEqual(f.redirects, ["/admin/login.html?redirect=" + encodeURIComponent(path)]);
  }
  await assert.rejects(fixture("/admin/", async () => new Response("", { status: 503 })).auth.beforeReady(), /HTTP 503/);
});

test("登录仅提交密码，回跳地址拒绝外站和登录页循环，已登录用户直接回跳", async () => {
  for (const [target, expected] of [
    ["/admin/scripts?kind=hot#editor", "/admin/scripts?kind=hot#editor"],
    ["/admin/oauth?request=one", "/admin/oauth?request=one"],
    ["https://evil.example/", "/admin/"], ["//evil.example/", "/admin/"],
    ["/admin/login.html", "/admin/"], ["http://[", "/admin/"],
  ]) {
    const f = fixture("/admin/login.html?redirect=" + encodeURIComponent(target), async () => Response.json({ logged_in: true }));
    assert.equal(await f.auth.beforeReady(), false);
    assert.deepEqual(f.redirects, [expected]);
    f.redirects.length = 0;
    await f.auth.login("test-password");
    const request = f.requests.at(-1);
    assert.equal(request.input, "/admin/auth/login");
    assert.equal(request.init.method, "POST");
    assert.deepEqual(JSON.parse(request.init.body), { password: "test-password" });
    assert.deepEqual(f.redirects, [expected]);
  }
  const failed = fixture("/admin/login.html", async () => Response.json({ error: "密码错误" }, { status: 401 }));
  await assert.rejects(failed.auth.login("wrong"), /密码错误/);
  assert.equal(failed.redirects.length, 0);
});

test("鉴权请求原样返回响应，仅本站管理 API 的 401 触发登录跳转", async () => {
  const response = new Response("expired", { status: 401 });
  for (const [input, redirected] of [
    ["/admin/api/users", true], [new Request("https://feeds.example/admin/api/users"), true],
    [new URL("https://feeds.example/admin/api/users"), true],
    ["https://external.example/admin/api/users", false], ["/api/sources", false],
  ]) {
    const f = fixture("/admin/users?q=reader", async () => response);
    assert.equal(await f.auth.fetch(input), response);
    assert.equal(f.redirects.length, redirected ? 1 : 0);
  }
});

test("退出请求失败时仍回到登录页", async () => {
  const f = fixture("/admin/", async () => { throw new Error("offline"); });
  await assert.rejects(f.auth.logout(), /offline/);
  assert.equal(f.requests[0].input, "/admin/auth/logout");
  assert.equal(f.requests[0].init.method, "POST");
  assert.deepEqual(f.redirects, ["/admin/login.html"]);
});
