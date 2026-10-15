import { result_fixture_source } from "./support/result_fixture.js";
import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";
import { readFile } from "node:fs/promises";
import { RssRouteCache } from "../server/infra/rss_cache.js";
import { snapshot_store } from "./support/snapshot_store.js";
import { script_output } from "../server/lib/script_output.js";
import { script_image_response } from "../server/service/worker/image_proxy.js";
import { create_worker } from "../router.js";
register("./support/quickjs_wasm_hook.js", import.meta.url);
const { compile_script_module } = await import("../server/infra/script_sandbox.js");
const { ServiceScript } = await import("../server/service/durable_object/scripts.js");
const { route: dispatch } = await import("../durable_object_router.js");
const { default: api } = await import("../api.js");

async function setup(script) {
  const compiled = await compile_script_module(script);
  assert.equal(compiled.error, "");
  const row = { route: "module-1", path: compiled.metadata.path, script, enabled: 1,
    metadata_json: JSON.stringify({ ...compiled.metadata, debug: true }), updated_at: 1 };
  const cache = new RssRouteCache(60000, 100);
  const service = new ServiceScript({ public_origin: "https://feeds.example", repo: {
    rss_route_cache: snapshot_store().repo,
    scripts: { list_enabled: () => row.enabled ? [row] : [] }, rss_cookies: { get: () => [] },
  }, ports: { route_cache: cache }, app: {} });
  service.rss_address_is_public = () => false;
  service.record_log = () => {};
  const env = { API: { getByName: () => ({ fetch: request => dispatch(request, { scripts: service }) }) } };
  const worker = create_worker({ api, admin: {}, discovery: async () => new Response("page", { status: 404 }) });
  return { row, cache, service, fetch: (path, method = "GET") => worker.fetch(new Request("https://feeds.example" + path, { method }), env) };
}

test("路由直达 JSON；RSS/Atom 由后台共用一份 XML 快照，Debug 包装同一函数", async () => {
  const app = await setup('export const route = { path: "/book/:id", name: "小说", public: true, example: "/book/1", handler(ctx) { return { title: ctx.params.id, items: [{ title: "章节", link: "https://example.com/chapter" }] }; } };');
  const direct = await app.fetch("/book/1");
  assert.equal(direct.status, 200);
  assert.match(direct.headers.get("Content-Type"), /application\/json/);
  assert.equal((await direct.json()).title, "1");
  assert.equal((await app.fetch("/rss/book/1")).status, 503);
  await app.service.refresh_due_snapshots();
  for (const format of ["rss", "atom"]) {
    const response = await app.fetch("/" + format + "/book/1");
    assert.equal(response.status, 200);
    assert.match(await response.text(), /章节/);
  }
  assert.equal(app.cache.stats().executions, 2);
  const debug = await app.fetch("/debug/book/1");
  assert.equal(debug.status, 200);
  assert.match(debug.headers.get("Content-Type"), /text\/html/);
  assert.match(await debug.text(), /路由输出/);
  assert.equal((await app.fetch("/unknown")).status, 404);
});

test("直达地址遵守原鉴权；匿名和合法凭证使用同一条路由", async () => {
  const app = await setup('export const route = { path: "/private", name: "私有", url: "example.com", maintainers: [], example: "/private", parameters: {}, description: "", handler() { return { title: "私有", items: [] }; } };');
  for (const path of ["/private", "/rss/private", "/atom/private"]) assert.equal((await app.fetch(path)).status, 401);
  const response = await dispatch(new Request("https://internal/_public/feed/raw/private", {
    headers: { "X-Api-Access-Token-ID": "valid-id" },
  }), { scripts: app.service });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).raw.title, "私有");
});

test("/debug 统一显示所有路由返回值，不依赖订阅字段、不抓代理图片、不写缓存", async () => {
  const values = [
    { title: "JSON", items: [] },
    { body: '<p>HTML<script>alert(1)</script></p>', content_type: "text/html" },
    "纯文本", ["数组"],
    { body: "普通正文", items: [] },
    { url: "https://example.com/image.png", headers: {} },
  ];
  const previous = globalThis.fetch;
  globalThis.fetch = () => assert.fail("调试图片描述不应抓取二进制");
  try {
    for (const value of values) {
      const app = await setup('export const route = { path: "/output/:id", name: "输出", public: true, example: "/output/12", allowed_hosts: ["example.com"], handler(ctx) { ctx.log("执行路由", ctx.params.id); return ' + JSON.stringify(value) + '; } };');
      const response = await app.fetch("/debug/output/12");
      assert.equal(response.status, 200);
      assert.match(response.headers.get("Content-Type"), /text\/html/);
      assert.equal(response.headers.get("Cache-Control"), "no-store");
      const html = await response.text();
      const output = /data-n="debug-output-content"[^>]*>([\s\S]*?)<\/pre>/.exec(html)[1]
        .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
      assert.deepEqual(JSON.parse(output), value);
      assert.match(html, /执行路由/);
      assert.match(html, /\/debug\/output\/12/);
      assert.doesNotMatch(html, /<script>|&lt;rss version=/);
      assert.equal(app.cache.stats().entries, 0);
    }
  } finally { globalThis.fetch = previous; }
});

test("番茄正文直达 HTML、HEAD 无正文；解码转义、缓存、Debug 与停用生效", async () => {
  const script = await readFile(new URL("../examples/scripts/fanqienovel_chapters.js", import.meta.url), "utf8");
  const app = await setup(result_fixture_source(script));
  const previous = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async url => {
    calls++;
    assert.equal(url, "https://fanqienovel.com/reader/9007199254740993?enter_from=page");
    return new Response('<h1 class="muye-reader-title"></h1><div class="muye-reader-content"><div><p>故 &lt;script&gt;😀</p></div></div>');
  };
  try {
    const path = "/fanqienovel/chapter/9007199254740993";
    const response = await app.fetch(path);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("Content-Type"), /text\/html/);
    assert.match(response.headers.get("Content-Security-Policy"), /sandbox/);
    assert.match(await response.text(), /我的故事 &lt;script&gt;😀/);
    const head = await app.fetch(path, "HEAD");
    assert.equal(head.status, 200);
    assert.equal(await head.text(), "");
    assert.equal(calls, 1);
    assert.equal((await app.fetch("/rss" + path)).status, 503);
    const debug = await app.fetch("/debug" + path);
    assert.equal(debug.status, 200);
    const debug_html = await debug.text();
    assert.match(debug_html, /我的故事/);
    assert.match(debug_html, /data-n="debug-output-content"/);
    assert.match(debug_html, /\/debug\/fanqienovel\/chapter\/9007199254740993/);
    assert.equal(calls, 2);
    const failure = await app.fetch("/debug/fanqienovel/chapter/bad");
    assert.equal(failure.status, 400);
    assert.match(failure.headers.get("Content-Type"), /text\/html/);
    assert.match(await failure.text(), /chapter_id 无效/);
    assert.equal(calls, 2);
    assert.equal((await app.fetch("/fanqienovel/chapter/bad")).status, 400);
    app.row.enabled = 0;
    app.service.invalidate_routes();
    assert.equal((await app.fetch(path)).status, 404);
  } finally { globalThis.fetch = previous; }
});

test("响应 MIME 与代理目标经过宿主校验", () => {
  assert.deepEqual(script_output({}, "正文"), { body: "正文", content_type: "text/plain; charset=utf-8" });
  for (const value of [{ body: 1 }, { body: "x", content_type: "text/html\r\nSet-Cookie: secret" }, { url: "https://127.0.0.1/x" }]) {
    assert.throws(() => script_output({}, value));
  }
});

test("私有路由返回图片时不使用公共边缘缓存", async () => {
  const previous_fetch = globalThis.fetch, previous_caches = globalThis.caches;
  globalThis.caches = { default: { match() { assert.fail("不能读取共享缓存"); }, put() { assert.fail("不能写入共享缓存"); } } };
  globalThis.fetch = async () => new Response(Uint8Array.from([137,80,78,71,13,10,26,10,0,0,0,13]), { headers: { "Content-Type": "image/png" } });
  try {
    const response = await script_image_response(new Request("https://feeds.example/private-image"), {
      route: { allowed_hosts: ["example.com"] }, descriptor: { url: "https://example.com/a", headers: {} },
      version: "1", headers: { "Cache-Control": "private, max-age=60" },
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Cache-Control"), "private, max-age=60");
  } finally {
    globalThis.fetch = previous_fetch;
    if (previous_caches === undefined) delete globalThis.caches;
    else globalThis.caches = previous_caches;
  }
});
