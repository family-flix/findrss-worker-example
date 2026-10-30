import { read_script } from "./support/script_sources.js";
import { result_fixture_source } from "./support/result_fixture.js";
import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";
import { RssRouteCache } from "../server/infra/rss_cache.js";
import { snapshot_store } from "./support/snapshot_store.js";
import { script_output } from "../server/lib/script_output.js";
import { script_image_response } from "../server/service/worker/image_proxy.js";
import { create_worker } from "../router.js";
register("./support/quickjs_wasm_hook.js", import.meta.url);
const {
  compile_script_module
} = await import("../server/infra/script_sandbox.js");
const {
  ServiceScript
} = await import("../server/service/application/scripts.js");
const {
  route: dispatch
} = await import("../application_router.js");
const {
  default: api
} = await import("../api.js");
async function setup(...scripts) {
  const rows = [];
  for (const script of scripts) {
    const compiled = await compile_script_module(script);
    assert.equal(compiled.error, "");
    rows.push({
      route: "module-" + (rows.length + 1),
      path: compiled.metadata.path,
      script,
      enabled: 1,
      metadata_json: JSON.stringify({
        ...compiled.metadata,
        debug: true
      }),
      updated_at: 1
    });
  }
  const row = rows[0];
  const cache = new RssRouteCache(60000, 100);
  const service = new ServiceScript({
    public_origin: "https://feeds.example",
    repo: {
      rss_route_cache: snapshot_store().repo,
      scripts: {
        list_enabled: () => rows.filter(row => row.enabled)
      },
      rss_cookies: {
        get: () => []
      }
    },
    ports: {
      route_cache: cache
    },
    app: {}
  });
  service.rss_address_is_public = () => false;
  service.record_log = () => {};
  const env = {
    APPLICATION: (() => ({
      fetch: request => dispatch(request, {
        scripts: service
      })
    }))()
  };
  const worker = create_worker({
    api,
    admin: {},
    discovery: async () => new Response("page", {
      status: 404
    })
  });
  return {
    row,
    rows,
    cache,
    service,
    fetch: async (path, method = "GET") => await worker.fetch(new Request("https://feeds.example" + path, {
      method
    }), env)
  };
}
test("RSS 与 Hot 同路径按模块 kind 分流，参数、缓存和 HEAD 独立处理", async () => {
  const app = await setup('export const kind = "rss"; export const route = { path: "/shared/:id", name: "订阅", public: true, handler(ctx) { return { title: "RSS " + ctx.params.id, items: [] }; } };', 'export const kind = "hot"; export const route = { path: "/shared/:id", name: "热榜", public: true, handler(ctx) { return { kind: "hot_rank", title: "Hot " + ctx.params.id, pathname: ctx.pathname, query: ctx.query, entries: [] }; } };');
  assert.equal((await (await app.fetch("/shared/1")).json()).title, "RSS 1");
  const path = "/api/hot/shared/1?category=novel&page=2";
  const hot = await app.fetch(path);
  assert.equal(hot.status, 200);
  assert.match(await hot.headers.get("Content-Type"), /application\/json/);
  assert.equal(await hot.headers.get("X-Api-RSS-Cache"), "miss");
  assert.deepEqual(await hot.json(), {
    kind: "hot_rank",
    title: "Hot 1",
    pathname: "/shared/1",
    query: {
      category: "novel",
      page: "2"
    },
    entries: []
  });
  const head = await app.fetch(path, "HEAD");
  assert.equal(head.status, 200);
  assert.equal(await head.headers.get("X-Api-RSS-Cache"), "hit");
  assert.equal(await head.text(), "");
  assert.equal((await app.fetch(path, "POST")).status, 405);
  assert.equal((await app.fetch("/rss/shared/1")).status, 503);
  await Promise.all(app.service.xml_tasks.values());
  for (const format of ["rss", "atom"]) {
    const xml = await app.fetch("/" + format + "/shared/1");
    assert.equal(xml.status, 200);
    assert.match(await xml.text(), /RSS 1/);
  }
  assert.equal((await (await app.fetch(path)).json()).title, "Hot 1");
});
test("类型不符、停用或草稿不匹配专属前缀；RSS 目录不能公开同路径私有 Hot", async () => {
  const rss = await setup('export const route = { path: "/only-rss", name: "订阅", public: true, handler() { return { title: "RSS", items: [] }; } };');
  assert.equal((await rss.fetch("/api/hot/only-rss")).status, 404);
  const hot = await setup('/** HOT */ export const route = { path: "/douyin/hot", name: "热榜", handler() { return { kind: "hot_rank", entries: [] }; } };');
  for (const format of ["rss", "atom"]) assert.equal((await hot.fetch("/" + format + "/douyin/hot")).status, 404);
  hot.service.rss_address_is_public = () => true;
  assert.equal((await hot.fetch("/api/hot/douyin/hot")).status, 401);
  const metadata = JSON.parse(hot.row.metadata_json);
  metadata.routes[0].public = true;
  hot.row.metadata_json = JSON.stringify(metadata);
  await hot.service.invalidate_routes();
  assert.equal((await hot.fetch("/api/hot/douyin/hot")).status, 200);
  hot.row.enabled = 0;
  await hot.service.invalidate_routes();
  assert.equal((await hot.fetch("/api/hot/douyin/hot")).status, 404);
  hot.row.enabled = 1;
  metadata.status = "draft";
  hot.row.metadata_json = JSON.stringify(metadata);
  await hot.service.invalidate_routes();
  assert.equal((await hot.fetch("/api/hot/douyin/hot")).status, 404);
});
test("Hot 前缀复用精确版本 Cookie 授权，缓存命中也检查撤销", async t => {
  const app = await setup(`export const kind = "hot"; export const version = "1.0.0";
export const permissions = { cookies: [{ id: "session", origin: "https://example.com", path_prefix: "/ajax/", names: ["SESSION"], purpose: "读取热榜" }] };
export const route = { path: "/douyin/hot", name: "热榜", public: true, handler: async ctx => {
  const jar = await ctx.cookies.get("session");
  if (jar.error) return jar;
  const response = await ctx.fetchText("https://example.com/ajax/hot", { cookies: jar.data });
  if (response.error) return response;
  return Result.Ok({ kind: "hot_rank", title: "热榜", entries: [] });
} };`);
  const grants = new Map();
  await Object.assign(app.service.repo.scripts, {
    exists: id => id === app.row.route,
    find: () => app.row,
    update: async value => await Object.assign(app.row, value)
  });
  app.service.repo.rss_cookie_grants = {
    find: async id => await grants.get(id),
    insert: grant => grants.set(grant.id, grant)
  };
  app.service.repo.rss_cookies.get = () => [{
    name: "SESSION",
    value: "private-session",
    domain: "example.com",
    path: "/",
    secure: true
  }];
  const fetch = t.mock.method(globalThis, "fetch", async (_url, options) => {
    assert.equal(options.headers.Cookie, "SESSION=private-session");
    return new Response("ok");
  });
  const path = "/api/hot/douyin/hot";
  assert.equal((await app.fetch(path)).status, 409);
  assert.equal(fetch.mock.callCount(), 0);
  let challenge;
  await assert.rejects(app.service.cookie_access(app.row.script, JSON.parse(app.row.metadata_json), app.row.route, "", true), error => {
    challenge = error.details.cookie_permissions;
    return error.status === 409;
  });
  await app.service.approve_cookie_grant(new Request("https://internal/_admin/scripts/cookie-grants", {
    method: "POST",
    body: JSON.stringify({
      ...challenge,
      script: app.row.script,
      confirmed: true
    })
  }));
  const response = await app.fetch(path);
  assert.equal(response.status, 200);
  assert.doesNotMatch(await response.text(), /private-session/);
  assert.equal(await (await app.fetch(path)).headers.get("X-Api-RSS-Cache"), "hit");
  assert.equal(fetch.mock.callCount(), 1);
  await grants.clear();
  assert.equal((await app.fetch(path)).status, 409);
  assert.equal(fetch.mock.callCount(), 1);
});
test("路由直达 JSON；RSS/Atom 由后台共用一份 XML 快照，Debug 包装同一函数", async () => {
  const app = await setup('export const route = { path: "/book/:id", name: "小说", public: true, example: "/book/1", handler(ctx) { return { title: ctx.params.id, items: [{ title: "章节", link: "https://example.com/chapter" }] }; } };');
  const direct = await app.fetch("/book/1");
  assert.equal(direct.status, 200);
  assert.match(await direct.headers.get("Content-Type"), /application\/json/);
  assert.equal((await direct.json()).title, "1");
  assert.equal((await app.fetch("/rss/book/1")).status, 503);
  await Promise.all(app.service.xml_tasks.values());
  for (const format of ["rss", "atom"]) {
    const response = await app.fetch("/" + format + "/book/1");
    assert.equal(response.status, 200);
    assert.match(await response.text(), /章节/);
  }
  assert.equal(app.cache.stats().executions, 2);
  const debug = await app.fetch("/debug/book/1");
  assert.equal(debug.status, 200);
  assert.match(await debug.headers.get("Content-Type"), /text\/html/);
  assert.match(await debug.text(), /路由输出/);
  assert.equal((await app.fetch("/unknown")).status, 404);
});
test("直达地址遵守原鉴权；匿名和合法凭证使用同一条路由", async () => {
  const app = await setup('export const route = { path: "/private", name: "私有", url: "example.com", maintainers: [], example: "/private", parameters: {}, description: "", handler() { return { title: "私有", items: [] }; } };');
  for (const path of ["/private", "/rss/private", "/atom/private"]) assert.equal((await app.fetch(path)).status, 401);
  const response = await dispatch(new Request("https://internal/_public/feed/raw/private", {
    headers: {
      "X-Api-Access-Token-ID": "valid-id"
    }
  }), {
    scripts: app.service
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).raw.title, "私有");
});
test("热榜缩略图在普通 JSON、缓存和 Debug 输出中保留，不主动抓取封面", async t => {
  const thumbnail = "https://cdn.example.com/book.jpg?sign=a%2Fb&expires=123";
  const entry = {
    id: "book:1",
    title: "小说",
    link: "https://example.com/book/1",
    thumbnail,
    rank: 1,
    heat: {
      value: null,
      unit: "热度",
      text: ""
    }
  };
  const app = await setup(`/** HOT */
class Ranking extends HotRankScript {
  async fetch() { return Result.Ok({ title: "小说榜", link: "https://example.com/rank", entries: [${JSON.stringify(entry)}] }); }
}
export const route = { path: "/novels/rank", name: "小说榜", public: true, handler: ctx => new Ranking().run(ctx) };`);
  const previous = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = previous;
  });
  globalThis.fetch = () => assert.fail("热榜 JSON 不应抓取封面");
  const response = await app.fetch("/novels/rank");
  assert.equal(response.status, 200);
  const value = await response.json();
  assert.deepEqual(value.entries, [{
    ...entry,
    pinned: false
  }]);
  assert.deepEqual(await (await app.fetch("/novels/rank")).json(), value);
  assert.equal(app.cache.stats().executions, 1);
  const debug = await app.fetch("/debug/novels/rank");
  assert.equal(debug.status, 200);
  assert.match(await debug.text(), /thumbnail[\s\S]*book\.jpg\?sign=a%2Fb/);
});
test("/debug 统一显示所有路由返回值，不依赖订阅字段、不抓代理图片、不写缓存", async () => {
  const values = [{
    title: "JSON",
    items: []
  }, {
    body: '<p>HTML<script>alert(1)</script></p>',
    content_type: "text/html"
  }, "纯文本", ["数组"], {
    body: "普通正文",
    items: []
  }, {
    url: "https://example.com/image.png",
    headers: {}
  }];
  const previous = globalThis.fetch;
  globalThis.fetch = () => assert.fail("调试图片描述不应抓取二进制");
  try {
    for (const value of values) {
      const app = await setup('export const route = { path: "/output/:id", name: "输出", public: true, example: "/output/12", allowed_hosts: ["example.com"], handler(ctx) { ctx.log("执行路由", ctx.params.id); return ' + JSON.stringify(value) + '; } };');
      const response = await app.fetch("/debug/output/12");
      assert.equal(response.status, 200);
      assert.match(await response.headers.get("Content-Type"), /text\/html/);
      assert.equal(await response.headers.get("Cache-Control"), "no-store");
      const html = await response.text();
      const output = /data-n="debug-output-content"[^>]*>([\s\S]*?)<\/pre>/.exec(html)[1].replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
      assert.deepEqual(JSON.parse(output), value);
      assert.match(html, /执行路由/);
      assert.match(html, /\/debug\/output\/12/);
      assert.doesNotMatch(html, /<script>|&lt;rss version=/);
      assert.equal(app.cache.stats().entries, 0);
    }
  } finally {
    globalThis.fetch = previous;
  }
});
test("番茄正文直达 HTML、HEAD 无正文；解码转义、缓存、Debug 与停用生效", async () => {
  const script = read_script("rss/fanqienovel.js");
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
    assert.match(await response.headers.get("Content-Type"), /text\/html/);
    assert.match(await response.headers.get("Content-Security-Policy"), /sandbox/);
    assert.match(await response.text(), /我的故事 &lt;script&gt;😀/);
    const head = await app.fetch(path, "HEAD");
    assert.equal(head.status, 200);
    assert.equal(await head.text(), "");
    assert.equal(calls, 1);
    assert.equal((await app.fetch("/rss" + path)).status, 503);
    await Promise.all(app.service.xml_tasks.values());
    assert.equal(calls, 2);
    const debug = await app.fetch("/debug" + path);
    assert.equal(debug.status, 200);
    const debug_html = await debug.text();
    assert.match(debug_html, /我的故事/);
    assert.match(debug_html, /data-n="debug-output-content"/);
    assert.match(debug_html, /\/debug\/fanqienovel\/chapter\/9007199254740993/);
    assert.equal(calls, 3);
    const failure = await app.fetch("/debug/fanqienovel/chapter/bad");
    assert.equal(failure.status, 400);
    assert.match(await failure.headers.get("Content-Type"), /text\/html/);
    assert.match(await failure.text(), /chapter_id 无效/);
    assert.equal(calls, 3);
    assert.equal((await app.fetch("/fanqienovel/chapter/bad")).status, 400);
    app.row.enabled = 0;
    await app.service.invalidate_routes();
    assert.equal((await app.fetch(path)).status, 404);
  } finally {
    globalThis.fetch = previous;
  }
});
test("响应 MIME 与代理目标经过宿主校验", () => {
  assert.deepEqual(script_output({}, "正文"), {
    body: "正文",
    content_type: "text/plain; charset=utf-8"
  });
  for (const value of [{
    body: 1
  }, {
    body: "x",
    content_type: "text/html\r\nSet-Cookie: secret"
  }, {
    url: "https://127.0.0.1/x"
  }]) {
    assert.throws(() => script_output({}, value));
  }
});
test("私有路由返回图片时不使用公共边缘缓存", async () => {
  const previous_fetch = globalThis.fetch,
    previous_caches = globalThis.caches;
  globalThis.caches = {
    default: {
      match() {
        assert.fail("不能读取共享缓存");
      },
      put() {
        assert.fail("不能写入共享缓存");
      }
    }
  };
  globalThis.fetch = async () => new Response(Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]), {
    headers: {
      "Content-Type": "image/png"
    }
  });
  try {
    const response = await script_image_response(new Request("https://feeds.example/private-image"), {
      route: {
        allowed_hosts: ["example.com"]
      },
      descriptor: {
        url: "https://example.com/a",
        headers: {}
      },
      version: "1",
      headers: {
        "Cache-Control": "private, max-age=60"
      }
    });
    assert.equal(response.status, 200);
    assert.equal(await response.headers.get("Cache-Control"), "private, max-age=60");
  } finally {
    globalThis.fetch = previous_fetch;
    if (previous_caches === undefined) delete globalThis.caches;else globalThis.caches = previous_caches;
  }
});
