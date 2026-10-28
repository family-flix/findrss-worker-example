import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { build } from "esbuild";
import { parse } from "node-html-parser";
import { fileURLToPath } from "node:url";
import { LITE_ESM, timeless_plugin } from "../../scripts/timeless_plugin.js";
import { create_worker } from "../../router.js";
import { create_memory_bucket } from "@findrss/object-store";

const bundle = await build({ stdin: { contents: 'export { create_rank_handler } from "./rank/http.js"; export { render_rank_home, rank_style_hash } from "./server/infra/rank_home.js"; export { RankViewModel, rank_query_state } from "./rank/model.js"; export * from "./rank/snapshot.js"; export * from "./rank/home.js";',
  resolveDir: fileURLToPath(new URL("../../", import.meta.url)), loader: "js" }, bundle: true, write: false, format: "esm", platform: "neutral", mainFields: ["main"],
  loader: { ".html": "text", ".css": "text" }, plugins: [timeless_plugin({ platform: LITE_ESM, ssr: true })] });
const { create_rank_handler, render_rank_home, rank_style_hash, RankViewModel, rank_query_state,
  publish_rank_snapshots, read_rank_snapshots, rank_snapshot_key, publish_rank_home, read_rank_home, RANK_HOME_KEY, RANK_HOME_ORIGIN,
} = await import("data:text/javascript;base64," + Buffer.from(bundle.outputFiles[0].text).toString("base64"));
const catalog = { boards: [
  { id: "novel", category: "小说", order: 10, platform: { name: "起点" }, title: "起点 · 月票榜", link: "https://m.qidian.com/rank/yuepiao/", observed_at: "2026-10-26T08:30:00Z", entries: [
    { id: "book", title: "小说 & 标题", link: "https://example.com/book", thumbnail: "https://example.com/cover.jpg", rank: 1, heat: { text: "11万月票", unit: "月票" } },
  ] },
  { id: "failed", category: "综合", order: 20, platform: { name: "微博" }, title: "微博热榜", error: "上游拒绝请求：HTTP 403，请更新 Cookie", entries: [] },
] };
const request = (path = "/rank/", method = "GET") => new Request("https://findrss.example" + path, { method });
const scripts = catalog.boards.map(({ id }) => ({ id }));
const snapshot = { html: render_rank_home(catalog, RANK_HOME_ORIGIN), version: "fixture", style_hash: await rank_style_hash() };
const publish = (env, boards = catalog.boards) => publish_rank_snapshots(async save => {
  for (const board of boards) await save(board);
  return { boards };
}, env);

test("SSR 首屏包含成功内容、封面、错误原因与内嵌样式，不依赖浏览器再次请求", () => {
  const html = render_rank_home(catalog, "https://findrss.example");
  const root = parse(html);
  assert.equal(root.querySelectorAll('[n="rank-card"]').length, 2);
  assert.match(root.querySelector('[n="rank-entry-link"]').text, /小说 & 标题/);
  assert.match(root.querySelector('[n="rank-error-reason"]').text, /HTTP 403.*Cookie/);
  assert.equal(root.querySelector('[n="rank-cover"]').getAttribute("src"), "https://example.com/cover.jpg");
  assert.equal(root.querySelector('[n="rank-heat"]').text, "11万月票");
  assert.ok(root.querySelector('[n="rank-summary"]').text.includes("2 个榜单，1 个已更新，1 个暂不可用"));
  assert.equal(root.querySelector('link[rel="canonical"]').getAttribute("href"), "https://findrss.example/rank/");
  assert.equal(root.querySelectorAll('link[rel="stylesheet"]').length, 0);
  assert.ok(root.querySelector("#rank-stylesheet").text.includes("box-sizing:border-box"));
  assert.deepEqual(JSON.parse(root.querySelector("#rank-catalog").text), catalog);
  assert.equal(root.querySelectorAll('script[src="/rank/index.js"]').length, 1);
});

test("分类、来源和搜索交集筛选保持排序，SSR 选中标签与客户端状态一致，封面按需显示", t => {
  const data = { boards: [
    { ...catalog.boards[0], id: "late", order: 30 },
    { ...catalog.boards[0], id: "first", order: -1 },
    { ...catalog.boards[0], id: "tie", order: -1, entries: [{ id: "bare", title: "无封面", rank: 2 }] },
    { ...catalog.boards[0], id: "other", order: -2, platform: { name: "番茄小说" } },
    catalog.boards[1],
  ] };
  const params = new URLSearchParams({ q: "月票", category: "小说", source_type: "起点" });
  const model = RankViewModel(data, params);
  const ids = () => model.state.boards.value.map(board => board.id);
  assert.deepEqual(ids(), ["first", "tie", "late"]);
  const root = parse(render_rank_home(data, "https://findrss.example", params));
  assert.equal(root.querySelectorAll('[n="rank-card"]').length, 3);
  assert.equal(root.querySelectorAll('[n="rank-cover"]').length, 2);
  assert.deepEqual(root.querySelectorAll('[n="rank-category-filter"][aria-pressed="true"]').map(node => node.text), ["小说"]);
  assert.deepEqual(root.querySelectorAll('[n="rank-source-filter"][aria-pressed="true"]').map(node => node.text), ["起点"]);
  assert.equal(root.querySelector('[n="rank-search"]').getAttribute("value"), "月票");
  const original = globalThis.window;
  t.after(() => { if (original === undefined) delete globalThis.window; else globalThis.window = original; });
  globalThis.window = { location: { href: "https://findrss.example/rank/?" + params }, history: {
    replaceState: (_, __, path) => { globalThis.window.location.href = "https://findrss.example" + path; },
  } };
  model.methods.select_source("");
  assert.deepEqual(ids(), ["other", "first", "tie", "late"]);
  model.methods.select_category("综合");
  assert.deepEqual(ids(), []);
  model.methods.search("微博");
  assert.deepEqual(ids(), ["failed"]);
  assert.match(model.state.summary.value, /1 个暂不可用/);
  assert.deepEqual(rank_query_state(new URL(window.location.href).searchParams), { q: "微博", category: "综合", source_type: "" });
  assert.deepEqual(RankViewModel({ boards: [{ id: "legacy", entries: [] }] }).state.category_filters, [{ id: "", label: "全部" }, { id: "其他", label: "其他" }]);
  assert.deepEqual(rank_query_state(new URLSearchParams({ q: "a\n", category: "c".repeat(40), source_type: "s".repeat(70) })), { q: "a", category: "c".repeat(32), source_type: "s".repeat(64) });
});

test("HTML 缓存隔离分类和来源筛选，参数规范化后复用缓存", async t => {
  const original = globalThis.caches;
  t.after(() => { globalThis.caches = original; });
  const stored = new Map();
  globalThis.caches = { default: { match: async key => stored.get(key.url)?.clone(), put: async (key, value) => stored.set(key.url, value) } };
  let loads = 0;
  const handler = create_rank_handler(async () => { loads++; return snapshot; }, "filters");
  const page = async filters => parse(await (await handler(request("/rank/?" + new URLSearchParams(filters)), {})).text());
  assert.equal((await page({ category: "小说" })).querySelector('[n="rank-card"]').getAttribute("aria-label"), "起点 · 月票榜");
  assert.equal((await page({ category: "综合" })).querySelector('[n="rank-card"]').getAttribute("aria-label"), "微博热榜");
  assert.equal((await page({ category: "小说", source_type: "微博" })).querySelectorAll('[n="rank-card"]').length, 0);
  assert.equal((await page({ category: "小说", source_type: "起点" })).querySelectorAll('[n="rank-card"]').length, 1);
  await page({ category: "小说", source_type: "起点\n", ignored: "1" });
  assert.equal(loads, 5);
  assert.equal(stored.size, 4);
});

test("同一 Model 为 SSR 和客户端筛选相同数据，阻止 HTML、脚本 URL、凭据 URL 注入", () => {
  const model = RankViewModel(catalog, new URLSearchParams("q=微博"));
  assert.deepEqual(model.state.boards.value.map(board => board.id), ["failed"]);
  model.state.query.set("没有此榜");
  assert.equal(model.state.boards.value.length, 0);
  const value = { boards: [{ id: "x", title: "<img src=x onerror=evil>测试", entries: [
    { id: "1", title: '</script><script>alert(1)</script>', link: "javascript:alert(1)", thumbnail: "https://user:secret@example.com/private", rank: null },
  ], error: "" }] };
  const html = render_rank_home(value, "https://findrss.example");
  assert.doesNotMatch(html, /<script>alert|onerror="evil"|href="javascript:|src="https:\/\/user:secret/);
  assert.equal(JSON.parse(parse(html).querySelector("#rank-catalog").text).boards[0].id, "x");
  assert.match(render_rank_home(catalog, "https://findrss.example", new URLSearchParams("q=没有")), /没有找到匹配的榜单/);
});

test("JSON 快照原样保留数据，SSR 转义脚本结束标签并安全渲染", async () => {
  const board = { id: "injection", title: "测试 </script><script>alert(1)</script>", entries: [
    { id: "unsafe", title: "<img src=x onerror=evil>正文", thumbnail: "javascript:alert(1)", link: "javascript:alert(1)", rank: null },
  ] };
  const bucket = create_memory_bucket();
  const env = { API_STORAGE: bucket };
  await publish(env, [board]);
  assert.deepEqual(JSON.parse(await (await bucket.get(rank_snapshot_key(board.id))).text()), board);
  const result = await read_rank_snapshots([{ id: board.id }], env);
  assert.deepEqual(result.boards, [board]);
  assert.equal(result.available, 1);
  const html = render_rank_home({ boards: result.boards }, "https://findrss.example");
  assert.doesNotMatch(html, /<script>alert|<img src=x|onerror="evil"|href="javascript:|src="javascript:/);
});

test("rank HTTP 与总路由支持入口、静态资源、HEAD、缓存和 405，不请求 discover 或私有 API", async t => {
  let loads = 0;
  const stored = new Map();
  const original = globalThis.caches;
  t.after(() => { globalThis.caches = original; });
  globalThis.caches = { default: { match: async key => stored.get(key.url)?.clone(), put: async (key, value) => stored.set(key.url, value) } };
  const rank = create_rank_handler(async () => { loads++; return snapshot; }, "test-version");
  const worker = create_worker({ api: { fetch() { assert.fail("不能调用私有 API"); } }, admin() { assert.fail(); }, discovery() { assert.fail(); }, rank });
  const env = { ASSETS: { fetch: () => new Response("rank client") } };
  const redirected = await worker.fetch(request("/rank?q=小说"), env);
  assert.equal(redirected.status, 302);
  assert.equal(redirected.headers.get("Location"), "https://findrss.example/rank/?q=%E5%B0%8F%E8%AF%B4");
  const response = await worker.fetch(request(), env);
  assert.equal(response.status, 200);
  const html = await response.text();
  const styles = parse(html).querySelector("#rank-stylesheet").text;
  const hash = createHash("sha256").update(styles).digest("base64");
  assert.ok(response.headers.get("Content-Security-Policy").includes("'sha256-" + hash + "'"));
  assert.doesNotMatch(response.headers.get("Content-Security-Policy"), /unsafe-inline/);
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
  const head = await worker.fetch(request("/rank/", "HEAD"), env);
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
  assert.equal(loads, 2);
  assert.equal((await worker.fetch(request("/rank/index.html"), env)).status, 200);
  assert.equal(loads, 3);
  assert.equal(await (await worker.fetch(request("/rank/index.js"), env)).text(), "rank client");
  assert.equal((await worker.fetch(request("/rank/", "POST"), env)).status, 405);
});

test("快照读取异常仍返回可读故障页且不缓存", async () => {
  const response = await create_rank_handler(async () => { throw Error("private secret"); }, "failure")(request(), {});
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  const html = await response.text();
  assert.match(html, /排行榜快照尚未生成或暂不可用/);
  assert.doesNotMatch(html, /private secret/);
});

test("JSON 之后发布完整 HTML，访问仅读取页面快照，筛选和 HEAD 不触发采集", async t => {
  const original = globalThis.caches;
  t.after(() => { globalThis.caches = original; });
  globalThis.caches = undefined;
  const bucket = create_memory_bucket();
  const env = { API_STORAGE: bucket };
  let collections = 0;
  const worker = create_worker({
    rank: create_rank_handler(read_rank_home, "per-script"),
    rank_snapshot: async binding => { collections++; const catalog = await publish(binding); await publish_rank_home(catalog, binding); },
  });
  const missing = await worker.fetch(request(), env);
  assert.equal(missing.status, 503);
  assert.equal(missing.headers.get("Cache-Control"), "no-store");
  assert.match(await missing.text(), /快照尚未生成/);
  assert.equal(collections, 0);
  assert.equal(bucket.calls.put, 0);
  await worker.scheduled({ cron: "*/5 * * * *" }, env);
  assert.equal(collections, 1);
  assert.equal(bucket.calls.put, 3);
  assert.deepEqual([...bucket.objects.keys()], [...scripts.map(script => rank_snapshot_key(script.id)), RANK_HOME_KEY]);
  const object = await bucket.get(rank_snapshot_key("novel"));
  assert.equal(object.key, "rank/scripts/novel.json");
  assert.equal(object.httpMetadata.contentType, "application/json; charset=utf-8");
  assert.equal(object.httpMetadata.contentEncoding, undefined);
  assert.deepEqual(JSON.parse(await object.text()), catalog.boards[0]);
  assert.deepEqual(JSON.parse(await (await bucket.get(rank_snapshot_key("failed"))).text()), catalog.boards[1]);
  const reads = bucket.calls.get;
  const response = await worker.fetch(request(), env);
  assert.equal(bucket.calls.get - reads, 1);
  assert.equal(response.status, 200);
  const html = await response.text();
  const root = parse(html);
  assert.equal(root.querySelectorAll("html").length, 1);
  assert.deepEqual(root.querySelectorAll('[n="rank-card"]').map(node => node.getAttribute("aria-label")), catalog.boards.map(board => board.title));
  assert.equal(root.querySelector('[n="rank-cover"]').getAttribute("src"), "https://example.com/cover.jpg");
  assert.equal(root.querySelector('link[rel="canonical"]').getAttribute("href"), "https://findrss.example/rank/");
  assert.deepEqual(JSON.parse(root.querySelector("#rank-catalog").text), catalog);
  const filtered = await worker.fetch(request("/rank/?category=综合&source_type=微博&q=微博"), env);
  assert.equal(filtered.status, 200);
  const filtered_root = parse(await filtered.text());
  assert.equal(filtered_root.querySelectorAll('[n="rank-card"]').length, 1);
  assert.match(filtered_root.querySelector('[n="rank-error-reason"]').text, /HTTP 403/);
  assert.equal((await worker.fetch(request("/rank/", "HEAD"), env)).status, 200);
  assert.equal(await (await worker.fetch(request("/rank/", "HEAD"), env)).text(), "");
  assert.equal(collections, 1);
  assert.equal(bucket.calls.put, 3);
  await worker.scheduled({ cron: "*/5 * * * *" }, env);
  assert.equal(collections, 2);
  assert.equal(bucket.calls.put, 6);
});

test("单个脚本写入失败保留自己的旧 JSON，其余脚本继续更新", async () => {
  const bucket = create_memory_bucket();
  const env = { API_STORAGE: bucket };
  await publish(env);
  const original = await (await bucket.get(rank_snapshot_key("novel"))).text();
  bucket.fail_next({ op: "put" });
  await assert.rejects(publish(env, catalog.boards.map(board => ({ ...board, title: "新版" + board.title }))), /1 个脚本快照写入失败/);
  assert.equal(await (await bucket.get(rank_snapshot_key("novel"))).text(), original);
  const saved = await read_rank_snapshots(scripts, env);
  assert.equal(saved.available, 2);
  assert.equal(saved.boards[0].title, catalog.boards[0].title);
  assert.equal(saved.boards[1].title, "新版" + catalog.boards[1].title);
  await assert.rejects(publish_rank_snapshots(async () => { throw Error("生成失败"); }, env), /生成失败/);
  assert.equal(await (await bucket.get(rank_snapshot_key("novel"))).text(), original);
  await assert.rejects(publish_rank_snapshots(() => assert.fail("没有存储时不应采集"), {}), /存储未配置/);
});

test("单份 JSON 缺失、损坏或读取失败会阻止发布，保留旧完整页面", async () => {
  const bucket = create_memory_bucket();
  const env = { API_STORAGE: bucket };
  await publish(env);
  await publish_rank_home(catalog, env);
  const previous = await read_rank_home(env);
  await bucket.delete(rank_snapshot_key("failed"));
  const partial = await read_rank_snapshots(scripts, env);
  assert.equal(partial.available, 1);
  const root = parse(render_rank_home({ boards: partial.boards }, "https://findrss.example"));
  assert.equal(root.querySelectorAll('[n="rank-card"]').length, 2);
  assert.equal(root.querySelectorAll('[n="rank-cover"]').length, 1);
  assert.match(root.querySelector('[n="rank-error-reason"]').text, /尚未生成/);
  await assert.rejects(publish_rank_home(catalog, env), /尚未全部就绪/);
  assert.deepEqual(await read_rank_home(env), previous);
  for (const content of ["{broken-json", "null", JSON.stringify({ id: "other", entries: [] }), JSON.stringify({ id: "failed", entries: {} }), JSON.stringify({ id: "failed", entries: [null] })]) {
    await bucket.put(rank_snapshot_key("failed"), content);
    const broken = await read_rank_snapshots(scripts, env);
    assert.equal(broken.available, 1);
    assert.match(broken.boards[1].error, /读取失败/);
    await assert.rejects(publish_rank_home(catalog, env), /尚未全部就绪/);
  }
  assert.deepEqual(await read_rank_home(env), previous);
  await publish(env);
  await publish_rank_home(catalog, env);
  assert.notEqual((await read_rank_home(env)).version, previous.version);
});

test("读取脚本快照最多并发 8 份，完成顺序不改变卡片排序", async () => {
  const bucket = create_memory_bucket();
  const env = { API_STORAGE: bucket };
  const boards = Array.from({ length: 19 }, (_, index) => ({ id: "board" + index, title: "榜单" + index, order: -index, entries: [] }));
  await publish(env, boards);
  let active = 0, peak = 0;
  const get = bucket.get;
  bucket.get = async key => {
    active++; peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, key.includes("board0.") ? 5 : 1));
    try { return await get(key); } finally { active--; }
  };
  const result = await read_rank_snapshots(boards, env);
  assert.equal(result.available, 19);
  assert.deepEqual(result.boards.map(board => board.id), boards.map(board => board.id));
  assert.ok(peak > 1 && peak <= 8);
  const html = render_rank_home({ boards: result.boards }, "https://findrss.example");
  assert.deepEqual(parse(html).querySelectorAll('[n="rank-card"]').map(node => node.getAttribute("aria-label")), boards.toReversed().map(board => board.title));
});

test("刷新页面版本后默认页和筛选页立即切换，旧边缘缓存不会继续命中", async t => {
  const original = globalThis.caches;
  t.after(() => { globalThis.caches = original; });
  const stored = new Map();
  globalThis.caches = { default: { match: async key => stored.get(key.url)?.clone(), put: async (key, value) => stored.set(key.url, value) } };
  const env = { API_STORAGE: create_memory_bucket() };
  const handler = create_rank_handler(read_rank_home, "revision");
  await publish(env);
  await publish_rank_home(catalog, env);
  const first = await read_rank_home(env);
  const page = async path => parse(await (await handler(request(path), env)).text());
  assert.equal((await page("/rank/")).querySelector('[n="rank-card"]').getAttribute("aria-label"), "起点 · 月票榜");
  await page("/rank/?category=小说");
  assert.equal(stored.size, 2);
  const updated = { boards: catalog.boards.map(board => ({ ...board, title: "新版" + board.title })) };
  await publish(env, updated.boards);
  await publish_rank_home(updated, env);
  const second = await read_rank_home(env);
  assert.notEqual(second.version, first.version);
  for (const path of ["/rank/", "/rank/?category=小说"]) {
    assert.equal((await page(path)).querySelector('[n="rank-card"]').getAttribute("aria-label"), "新版起点 · 月票榜");
  }
  assert.equal(stored.size, 4);
  assert.ok([...stored.keys()].some(key => key.includes("snapshot=" + second.version)));
});

test("HTML 写入失败或任务取消保留旧页面，页面读取失败时不补抓", async t => {
  const original = globalThis.caches;
  t.after(() => { globalThis.caches = original; });
  globalThis.caches = undefined;
  const bucket = create_memory_bucket();
  const env = { API_STORAGE: bucket };
  await publish(env);
  await publish_rank_home(catalog, env);
  const previous = await read_rank_home(env);
  bucket.fail_next({ op: "put" });
  await assert.rejects(publish_rank_home(catalog, env), /put failed/);
  assert.deepEqual(await read_rank_home(env), previous);
  const controller = new AbortController();
  controller.abort(Error("测试取消"));
  await assert.rejects(publish_rank_home(catalog, env, controller.signal), /测试取消/);
  assert.deepEqual(await read_rank_home(env), previous);
  const handler = create_rank_handler(read_rank_home, "read-failure");
  bucket.fail_next({ op: "get" });
  const failed = await handler(request(), env);
  assert.equal(failed.status, 503);
  assert.equal(failed.headers.get("Cache-Control"), "no-store");
  assert.equal((await handler(request(), env)).status, 200);
});

test("预生成页面保留自己的样式 CSP，避免部署后旧快照的内嵌样式被拦截", async t => {
  const original = globalThis.caches;
  t.after(() => { globalThis.caches = original; });
  globalThis.caches = undefined;
  const html = snapshot.html.replace("</style>", "body{color:red}</style>");
  const hash = createHash("sha256").update(parse(html).querySelector("#rank-stylesheet").text).digest("base64");
  const handler = create_rank_handler(async () => ({ html, version: "previous-styles", style_hash: hash }), "styles");
  const response = await handler(request(), {});
  assert.equal(response.status, 200);
  assert.ok(response.headers.get("Content-Security-Policy").includes("'sha256-" + hash + "'"));
  assert.equal(await response.text(), html.replace(`href="${RANK_HOME_ORIGIN}/rank/"`, 'href="https://findrss.example/rank/"'));
});
