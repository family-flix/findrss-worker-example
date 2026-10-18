import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { DISCOVERY_PLATFORM_LABELS } from "../../server/lib/constants.js";
import { initialize_home } from "./home_fixture.js";

function model_fixture(fetch, href = "https://discover.example/", catalog = null) {
  const ref = (value) => ({ value, set(next) { this.value = next; } });
  const location = { href };
  const listeners = new Map();
  const entries = [href];
  let position = 0;
  const history = {
    pushState(_state, _title, url) { entries.splice(++position); entries.push(url); location.href = url; },
    replaceState(_state, _title, url) { entries[position] = url; location.href = url; },
  };
  const context = vm.createContext({ URL, URLSearchParams, fetch, setTimeout, clearTimeout, catalog, parameters: new URL(href).searchParams,
    window: { Timeless: { DOM: {}, ref }, location, history, addEventListener(name, callback) { listeners.set(name, callback); } },
  });
  const model = initialize_home(context, vm);
  return Object.assign(model, { navigation: {
    location, entries,
    async go(delta) { position += delta; location.href = entries[position]; await listeners.get("popstate")(); },
  } });
}

function catalog_fixture(count = 81) {
  return { sources: Array.from({ length: count }, (_, index) => ({ id: String(index), title: "日报" + index,
    description: "中文介绍", website: "https://example.com/", feed_url: "https://example.com/feed/" + index,
    source_type: index < 61 ? "zhihu" : "x", tags: index < 41 ? ["科技", "文章"] : ["科技"],
  })), tags: ["科技", "文章", "自定义"], platforms: [
    { id: "website", label: "网页" }, { id: "zhihu", label: "知乎" }, { id: "x", label: "X" },
  ] };
}

const ids = model => Array.from(model.state.feeds.value, feed => feed.source_id);

test("hydration 前已按 URL 初始化筛选和页码，挂载后保持同一批结果", async () => {
  const model = model_fixture(() => { throw Error("不能请求目录"); },
    "https://discover.example/?page=2&q=日报&source_type=zhihu&tag=科技&tag=文章", catalog_fixture());
  assert.equal(model.state.query.value, "日报");
  assert.equal(model.state.selected_platform.value, "zhihu");
  assert.equal(model.state.page.value, 1);
  assert.equal(model.state.total_count.value, 61);
  assert.deepEqual(ids(model), Array.from({ length: 20 }, (_, index) => String(index + 20)));
  const initial_ids = ids(model);
  await model.methods.init();
  assert.deepEqual(ids(model), initial_ids);
  assert.equal(model.navigation.entries.length, 1);
});

test("旧 URL 的标签不参与首页筛选，初始化时清除参数", async () => {
  const restored = model_fixture(() => {}, "https://discover.example/?tag=旧标签", {
    sources: [{ id: "a", feed_url: "https://example.com/feed", tags: ["源标签"] }], tags: [],
  });
  assert.deepEqual(ids(restored), ["a"]);
  await restored.methods.init();
  assert.deepEqual(ids(restored), ["a"]);
  assert.equal(new URL(restored.navigation.location.href).searchParams.has("tag"), false);
  assert.equal(restored.navigation.entries.length, 1);
});

test("平台列表默认网页，空源目录仍展示脚本平台，自定义平台支持 URL 恢复和筛选", async () => {
  const empty = model_fixture(() => {}, undefined, { sources: [], tags: [] });
  assert.deepEqual(Array.from(empty.state.platforms.value, platform => platform.label), ["网页"]);
  const catalog = { sources: [{ id: "a", title: "独立", feed_url: "https://example.com/feed", source_type: "独立平台" }],
    platforms: [{ id: "zhihu", label: "知乎" }, { id: "独立平台", label: "独立平台" }], tags: [] };
  const model = model_fixture(() => {}, "https://discover.example/?source_type=" + encodeURIComponent("独立平台"), catalog);
  await model.methods.init();
  assert.equal(model.state.selected_platform.value, "独立平台");
  assert.deepEqual(ids(model), ["a"]);
  assert.ok(model.state.platforms.value.some(platform => platform.id === "zhihu"));
  await model.methods.select_platform("zhihu");
  assert.equal(model.state.total_count.value, 0);
});

test("前台本地默认值由接口列表完整替换，保留接口名称且不从源推导平台", async () => {
  let finish;
  const model = model_fixture(() => new Promise(resolve => { finish = resolve; }));
  assert.deepEqual(Array.from(model.state.platforms.value, platform => platform.label), ["网页"]);
  const pending = model.methods.init();
  finish(Response.json({ sources: [{ id: "a", feed_url: "https://example.com/feed", source_type: "x" }], tags: [],
    platforms: [{ id: "custom", label: "接口平台名称" }, { id: "zhihu", label: "接口知乎名称" }] }));
  await pending;
  assert.deepEqual(JSON.parse(JSON.stringify(model.state.platforms.value)), [
    { id: "custom", label: "接口平台名称" }, { id: "zhihu", label: "接口知乎名称" },
  ]);
  await model.methods.select_platform("x");
  assert.equal(model.state.selected_platform.value, "");
});

test("内嵌完整目录直接呈现首屏，搜索、筛选、分页不发请求", async () => {
  let calls = 0;
  const model = model_fixture(() => { calls++; throw new Error("不能请求目录"); }, undefined, catalog_fixture());
  assert.equal(model.state.feeds.value.length, 20);
  await model.methods.init();
  assert.equal(model.state.total_count.value, 81);
  await model.methods.select_page(1);
  assert.equal(ids(model)[0], "20");
  await model.methods.select_platform("zhihu");
  assert.equal(model.state.page.value, 0);
  assert.equal(model.state.total_count.value, 61);
  await model.methods.select_page(2);
  assert.deepEqual(ids(model), Array.from({ length: 20 }, (_, index) => String(index + 40)));
  await model.methods.submit_search("日报1");
  assert.equal(model.state.page.value, 0);
  assert.equal(model.state.total_count.value, 11);
  await model.methods.select_platform("x");
  assert.equal(model.state.total_count.value, 0);
  await model.methods.submit_search("");
  assert.equal(model.state.total_count.value, 20);
  assert.equal(calls, 0);
});

test("本地搜索匹配标题、介绍、站点、订阅地址和标签，通配符按字面搜索", async () => {
  const catalog = { sources: [{ id: "a", title: "Test%_源", description: "独有介绍", website: "https://site.example",
    feed_url: "https://feed.example/rss/a", tags: ["自定义"], source_type: "website" }], tags: ["自定义"] };
  const model = model_fixture(() => { throw Error("不能请求"); }, undefined, catalog);
  for (const query of ["test", "%_", "独有", "SITE.EXAMPLE", "/rss/a", "自定义"]) {
    await model.methods.submit_search(query);
    assert.deepEqual(ids(model), ["a"]);
  }
  await model.methods.submit_search("未命中");
  assert.equal(model.state.total_count.value, 0);
});

test("没有内嵌目录时只请求一次，加载中筛选共用请求并应用最新选择", async () => {
  let finish, calls = 0;
  const model = model_fixture(url => { calls++; assert.equal(url, "/api/catalog"); return new Promise(resolve => { finish = resolve; }); });
  const first = model.methods.init();
  const second = model.methods.select_platform("x");
  finish(Response.json(catalog_fixture()));
  await Promise.all([first, second]);
  assert.equal(model.state.selected_platform.value, "x");
  assert.equal(model.state.total_count.value, 20);
  await model.methods.select_platform("zhihu");
  assert.equal(calls, 1);
  assert.equal(model.state.loading.value, false);
});

test("URL 恢复页码与筛选，前进后退及刷新恢复本地列表，保留其他参数", async () => {
  const fetch = () => { throw new Error("不能请求"); };
  const catalog = catalog_fixture();
  const model = model_fixture(fetch, "https://discover.example/?page=2&q=日报&source_type=zhihu&tag=科技&tag=文章&from=share#list", catalog);
  await model.methods.init();
  assert.equal(model.state.page.value, 1);
  assert.equal(ids(model)[0], "20");
  assert.equal(model.navigation.entries.length, 1);
  await model.methods.select_page(2);
  const url = new URL(model.navigation.location.href);
  assert.equal(url.searchParams.get("page"), "3");
  assert.equal(url.searchParams.get("from"), "share");
  assert.equal(url.searchParams.has("tag"), false);
  assert.equal(url.hash, "#list");
  await model.navigation.go(-1);
  assert.equal(model.state.page.value, 1);
  await model.navigation.go(1);
  assert.equal(model.state.page.value, 2);
  await model.methods.select_platform("x");
  assert.equal(model.state.page.value, 0);
  await model.navigation.go(-1);
  assert.equal(model.state.selected_platform.value, "zhihu");
  assert.equal(model.state.page.value, 2);
  const refreshed = model_fixture(fetch, model.navigation.location.href, catalog);
  await refreshed.methods.init();
  assert.equal(refreshed.state.page.value, 2);
});

test("无效页码回首页，越界修正末页，目录加载失败后可重试且不修改 URL", async () => {
  for (const value of ["0", "-1", "abc", "2.5", "Infinity", "99999999999999999999", "999"]) {
    const model = model_fixture(() => { throw Error("不能请求"); }, "https://discover.example/?page=" + value, catalog_fixture(41));
    await model.methods.init();
    assert.equal(model.state.page.value, value === "999" ? 2 : 0);
    assert.equal(model.navigation.entries.length, 1);
  }
  let calls = 0;
  const model = model_fixture(async () => ++calls === 1 ? Response.json({ error: "offline" }, { status: 503 }) : Response.json(catalog_fixture()));
  await model.methods.select_platform("x");
  assert.equal(model.navigation.entries.length, 1);
  assert.equal(model.state.error.value, "offline");
  await model.methods.init();
  assert.equal(model.state.total_count.value, 81);
  assert.equal(calls, 2);
});

test("每个平台及全部选项都有同源 SVG", () => {
  for (const platform of ["all", ...Object.keys(DISCOVERY_PLATFORM_LABELS)]) {
    const svg = readFileSync(new URL("../../public/platform-icons/" + platform + ".svg", import.meta.url), "utf8");
    assert.match(svg, /<svg[^>]+viewBox=/);
    assert.doesNotMatch(svg, /<symbol|<script|onload=/);
    assert.match(svg, /data-n=/);
  }
});
