import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";
import { create_worker } from "../router.js";
import { handle_admin_request } from "../admin.js";
import { ScriptPreviewAssets } from "../server/infra/script_preview_assets.js";
import { ScriptFeedPreviewModel } from "../admin/components/script_feed.js";
import { ScriptDebugPreviewModel } from "../admin/domain/script_preview.js";

register("./support/quickjs_wasm_hook.js", import.meta.url);
const { ServiceScript } = await import("../server/service/durable_object/scripts.js");
const { route: dispatch } = await import("../durable_object_router.js");
const { default: api } = await import("../api.js");
const origin = "https://feeds.example";
const target = "https://mmbiz.qpic.cn/icon.png";
const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]);
const source = (revision = "draft") => `export const routes = [{
  path: "/draft-feed", name: "未发布频道", example: "/draft-feed",
  handler(ctx) { return { title: "草稿", link: "https://mp.weixin.qq.com/", items: [],
    image: ctx.public_origin + "/img/draft?url=" + encodeURIComponent("${target}") }; }
}, { path: "/img/draft", name: "草稿图片代理", example: "/img/draft?url=${encodeURIComponent(target)}",
  allowed_hosts: ["mmbiz.qpic.cn"], public: true,
  handler(ctx) { return { url: ctx.query.url, headers: { Referer: "https://mp.weixin.qq.com/${revision}" } }; }
}];`;

function setup() {
  let public_reads = 0;
  const service = new ServiceScript({ repo: { scripts: { list_enabled() { public_reads++; return []; } },
    rss_cookies: { get: () => [] } }, ports: {}, app: {} });
  service.record_log = () => {};
  const env = { ADMIN_PASSWORD: "test-password", FINDRSS_HOSTNAME: origin,
    API: { getByName: () => ({ fetch: request => dispatch(request, { scripts: service }) }) } };
  const worker = create_worker({ api, admin: handle_admin_request,
    discovery: async () => new Response("not found", { status: 404 }) });
  const fetch = (path, options = {}) => worker.fetch(new Request(new URL(path, origin), options), env);
  const admin_fetch = (path, options = {}) => fetch(path, { ...options, headers: {
    Authorization: "Bearer test-password", ...options.headers,
  } });
  const debug = async (script = source(), extra = {}) => {
    const response = await admin_fetch("/admin/api/scripts/debug", { method: "POST",
      body: JSON.stringify({ script, request_url: "/debug/draft-feed", ...extra }) });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.ok, true, payload.rss_debug?.error_text);
    const debug = payload.rss_debug;
    const preview = ScriptFeedPreviewModel(debug.output, origin + "/rss/draft-feed", debug.preview_assets);
    assert.equal(preview.error, "");
    return { debug, image: preview.feed.icon };
  };
  return { service, fetch, admin_fetch, debug, public_reads: () => public_reads };
}

test("未保存草稿的图片可凭管理员会话读取，复用当前代理 handler 与真实二进制校验", async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  let upstream_calls = 0;
  globalThis.fetch = async (url, options) => {
    upstream_calls++;
    assert.equal(url, target);
    assert.deepEqual(options.headers, { referer: "https://mp.weixin.qq.com/draft" });
    return new Response(png, { headers: { "Content-Type": "image/png", "Set-Cookie": "upstream=private" } });
  };
  const app = setup();
  const routes_response = await app.admin_fetch("/admin/api/scripts/routes", { method: "POST",
    body: JSON.stringify({ script: source() }) });
  assert.equal(routes_response.status, 200);
  const routes = (await routes_response.json()).routes;
  assert.equal(routes[0].image_proxy, undefined);
  assert.equal(routes[1].image_proxy, true);
  const { debug, image } = await app.debug();
  assert.equal(app.public_reads(), 0);
  assert.equal(debug.output.includes("preview-assets"), false);
  assert.equal((await app.fetch(image)).status, 401, "预览 ID 不能代替管理员认证");
  const login = await app.fetch("/admin/auth/login", { method: "POST",
    body: JSON.stringify({ password: "test-password" }) });
  const Cookie = login.headers.get("Set-Cookie").split(";", 1)[0];
  for (const method of ["GET", "HEAD"]) {
    const response = await app.fetch(image, { method, headers: { Cookie } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Content-Type"), "image/png");
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.equal(response.headers.get("Set-Cookie"), null);
    assert.equal((await response.arrayBuffer()).byteLength, method === "GET" ? png.length : 0);
  }
  assert.equal(upstream_calls, 2);
  assert.equal(app.public_reads(), 0, "图片只执行草稿快照，不查找已发布脚本");
  assert.equal((await app.fetch("/img/draft?url=" + encodeURIComponent(target))).status, 404);
});

test("每次 Debug 固定各自源码，修改代理 handler 后旧会话不会使用新代码", async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  const seen = [];
  globalThis.fetch = async (_url, options) => {
    seen.push(options.headers.referer);
    return new Response(png, { headers: { "Content-Type": "image/png" } });
  };
  const app = setup();
  const first = await app.debug(source("first"));
  const second = await app.debug(source("second"));
  assert.equal(first.debug.output, second.debug.output);
  assert.notEqual(first.image, second.image);
  for (const image of [second.image, first.image]) {
    assert.equal((await app.admin_fetch(image)).status, 200);
  }
  assert.deepEqual(seen, ["https://mp.weixin.qq.com/second", "https://mp.weixin.qq.com/first"]);
});

test("草稿预览拒绝跨域、非图片路由、白名单外上游和失效会话，错误不抓上游", async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = () => assert.fail("非法图片请求不应出网");
  const app = setup();
  let now = 1000;
  app.service.preview_assets = new ScriptPreviewAssets({ now: () => now, ttl_ms: 100, max_entries: 2 });
  const { debug, image } = await app.debug();
  const endpoint = debug.preview_assets.endpoint;
  for (const [url, status] of [
    ["https://other.example/img/draft?url=" + encodeURIComponent(target), 400],
    ["https://user:password@feeds.example/img/draft", 400],
    [origin + "/draft-feed", 404], [origin + "/not-in-draft", 404],
    [origin + "/img/draft?url=https%3A%2F%2Fevil.example%2Fimage.png", 502],
    [origin + "/img/draft?url=https%3A%2F%2F127.0.0.1%2Fimage.png", 502],
  ]) {
    const response = await app.admin_fetch(endpoint + "?url=" + encodeURIComponent(url));
    assert.equal(response.status, status, url);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
  }
  now = 1100;
  assert.equal((await app.admin_fetch(image)).status, 410);
  const next = await app.debug();
  await app.debug(); await app.debug();
  assert.equal((await app.admin_fetch(next.image)).status, 410, "容量有上限，最早草稿被淘汰");
  assert.equal(app.service.preview_assets.entries.size, 2);
});

test("预览请求重新检查精确 Cookie 授权，撤销后旧图片地址立即失效", async t => {
  const app = setup();
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async () => new Response(png, { headers: { "Content-Type": "image/png" } });
  const grants = new Map();
  app.service.repo.rss_cookie_grants = { find: id => grants.get(id), insert: grant => grants.set(grant.id, grant) };
  app.service.ports.route_cache = { invalidate_all() {} };
  const script = `export const permissions = { cookies: [{ id: "session", origin: "https://mp.weixin.qq.com",
    path_prefix: "/", names: ["session"], purpose: "读取用户授权的内容" }] };\n` + source();
  const response = await app.admin_fetch("/admin/api/scripts/debug", { method: "POST",
    body: JSON.stringify({ script, request_url: "/debug/draft-feed" }) });
  assert.equal(response.status, 409);
  const info = (await response.json()).cookie_permissions;
  const approved = await app.admin_fetch("/admin/api/scripts/cookie-grants", { method: "POST",
    body: JSON.stringify({ ...info, script, confirmed: true }) });
  assert.equal(approved.status, 200);
  const { cookie_grant_id } = await approved.json();
  const { image } = await app.debug(script, { cookie_grant_id });
  assert.equal((await app.admin_fetch(image)).status, 200);
  grants.clear();
  assert.equal((await app.admin_fetch(image)).status, 409);
});

for (const [kind, type] of [["img", "image/png"], ["video", "video/mp4"], ["audio", "audio/mpeg"]]) {
  test(`${kind} 的未发布草稿通过 Debug 快照预览，媒体读取不会再次执行 handler`, async t => {
    const original = globalThis.fetch;
    t.after(() => { globalThis.fetch = original; });
    let resolved = 0;
    globalThis.fetch = async (url, init) => {
      if (url === "https://mmbiz.qpic.cn/resolve") { resolved++; return new Response(target); }
      assert.equal(url, target);
      assert.equal(init.headers.referer, "https://mp.weixin.qq.com/");
      const ranged = Boolean(init.headers.Range);
      return new Response(init.method === "HEAD" ? null : png, { status: ranged ? 206 : 200,
        headers: { "Content-Type": type, "Content-Length": String(png.length),
          ...(ranged ? { "Content-Range": "bytes 0-11/12", "Accept-Ranges": "bytes" } : {}) } });
    };
    const app = setup();
    const script = `export const route = { path: "/draft-media", name: "媒体草稿", allowed_hosts: ["mmbiz.qpic.cn"],
      async handler(ctx) { const result = await ctx.fetchText("https://mmbiz.qpic.cn/resolve");
        if (result.error) return result;
        return { kind: "${kind}", url: result.data, headers: { Referer: "https://mp.weixin.qq.com/" } }; } };`;
    const response = await app.admin_fetch("/admin/api/scripts/debug", { method: "POST",
      body: JSON.stringify({ script, request_url: "/debug/draft-media" }) });
    const payload = await response.json();
    assert.equal(payload.ok, true, payload.rss_debug?.error_text);
    const preview = ScriptDebugPreviewModel(payload.rss_debug);
    assert.equal(preview.kind, kind);
    assert.equal(preview.src, payload.rss_debug.preview_assets.media_url);
    assert.equal((await app.fetch(preview.src)).status, 401);
    for (const method of ["GET", "HEAD"]) {
      const media = await app.admin_fetch(preview.src, { method,
        headers: kind === "img" ? {} : { Range: "bytes=0-11" } });
      assert.equal(media.status, kind === "img" ? 200 : 206);
      assert.equal(media.headers.get("Content-Type"), type);
      assert.equal(media.headers.get("Cache-Control"), "no-store");
      assert.equal((await media.arrayBuffer()).byteLength, method === "HEAD" ? 0 : png.length);
    }
    assert.equal(resolved, 1);
    assert.equal(app.public_reads(), 0);
  });
}
