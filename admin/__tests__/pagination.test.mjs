import { PollPolicyView, poll_policy_label } from "../components/poll_policy.js";
import { PollPolicyModel } from "../components/poll_policy.model.js";
import { page_source } from "./page_source.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { PaginationModel, PaginationView } from "../components/pagination.js";
import { ScriptAgentModel } from "../components/script_agent.js";
import * as platform_helpers from "../components/discovery_platform.js";
import { RssRoutePatternModel } from "../../server/domain/rss_route.js";

// Use the shipped reactive runtime without starting a browser.
function fixture(file, factory, fetch = async () => Response.json({})) {
  const context = vm.createContext({ ...platform_helpers, PollPolicyView, poll_policy_label, PollPolicyModel, RssRoutePatternModel, PaginationModel, PaginationView, ScriptAgentModel, URL, URLSearchParams, File,
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {} });
  context.window = context;
  context.document = { querySelector: () => null, readyState: "loading", addEventListener() {} };
  vm.runInContext(readFileSync(new URL("../../public/assets/timeless/0.34.2/timeless.umd.min.js", import.meta.url), "utf8"), context);
  const ui = context.Timeless;
  ui.DOM = {};
  const element = (props, children = []) => ({ props, children });
  Object.assign(ui, { View: element, Button: element, Select: element, Field: element, Img: element });
  context.FindRSSAdminUI = ui;
  context.FindRSSAdminAuth = { fetch };
  context.FindRSSAdminShell = {};
  context.FindRSSAdminPages = {};
  context.localStorage = { getItem: () => null };
  context.confirm = () => true;
  if (!file) return { ui };
  const source = page_source(file);
  vm.runInContext(source + "\nglobalThis.model = " + factory + "();", context);
  return { model: context.model, ui, context };
}

function ids(items) { return Array.from(items, item => item.id); }

test("共享分页处理空列表、末页、条数切换和加载中的按钮状态", () => {
  const { ui } = fixture();
  const total = ui.ref(0), loading = ui.ref(false);
  const model = PaginationModel(ui, { total, loading });
  const view = PaginationView(ui, { model, name: "test-pagination", label: "列表分页" });
  const controls = view.children.find(child => child.props.attributes.n === "test-pagination-controls")
    .children.find(child => child.props.attributes.n === "test-pagination-pages").children;
  assert.equal(model.state.value.first, 0);
  assert.equal(model.state.value.last, 0);
  assert.equal(model.state.value.pages, 1);
  assert.equal(controls[0].props.disabled.value, true);
  assert.equal(controls[3].props.disabled.value, true);
  total.set(456);
  assert.equal(model.state.value.pages, 23);
  controls.at(-1).props.onClick();
  assert.equal(model.state.value.page, 22);
  assert.equal(model.state.value.first, 441);
  assert.equal(model.state.value.last, 456);
  assert.equal(controls[0].props.disabled.value, false);
  assert.equal(controls[3].props.disabled.value, true);
  model.set_page_size(50);
  assert.equal(model.state.value.page, 0);
  assert.equal(model.state.value.pages, 10);
  model.set_page_size(500);
  assert.equal(model.page_size.value, 50);
  loading.set(true);
  assert.equal(controls[3].props.disabled.value, true);
  model.set_page(1);
  assert.equal(model.state.value.page, 0);
});

test("订阅源先在全部数据中筛选再分页，编辑、删除末页与新增均正确", async () => {
  const rows = Array.from({ length: 41 }, (_, index) => ({ id: "source-" + index, title: "源 " + index,
    source_type: index === 40 ? "zhihu" : "website", tags: [], enabled: true }));
  const { model } = fixture("discovery.js", "DiscoveryAdminViewModel", async (url, options) => {
    if (options?.method === "POST") return Response.json({ source: { id: "new", title: "新增", enabled: true } });
    return Response.json({ sources: rows });
  });
  await model.methods.refresh_list();
  assert.deepEqual(ids(model.paged_sources.value), ids(rows.slice(0, 20)));
  model.pagination.set_page(2);
  assert.deepEqual(ids(model.paged_sources.value), ["source-40"]);
  model.methods.edit_source("source-40");
  assert.equal(model.state.editing_id.value, "source-40");
  model.methods.close_form();
  model.methods.set_filter("platform", "zhihu");
  assert.equal(model.pagination.state.value.page, 0);
  assert.equal(model.pagination.state.value.total, 1);
  assert.deepEqual(ids(model.paged_sources.value), ["source-40"]);
  model.methods.set_filter("platform", "all");
  model.pagination.set_page(2);
  await model.methods.remove_source("source-40");
  assert.equal(model.pagination.state.value.page, 1);
  assert.equal(model.paged_sources.value.length, 20);
  model.methods.create_source();
  model.methods.set_draft("title", "新增");
  await model.methods.save_source();
  assert.equal(model.pagination.state.value.page, 0);
  assert.equal(model.paged_sources.value[0].id, "new");
});

test("订阅源 JSON 导出所有源，不受筛选和分页影响，保留模板且清理下载资源", async () => {
  const rows = Array.from({ length: 41 }, (_, index) => ({ id: "source-" + index, title: "科技 " + index,
    source_type: "zhihu", tags: ["科技"], enabled: true, require_token: index === 0,
    feed_url: "https://feeds.example/rss/people/" + index,
    feed_url_template: index === 0 ? "{{hostname}}/rss/people/0" : "",
    cache: { status: "cached" }, snapshot: { saved_at: 10, articles: [{ title: "快照" }] },
  }));
  rows.push({ id: "disabled", title: "停用网站", source_type: "website", enabled: false, tags: [], feed_url: "https://example.com/feed" });
  const { model, context } = fixture("discovery.js", "DiscoveryAdminViewModel", async () => Response.json({ sources: rows }));
  const downloads = [], blobs = [], cleanup = [], timers = [];
  let fail = false;
  context.Blob = Blob;
  context.URL = { createObjectURL(blob) { blobs.push(blob); return "blob:export-" + blobs.length; },
    revokeObjectURL(url) { cleanup.push(url); } };
  context.setTimeout = callback => { timers.push(callback); };
  context.document.createElement = tag => {
    assert.equal(tag, "a");
    return { setAttribute(name, value) { assert.equal(name, "data-n"); assert.equal(value, "discovery-source-export-download"); },
      click() { if (fail) throw new Error("download blocked"); downloads.push({ href: this.href, filename: this.download }); } };
  };
  await model.methods.refresh_list();
  model.methods.set_filter("platform", "zhihu");
  model.methods.set_filter("query", "科技");
  model.pagination.set_page(2);
  assert.equal(model.paged_sources.value.length, 1);
  model.methods.export_sources();
  assert.match(downloads[0].filename, /^findrss-sources-\d{4}-\d{2}-\d{2}\.json$/);
  assert.equal(blobs[0].type, "application/json;charset=utf-8");
  const exported = JSON.parse(await blobs[0].text());
  assert.equal(exported.sources.length, 42);
  assert.equal(exported.sources.at(-1).enabled, false, "导出包含被筛选掉的停用源");
  assert.equal(exported.sources[0].feed_url, "{{hostname}}/rss/people/0");
  assert.equal(exported.sources[0].require_token, true);
  assert.deepEqual(exported.sources[0].tags, ["科技"]);
  assert.equal("cache" in exported.sources[0], false);
  assert.equal("snapshot" in exported.sources[0], false);
  assert.equal(model.state.sources.value[0].feed_url, rows[0].feed_url);
  assert.ok(model.state.sources.value[0].snapshot.articles.length);
  timers.shift()();
  assert.deepEqual(cleanup, ["blob:export-1"]);

  model.methods.set_filter("query", "");
  model.methods.set_filter("platform", "website");
  assert.equal(model.visible_sources.value.length, 0);
  model.methods.export_sources();
  assert.equal(downloads.length, 2, "筛选无结果仍可导出所有源");
  assert.deepEqual(JSON.parse(await blobs[1].text()), exported);
  timers.shift()();
  model.state.loading.set(true);
  model.methods.export_sources();
  assert.equal(downloads.length, 2, "加载中不触发下载");
  model.state.loading.set(false);
  fail = true;
  model.methods.export_sources();
  assert.match(model.state.list_error.value, /导出失败：download blocked/);
  timers.shift()();
  assert.deepEqual(cleanup, ["blob:export-1", "blob:export-2", "blob:export-3"]);
});

test("订阅源列表显示 JSON 导出入口，无数据或加载中禁用", () => {
  const { context } = fixture("discovery.js", "DiscoveryAdminViewModel");
  let page;
  context.FindRSSAdminShell.Page = options => { page = options; };
  vm.runInContext("DiscoveryPage()", context);
  const button = page.actions.find(action => action.props.attributes.n === "discovery-source-export-button");
  assert.deepEqual(Array.from(button.children), ["导出 JSON"]);
  assert.equal(button.props.disabled.value, true);
  assert.equal(typeof button.props.onClick, "function");
  assert.match(button.props.attributes.title, /导出所有订阅源/);
});

test("平台筛选 Select 使用数据库 SVG，切换选中平台后图标同步变化", () => {
  const { context, model, ui } = fixture("discovery.js", "DiscoveryAdminViewModel");
  const element = (props, children = []) => ({ props, children });
  Object.assign(ui, { Img: element, Input: element });
  const first_icon = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M1 2h3v4H1z"/></svg>';
  const second_icon = first_icon.replace("M1 2", "M3 4");
  model.state.platforms.set([{ id: "甲", label: "甲平台", icon: first_icon }, { id: "乙", label: "乙平台", icon: second_icon }]);
  context.root = vm.runInContext("FilterFormView({ store: model })", context);
  const field = context.root.children[1];
  const select = field.children[0];
  const option = select.props.render_option({ value: "甲", label: "甲平台" });
  assert.equal(option.children[0].props.src.value, "data:image/svg+xml," + encodeURIComponent(first_icon));
  const selected = select.props.render_value({ label: "选中平台" });
  model.methods.set_filter("platform", "甲");
  assert.equal(selected.children[0].props.src.value, "data:image/svg+xml," + encodeURIComponent(first_icon));
  model.methods.set_filter("platform", "乙");
  assert.equal(selected.children[0].props.src.value, "data:image/svg+xml," + encodeURIComponent(second_icon));
});

test("脚本跨页搜索附加路由，筛选回首页且删除末页不会留下空页", async () => {
  const rows = Array.from({ length: 41 }, (_, index) => ({ id: "script-" + index, name: "脚本 " + index,
    path: "/route/" + index, enabled: true, routes: [{ name: "路由", path: "/route/" + index },
      ...(index === 40 ? [{ name: "附加路由", path: "/extra/search" }] : [])] }));
  const { model } = fixture("script.js", "ScriptViewModel", async () => Response.json({ scripts: rows }));
  model.methods.start();
  await new Promise(setImmediate);
  assert.equal(model.paged_scripts.value.length, 20);
  model.pagination.set_page(2);
  assert.deepEqual(ids(model.paged_scripts.value), ["script-40"]);
  model.methods.set_filter("query", "/extra/search");
  assert.equal(model.pagination.state.value.page, 0);
  assert.deepEqual(ids(model.paged_scripts.value), ["script-40"]);
  model.methods.set_filter("query", "");
  model.pagination.set_page(2);
  await model.methods.remove_script("script-40");
  assert.equal(model.pagination.state.value.page, 1);
  assert.equal(model.paged_scripts.value.length, 20);
});

test("用户分页请求保留关键词，切换条数回首页，缩小后的末页自动回退", async () => {
  const calls = [];
  let total = 41;
  const { model } = fixture("users.js", "UsersViewModel", async url => {
    calls.push(url);
    const query = new URL(url, "https://admin").searchParams;
    const start = Number(query.get("offset")), size = Number(query.get("limit"));
    const users = Array.from({ length: Math.max(0, Math.min(size, total - start)) }, (_, index) => ({ id: "u" + (start + index) }));
    return Response.json({ total_count: total, users });
  });
  model.methods.setSearchText("alice");
  await model.methods.search();
  model.methods.setSearchText("尚未提交的关键词");
  await model.pagination.set_page(2);
  assert.match(calls.at(-1), /limit=20&offset=40&q=alice/);
  assert.equal(model.state.users.value.length, 1);
  total = 40;
  await model.methods.loadUsers();
  assert.match(calls.at(-1), /limit=20&offset=20&q=alice/);
  assert.equal(model.pagination.state.value.page, 1);
  await model.pagination.set_page_size(10);
  assert.match(calls.at(-1), /limit=10&offset=0&q=alice/);
  assert.equal(model.state.users.value.length, 10);
});

test("用户列表忽略旧请求，加载期间不提前解锁分页", async () => {
  const responses = [];
  const { model } = fixture("users.js", "UsersViewModel", () => new Promise(resolve => responses.push(resolve)));
  const first = model.methods.loadUsers();
  const second = model.methods.loadUsers();
  responses[0](Response.json({ total_count: 1, users: [{ id: "old" }] }));
  await first;
  assert.equal(model.state.loading.value, true);
  responses[1](Response.json({ total_count: 1, users: [{ id: "new" }] }));
  await second;
  assert.equal(model.state.loading.value, false);
  assert.deepEqual(ids(model.state.users.value), ["new"]);
});

test("兑换活动与卡片独立分页，切换活动时卡片回首页且忽略旧活动响应", async () => {
  const calls = [];
  let delayed_response;
  const { model } = fixture("redemptions.js", "RedemptionCardsViewModel", async url => {
    calls.push(url);
    const parsed = new URL(url, "https://admin"), offset = Number(parsed.searchParams.get("offset"));
    if (parsed.pathname === "/admin/api/redemption-campaigns") {
      return Response.json({ total_count: 41, campaigns: [{ id: offset ? "b" : "a", name: "活动" }] });
    }
    if (parsed.pathname.endsWith("/a") && offset === 40) return new Promise(resolve => { delayed_response = resolve; });
    return Response.json({ total_card_count: 41, cards: [{ id: parsed.pathname.endsWith("/b") ? "b-card" : "a-card" }] });
  });
  await model.methods.loadCampaigns();
  const previous = model.card_pagination.set_page(2);
  await model.methods.loadCampaign("b");
  assert.match(calls.at(-1), /\/b\?limit=20&offset=0$/);
  assert.equal(model.card_pagination.state.value.page, 0);
  delayed_response(Response.json({ total_card_count: 41, cards: [{ id: "old-a-card" }] }));
  await previous;
  assert.deepEqual(ids(model.state.cards.value), ["b-card"]);
  await model.campaign_pagination.set_page(1);
  assert.match(calls.at(-1), /redemption-campaigns\?limit=20&offset=20$/);
  assert.equal(model.campaign_pagination.state.value.page, 1);
  await model.card_pagination.set_page_size(10);
  assert.match(calls.at(-1), /\/b\?limit=10&offset=0$/);
});

test("兑换卡加载失败可继续翻页或重试，减少记录后自动回退有效页", async () => {
  let fail = false, total = 21;
  const calls = [];
  const { model } = fixture("redemptions.js", "RedemptionCardsViewModel", async url => {
    calls.push(url);
    return fail ? Response.json({ error: "加载失败" }, { status: 500 })
      : Response.json({ total_card_count: total, cards: [{ id: "card" }] });
  });
  await model.methods.loadCampaign("a");
  fail = true;
  await model.card_pagination.set_page(1);
  assert.equal(model.card_pagination.state.value.loading, false);
  assert.equal(model.card_pagination.state.value.page, 0);
  assert.equal(model.state.error.value, "加载失败");
  fail = false;
  await model.card_pagination.set_page(1);
  total = 20;
  await model.methods.loadCampaign("a");
  assert.match(calls.at(-1), /limit=20&offset=0$/);
  assert.equal(model.card_pagination.state.value.page, 0);
});
