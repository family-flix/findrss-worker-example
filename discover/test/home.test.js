import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { create_memory_bucket } from "@findrss/object-store";
import { LITE_ESM, timeless_plugin } from "../../scripts/timeless_plugin.js";
import { DISCOVERY_CATALOG_KEY, DISCOVERY_CATALOG_ORIGIN } from "../../server/lib/discovery_catalog.js";
import { gzip_html } from "../../server/infra/discovery_compression.js";

const bundle = await build({
  stdin: { contents: 'export { render_home_document } from "../server/infra/discovery_home.js"; export { handle_discovery_request } from "../discover.js";',
    resolveDir: fileURLToPath(new URL("../", import.meta.url)), loader: "js" },
  bundle: true, write: false, format: "esm", platform: "neutral", mainFields: ["main"], loader: { ".html": "text", ".css": "text", ".svg": "text" },
  plugins: [timeless_plugin({ platform: LITE_ESM, ssr: true })],
});
const directory = mkdtempSync(join(tmpdir(), "findrss-home-test-"));
const module_path = join(directory, "home.mjs");
writeFileSync(module_path, bundle.outputFiles[0].text);
const { handle_discovery_request, render_home_document } = await import(pathToFileURL(module_path));
const worker = { fetch: (request, env) => handle_discovery_request(request, env, env.API?.fetch.bind(env.API)) };
rmSync(directory, { recursive: true });
const catalog = { sources: Array.from({ length: 41 }, (_, index) => ({ id: String(index), title: "源" + index,
  description: "<&介绍>", feed_url: "{{hostname}}/rss/demo/" + index, source_type: "website", tags: ["科技"],
  snapshot: { saved_at: 100, articles: [{ title: "文章", link: "https://example.com/article", published_at: 100 }] },
})), tags: ["科技"] };
const request = (path = "/", init) => new Request("https://discover.example" + path, init);
const bootstrap_data = html => JSON.parse(/<script (?:id|data-n)="discovery-catalog" type="application\/json">([^]*?)<\/script>/.exec(html)[1]);

test("广场账号页面与登录、会话、积分接口已移除，旧 Cookie 不触发账号服务", async () => {
  const env = {
    ASSETS: { fetch: () => new Response("Not Found", { status: 404 }) },
    API: { fetch() { throw Error("账号服务不应被调用"); } },
  };
  for (const [path, method] of [
    ["/account", "GET"], ["/account.html", "GET"],
    ["/api/auth/login", "POST"], ["/api/auth/logout", "POST"],
    ["/api/auth/session", "GET"], ["/api/credits", "GET"], ["/api/credits-history", "GET"],
  ]) {
    const response = await worker.fetch(request(path, { method, headers: { Cookie: "findrss_discover_session=old-session" } }), env);
    assert.equal(response.status, method === "GET" ? 404 : 405, method + " " + path);
    assert.equal(response.headers.has("Set-Cookie"), false);
  }
});

function assert_styled_home(html, response) {
  const styles = /<style id="discovery-stylesheet">([^]*?)<\/style>/.exec(html)?.[1];
  assert.ok(styles, "HTML 必须包含内嵌样式");
  assert.match(styles, /--ink-950:#0a0c10/);
  assert.match(styles, /box-sizing:border-box/);
  assert.doesNotMatch(styles, /\n|\/\*/);
  assert.match(styles, /\.feed-articles-list/);
  assert.doesNotMatch(html, /<link[^>]*rel="stylesheet"|@import/);
  assert.match(html, / n="feed-row"/);
  assert.match(html, /源19/);
  if (response) {
    const hash = createHash("sha256").update(styles).digest("base64");
    const csp = response.headers.get("Content-Security-Policy");
    assert.ok(csp.includes(`style-src 'self' 'sha256-${hash}'`));
    assert.ok(csp.includes("script-src 'self'"));
    assert.equal(csp.includes("'unsafe-inline'"), false);
  }
}

test("预生成首页默认只有网页，脚本声明的平台在没有订阅源时仍显示", () => {
  const data = { sources: [], tags: [], platforms: [{ id: "website", label: "网页" }, { id: "zhihu", label: "知乎" }, { id: "独立平台", label: "独立平台" }] };
  const html = render_home_document(data, DISCOVERY_CATALOG_ORIGIN);
  assert.match(html, /网页/);
  assert.match(html, /知乎/);
  assert.match(html, /独立平台/);
  assert.equal((html.match(/ n="platform-filter"/g) || []).length, 4);
  assert.equal(html.includes("抖音"), false);
  const icons = [...html.matchAll(/<img[^>]*src="(data:image\/svg\+xml,[^"]+)"/g)];
  assert.ok(icons.length >= 3);
  assert.doesNotMatch(html, /<img[^>]*src="\/(platform-icons|brand)\//);
});

test("发布平台的 SVG 在筛选和目录行使用图片 data URL，保留源码且不注入标记", () => {
  const icon = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M1 2h3v4H1z"/></svg>';
  const data = { sources: [{ id: "custom", title: "自定义源", feed_url: "https://example.com/feed", source_type: "自定义平台" }],
    tags: [], platforms: [{ id: "自定义平台", label: "自定义平台", icon }] };
  const html = render_home_document(data, DISCOVERY_CATALOG_ORIGIN);
  const encoded = "data:image/svg+xml," + encodeURIComponent(icon);
  assert.ok(html.includes('src="' + encoded + '"'));
  assert.equal(html.split('src="' + encoded + '"').length - 1, 2, "筛选与源标注使用同一个数据库图标");
  assert.equal(bootstrap_data(html).platforms[0].icon, icon);
  assert.equal(html.includes(icon), false, "SVG 不作为 DOM 标记插入");
});

test("预生成首屏与完整目录，链接有效，bootstrap 转义 script 结束标签", () => {
  const malicious = { ...catalog, tags: ['</script><img src=x onerror="bad()">'] };
  const html = render_home_document(malicious, DISCOVERY_CATALOG_ORIGIN);
  assert_styled_home(html);
  assert.doesNotMatch(html, /\r|\n/);
  assert.equal((html.match(/ n="feed-row"/g) || []).length, 20);
  assert.ok(html.includes("源19"));
  assert.match(html, /共 41 个订阅源/);
  assert.match(html, /href="https:\/\/example.com\/article"/);
  assert.doesNotMatch(html, /href="\/account.html"|account-link/);
  assert.equal(html.includes('<img src=x onerror="bad()">'), false);
  const data = bootstrap_data(html);
  assert.equal(data.sources.length, 41);
  assert.equal(data.tags[0], malicious.tags[0]);
});

test("首页 HTML 移除 data-n，SSR 输出订阅广场标题、描述与绝对分享地址", () => {
  const template = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.doesNotMatch(template, /\sdata-n=/);
  const html = render_home_document(catalog, "https://discover.example");
  assert.doesNotMatch(html, /\sdata-n=/);
  assert.match(html, /<html lang="zh-CN">/);
  const title = html.match(/<title>([^<]+)<\/title>/)?.[1];
  assert.equal(title, "FindRSS 订阅广场 - RSS / Atom 订阅源搜索与发现");
  assert.ok(html.includes(`<meta property="og:title" content="${title}">`));
  assert.ok(html.includes(`<meta name="twitter:title" content="${title}">`));
  assert.match(html, /<meta name="description" content="[^"]*RSS、Atom[^"]*">/);
  assert.match(html, /<link rel="canonical" href="https:\/\/discover\.example\/">/);
  assert.match(html, /<meta property="og:url" content="https:\/\/discover\.example\/">/);
  assert.match(html, /<meta name="twitter:card" content="summary">/);
  assert.match(html, /<main id="discovery-root">[^]*源19/);
  assert.match(html, /<script id="discovery-catalog" type="application\/json">/);
});

test("源码精简保留正文连续空格、换行和内嵌 JSON，不影响 hydration 文本", () => {
  const title = "第一行  两个空格\n  第二行";
  const data = { sources: [{ ...catalog.sources[0], title, snapshot: { saved_at: 100,
    articles: [{ title, link: "https://example.com/article" }] } }] };
  const html = render_home_document(data, DISCOVERY_CATALOG_ORIGIN);
  assert.ok(html.includes(title));
  assert.equal(bootstrap_data(html).sources[0].snapshot.articles[0].title, title);
  assert.doesNotMatch(html.slice(0, html.indexOf('<body')), />\s+</);
});

test("封面 SSR 输出 BlurHash 与宽高占位，原图在曝光前不生成 img 请求", () => {
  const cover_url = "https://example.com/cover.png";
  const data = { sources: [{ ...catalog.sources[0], snapshot: { saved_at: 100,
    articles: [{ title: "带图文章", cover_url, cover_width: 800, cover_height: 450, cover_blurhash: "LEHV6nWB2yk8pyo0adR*.7kCMdnj" }] } }] };
  const html = render_home_document(data, DISCOVERY_CATALOG_ORIGIN);
  assert.match(html, /n="feed-article-cover-frame"/);
  assert.match(html, /n="feed-article-cover-placeholder"[^>]*width="800"[^>]*height="450"/);
  assert.match(html, /data%3Aimage%2Fbmp%3Bbase64/);
  assert.doesNotMatch(html, /<img[^>]*src="https:\/\/example.com\/cover.png"/);
  assert.equal(bootstrap_data(html).sources[0].snapshot.articles[0].cover_blurhash, "LEHV6nWB2yk8pyo0adR*.7kCMdnj");
});

test("SSR 与旧 R2 头像都按需加载，HTML 不含图片字节且不请求头像", async () => {
  const data = { sources: [{ ...catalog.sources[0], avatar_url: "http://127.0.0.1:1234/api/avatar/0?v=123", updated_at: 123 }] };
  const calls = [];
  const env = { API: { fetch(url) {
    calls.push(String(url));
    assert.equal(String(url), "https://api/discovery/catalog");
    return Promise.resolve(Response.json(data));
  } } };
  for (const legacy of [false, true]) {
    calls.length = 0;
    if (legacy) {
      env.API_STORAGE = create_memory_bucket();
      const old_data = { sources: [{ ...data.sources[0], avatar_url: "data:image/png;base64,YQ==" }] };
      const html = render_home_document(data, DISCOVERY_CATALOG_ORIGIN)
        .replace(/<script id="discovery-catalog" type="application\/json">[^]*?<\/script>/,
          '<script data-n="discovery-catalog" type="application/json">' + JSON.stringify(old_data) + '</script>');
      await env.API_STORAGE.put(DISCOVERY_CATALOG_KEY, html);
    }
    const response = await worker.fetch(request(), env);
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.doesNotMatch(html, /data:image\/png;base64|127\.0\.0\.1|<img[^>]*n="feed-avatar-image"/);
    assert.match(html, /n="feed-avatar-placeholder"/);
    assert.match(html, /name="discovery-embedded-assets" content="7"/);
    assert.equal(bootstrap_data(html).sources[0].avatar_url, "/api/avatar/0?v=123");
    assert.equal(calls.length, legacy ? 0 : 1);
  }
});

test("头像仅由独立接口读取，并保留版本参数", async () => {
  let called;
  const response = await worker.fetch(request("/api/avatar/0?v=123"), { API: { fetch(url) {
    called = String(url); return new Response("image", { headers: { "Content-Type": "image/png" } });
  } } });
  assert.equal(called, "https://api/discovery/avatars/0?v=123");
  assert.equal(response.headers.get("Content-Type"), "image/png");
  assert.equal(await response.text(), "image");
});

test("首页只读 R2，查询参数与 Cookie 不影响公共产物，按环境展开模板域名", async () => {
  const bucket = create_memory_bucket();
  await bucket.put(DISCOVERY_CATALOG_KEY, render_home_document(catalog, DISCOVERY_CATALOG_ORIGIN));
  const env = { API_STORAGE: bucket, API: { fetch() { throw Error("不能查询 DO"); } } };
  const response = await worker.fetch(request("/?q=私人查询&page=3", { headers: { Cookie: "findrss_discover_session=private" } }), env);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Set-Cookie"), null);
  assert.equal(response.headers.get("Cache-Control"), "public, max-age=0, s-maxage=60");
  assert.match(response.headers.get("Content-Security-Policy"), /manifest-src 'self'/);
  const html = await response.text();
  assert_styled_home(html, response);
  assert.equal(html.includes("私人查询"), false);
  assert.equal(bootstrap_data(html).sources[0].feed_url, "https://discover.example/rss/demo/0");
  const fixed = await worker.fetch(request("/index.html"), { ...env, FINDRSS_HOSTNAME: "feeds.example:8443" });
  const fixed_html = await fixed.text();
  assert.equal(bootstrap_data(fixed_html).sources[0].feed_url, "https://feeds.example:8443/rss/demo/0");
  assert.match(fixed_html, /<link rel="canonical" href="https:\/\/discover\.example\/">/);
  assert.match(fixed_html, /<meta property="og:url" content="https:\/\/discover\.example\/">/);
  assert.match(fixed_html, /<meta property="og:image" content="https:\/\/discover\.example\/brand\/icon-512\.png">/);
  assert.match(fixed_html, /<meta name="twitter:image" content="https:\/\/discover\.example\/brand\/icon-512\.png">/);
  const head = await worker.fetch(request("/", { method: "HEAD" }), env);
  assert.equal(head.status, 200); assert.equal(await head.text(), "");
  assert.equal(head.headers.get("Content-Security-Policy"), response.headers.get("Content-Security-Policy"));
});

test("已有 R2 首页的外链样式在响应时内嵌，不需要等待目录重新发布", async () => {
  const bucket = create_memory_bucket();
  const html = render_home_document(catalog, DISCOVERY_CATALOG_ORIGIN)
    .replaceAll("/assets/timeless/0.34.2/", "/assets/timeless/0.34.0/")
    .replace(/<style id="discovery-stylesheet">[^]*?<\/style>/,
      '<link data-n="discovery-stylesheet" rel="stylesheet" href="./style.css">');
  await bucket.put(DISCOVERY_CATALOG_KEY, html);
  const response = await worker.fetch(request(), { API_STORAGE: bucket });
  assert.equal(response.status, 200);
  const upgraded = await response.text();
  assert_styled_home(upgraded, response);
  assert.match(upgraded, /\/assets\/timeless\/0\.34\.2\/timeless\.dom\.umd\.min\.js/);
  assert.doesNotMatch(upgraded, /\/assets\/timeless\/0\.34\.0\//);
});

test("旧版 R2 首页升级页头，跳过旧版边缘缓存并保留目录", async () => {
  const previous = globalThis.caches;
  const cache_keys = [];
  const old_html = render_home_document(catalog, DISCOVERY_CATALOG_ORIGIN)
    .replace('id="discovery-catalog"', 'data-n="discovery-catalog"')
    .replace('id="discovery-stylesheet"', 'data-n="discovery-stylesheet"')
    .replace(/<title>[^]*?<\/title>/, "<title>旧版标题</title>")
    .replace(/(<a[^>]*n="github-link"[^>]*>)[^]*?(<\/a>)/, "$1GitHub$2")
    .replace("</head>", '<meta data-n="discovery-embedded-assets" name="discovery-embedded-assets" content="5"></head>');
  globalThis.caches = { default: {
    async match(request) {
      cache_keys.push(request.url);
      if (new URL(request.url).searchParams.get("assets") === "5") return new Response(old_html);
    },
    async put() {},
  } };
  try {
    const bucket = create_memory_bucket();
    await bucket.put(DISCOVERY_CATALOG_KEY, await gzip_html(old_html), { httpMetadata: { contentEncoding: "gzip" } });
    const response = await worker.fetch(request(), { API_STORAGE: bucket,
      API: { fetch() { throw Error("升级旧首页不应请求 API"); } } });
    assert.equal(response.status, 200);
    const html = await response.text();
    const link = html.match(/<a[^>]*n="github-link"[^>]*>[^]*?<\/a>/)?.[0];
    assert.ok(link);
    assert.match(link, /href="https:\/\/github\.com\/ltaoo\/findrss-worker"/);
    assert.match(link, /target="_blank"[^>]*rel="noopener noreferrer"/);
    assert.match(link, /aria-label="FindRSS GitHub 仓库（新标签页打开）"/);
    assert.match(link, /<div class="github-icon" n="github-icon" aria-hidden="true"><\/div><\/a>$/);
    assert.match(html, /name="discovery-embedded-assets" content="7"/);
    assert.match(html, /<title>FindRSS 订阅广场 - RSS \/ Atom 订阅源搜索与发现<\/title>/);
    assert.doesNotMatch(html, /\sdata-n=/);
    assert.deepEqual(bootstrap_data(html), bootstrap_data(old_html.replaceAll(DISCOVERY_CATALOG_ORIGIN, "https://discover.example")));
    assert.equal(new URL(cache_keys[0]).searchParams.get("assets"), "7");
    assert.equal(bucket.calls.get, 1);
  } finally { globalThis.caches = previous; }
});

test("gzip R2 读取后缓存明文，按原始客户端编码头交给平台压缩，HEAD 不返回正文", async () => {
  const previous = globalThis.caches;
  const entries = new Map();
  globalThis.caches = { default: {
    match: async request => entries.get(request.url)?.clone(),
    put: async (request, response) => { entries.set(request.url, response); },
  } };
  try {
    const bucket = create_memory_bucket();
    const html = render_home_document(catalog, DISCOVERY_CATALOG_ORIGIN);
    await bucket.put(DISCOVERY_CATALOG_KEY, await gzip_html(html), { httpMetadata: { contentEncoding: "gzip" } });
    const env = { API_STORAGE: bucket };
    const gzip_request = (method = "GET") => request("/", { method, headers: { "Accept-Encoding": "br, gzip" } });
    const plain = await worker.fetch(request(), env);
    const plain_html = await plain.text();
    assert.equal(plain.headers.get("Content-Encoding"), null);
    assert.equal(plain.headers.get("Vary"), "Accept-Encoding");
    const compressed = await worker.fetch(gzip_request(), env);
    assert.equal(compressed.headers.get("Content-Encoding"), "gzip");
    assert.equal(await compressed.text(), plain_html);
    assert_styled_home(plain_html, compressed);
    assert.equal(entries.size, 1);
    const reads = bucket.calls.get;
    const cached = await worker.fetch(gzip_request(), env);
    assert.equal(await cached.text(), plain_html);
    const head = await worker.fetch(gzip_request("HEAD"), env);
    assert.equal(head.headers.get("Content-Encoding"), "gzip");
    assert.equal(await head.text(), "");
    assert.equal(bucket.calls.get, reads);
    const disabled = await worker.fetch(request("/", { headers: { "Accept-Encoding": "gzip;q=0, *;q=1" } }), env);
    assert.equal(disabled.headers.get("Content-Encoding"), null);
    const rewritten = gzip_request();
    Object.defineProperty(rewritten, "cf", { value: { clientAcceptEncoding: "identity" } });
    const original = await worker.fetch(rewritten, env);
    assert.equal(original.headers.get("Content-Encoding"), null);
    assert.equal(await original.text(), plain_html);
  } finally { globalThis.caches = previous; }
});

test("边缘缓存合并首页的不同查询，过期再读 R2，R2 缺席时才读全量 API", async () => {
  const old_caches = globalThis.caches;
  let time = 0;
  const entries = new Map();
  globalThis.caches = { default: {
    async match(request) { const entry = entries.get(request.url); return entry && entry.expires > time ? entry.response.clone() : undefined; },
    async put(request, response) { entries.set(request.url, { response, expires: time + 60000 }); },
  } };
  try {
    const bucket = create_memory_bucket();
    await bucket.put(DISCOVERY_CATALOG_KEY, render_home_document(catalog, DISCOVERY_CATALOG_ORIGIN));
    let calls = 0;
    const env = { API_STORAGE: bucket, API: { fetch() { calls++; throw Error("不能请求 DO"); } } };
    await worker.fetch(request(), env);
    const cached = await worker.fetch(request("/?q=日报&page=2"), env);
    assert_styled_home(await cached.text(), cached);
    assert.equal(bucket.calls.get, 1); assert.equal(calls, 0);
    time = 60001; await worker.fetch(request(), env); assert.equal(bucket.calls.get, 2);
    time = 120002;
    const fallback = await worker.fetch(request(), { API: { fetch(url) { calls++; assert.equal(url, "https://api/discovery/catalog"); return Response.json(catalog); } } });
    assert.equal(fallback.status, 200); assert.equal(calls, 1);
    const html = await fallback.text();
    assert_styled_home(html, fallback);
    assert.equal(bootstrap_data(html).sources.length, 41);
    await worker.fetch(request("/?page=3"), {}); assert.equal(calls, 1);
  } finally { globalThis.caches = old_caches; }
});

test("存储读取失败不回退旧数据，API 失败不缓存；Cache API 不可用仍可读首页", async () => {
  const bucket = create_memory_bucket(); bucket.fail_next({ op: "get" });
  const failed = await worker.fetch(request(), { API_STORAGE: bucket });
  assert.equal(failed.status, 503); assert.equal(failed.headers.get("Cache-Control"), "no-store");
  const upstream = await worker.fetch(request(), { API: { fetch: async () => Response.json({ error: "offline" }, { status: 502 }) } });
  assert.equal(upstream.status, 502); assert.equal(upstream.headers.get("Cache-Control"), "no-store");
  await bucket.put(DISCOVERY_CATALOG_KEY, render_home_document(catalog, DISCOVERY_CATALOG_ORIGIN));
  const old = globalThis.caches;
  globalThis.caches = { default: { async match() { throw Error("offline"); }, async put() { throw Error("offline"); } } };
  try { assert.equal((await worker.fetch(request(), { API_STORAGE: bucket })).status, 200); }
  finally { globalThis.caches = old; }
});

test("静态资源优先，管理与首页路由仍先经过 Worker，直出的静态资源带安全头", () => {
  const config = JSON.parse(readFileSync(new URL("../../wrangler.jsonc", import.meta.url), "utf8").replace(/^\s*\/\/.*$/gm, ""));
  assert.ok(Array.isArray(config.assets.run_worker_first));
  for (const path of ["/", "/index.html", "/admin/auth/*", "/admin/api/*", "/api/*", "/rss/*", "/_internal/*"]) assert.ok(config.assets.run_worker_first.includes(path));
  assert.equal(config.assets.run_worker_first.includes("/index.js"), false);
  assert.equal(config.assets.run_worker_first.includes("/admin/*"), false);
});
