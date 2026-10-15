import { page_source } from "./page_source.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFileSync } from "node:fs";

function fixture(create_response) {
  const requests = [];
  const access_tokens = [];
  const statistics = { script_count: 200, source_count: 700, source_call_count: 1234,
    cookie_count: 3, route_count: 8, platform_count: 4, tag_count: 6,
    sources: [{ id: "a", title: "源", feed_url: "https://feeds.example/rss/a", enabled: true, tracked: true, call_count: 1234 }] };
  const context = vm.createContext({ URL, setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {} });
  context.window = context;
  context.document = { querySelector: () => null };
  vm.runInContext(readFileSync(new URL("../../public/assets/timeless/0.34.2/timeless.umd.min.js", import.meta.url), "utf8"), context);
  const ui = context.Timeless;
  const element = (props, children = []) => ({ props, children });
  Object.assign(ui, { DOM: {}, View: element, Button: element, Input: element, Select: element,
    Dialog: (props, children) => element(props, [...children, ...props.footer]),
    Show: ({ when, ok }) => ({ props: {}, get children() { return when.value ? [ok()] : []; } }),
    For: ({ each, render }) => element({}, each.value.map((row, index) => render(row, { value: index }))) });
  context.FindRSSAdminUI = { ...ui, ui: { ...ui.ui, DialogPrimitive: { Root: props => element(props) } } };
  Object.assign(context, { vm: ui.vm, kit: ui.kit, ui: context.FindRSSAdminUI.ui });
  context.FindRSSAdminShell = { Page: element };
  context.FindRSSAdminPages = {};
  context.FindRSSAdminAuth = { fetch: async (url, options) => {
    requests.push(url);
    if (options?.method === "POST") return create_response(options);
    return Response.json({ devices: [], methods: [], task_counts: [], access_tokens, statistics });
  } };
  vm.runInContext(page_source("dashboard.js")
    + "\nglobalThis.model = DashboardViewModel(); globalThis.source_view = SourceCallsView; globalThis.metrics_view = MetricsView; globalThis.token_view = AccessTokenManagementView;", context);
  return { context, model: context.model, statistics, access_tokens, requests, ui };
}

function nodes(view) {
  return [view, ...(view.children || []).filter(child => child && typeof child === "object" && child.props).flatMap(nodes)];
}

test("概览 Model 仅从快照刷新指标和调用明细，后续刷新更新计数", async () => {
  const f = fixture();
  await f.model.methods.refresh();
  assert.deepEqual(f.requests, ["/admin/api/overview"]);
  for (const field of ["script_count", "source_count", "source_call_count", "cookie_count", "route_count", "platform_count", "tag_count"])
    assert.equal(f.model.state.metrics.value[field], f.statistics[field]);
  assert.equal(f.model.state.source_calls.value[0].call_count, 1234);
  f.statistics.source_call_count = 1235;
  f.statistics.sources[0].call_count = 1235;
  await f.model.methods.refresh(false);
  assert.equal(f.model.state.metrics.value.source_call_count, 1235);
  assert.equal(f.model.state.source_calls.value[0].call_count, 1235);
});

test("概览 View 渲染全部指标、每源次数、停用与外部源提示、空列表和可访问滚动区", async () => {
  const f = fixture();
  await f.model.methods.refresh();
  const metrics = nodes(f.context.metrics_view({ metrics: f.model.state.metrics }));
  for (const name of ["scripts", "discovery-sources", "source-calls", "cookies", "routes", "platforms", "tags"])
    assert.ok(metrics.some(node => node.props.attributes?.n === name + "-metric"));
  const sources = f.ui.refarr([...f.statistics.sources,
    { id: "b", title: "外部", feed_url: "https://example.com/feed", enabled: false, tracked: false, call_count: 0 }]);
  const rows = nodes(f.context.source_view({ sources }));
  assert.deepEqual(rows.filter(node => node.props.attributes?.n === "source-statistics-count").map(node => node.children[0]), ["1234", "外部源 · 无法统计"]);
  assert.ok(rows.some(node => node.children?.includes("外部（已停用）")));
  assert.ok(rows.some(node => node.props.attributes?.n === "source-statistics-scroll" && node.props.attributes.tabindex === "0"));
  assert.ok(rows.every(node => node.props.attributes?.n || !node.children.length || !node.props.class));
  sources.assign([]);
  assert.ok(nodes(f.context.source_view({ sources })).some(node => node.children?.includes("暂无订阅源")));
});

test("概览移除在线方法容器与 Token 抽屉，独立 Token 页面显示列表，创建入口打开弹窗", async () => {
  const f = fixture();
  const overview = f.context.OverviewPage();
  const overview_nodes = nodes(overview).concat(overview.props.actions);
  for (const name of ["api-summary", "api-method-summary", "open-access-token-drawer-button", "access-token-management", "access-token-drawer-root"])
    assert.equal(overview_nodes.some(node => node.props.attributes?.n === name), false, name);
  assert.ok(overview_nodes.some(node => node.props.attributes?.n === "source-statistics"));

  const tokens = f.context.TokensPage();
  assert.equal(tokens.props.page_id, "tokens");
  assert.equal(tokens.props.title, "Token");
  assert.equal(tokens.props.count.value, "0");
  const token_nodes = nodes(tokens);
  for (const name of ["token-management-view", "access-token-management", "access-token-list", "confirm-dialog-root"])
    assert.ok(token_nodes.some(node => node.props.attributes?.n === name), name);
  assert.equal(token_nodes.some(node => node.props.attributes?.n === "access-token-create-form"), false);
  tokens.props.actions.find(node => node.props.attributes?.n === "open-access-token-create-button").props.onClick();
  const dialog_nodes = nodes(tokens);
  for (const name of ["access-token-create-dialog", "access-token-create-form", "create-access-token-button"])
    assert.ok(dialog_nodes.some(node => node.props.attributes?.n === name), name);
  dialog_nodes.find(node => node.props.attributes?.n === "cancel-access-token-button").props.onClick();
  assert.equal(nodes(tokens).some(node => node.props.attributes?.n === "access-token-create-form"), false);
  assert.equal(token_nodes.some(node => node.props.attributes?.n === "overview-metrics"), false);
  tokens.children[0].props.onMounted();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(f.requests, ["/admin/api/overview"]);
  f.access_tokens.push({ id: "test-token", name: "测试 Token" });
  await tokens.props.actions.find(node => node.props.attributes?.n === "refresh-button").props.onClick();
  assert.equal(f.requests.length, 2);
  assert.equal(tokens.props.count.value, "1");
  tokens.children[0].props.onUnmounted();
});

test("Token 弹窗保留校验与失败提示，提交时防止关闭和重复请求，成功后回到列表展示明文", async () => {
  let finish_create, fail = true, body;
  const f = fixture(options => {
    body = JSON.parse(options.body);
    if (fail) return Response.json({ error: "Token 已存在" }, { status: 409 });
    return new Promise(resolve => { finish_create = () => {
      const access_token = { id: "new-token", name: "测试", status: "active" };
      f.access_tokens.push(access_token);
      resolve(Response.json({ access_token, token: "new-token-plaintext" }));
    }; });
  });
  const model = f.model;
  model.methods.openAccessTokenForm();
  model.methods.setAccessTokenDraft("token", "short");
  await model.methods.createAccessToken();
  assert.equal(f.requests.length, 0);
  assert.equal(model.state.access_token_form_open.value, true);
  assert.match(model.state.access_token_action.value.error, /16–256/);
  model.methods.setAccessTokenDraft("token", "");
  model.methods.setAccessTokenDraft("name", "测试");
  await model.methods.createAccessToken();
  assert.equal(model.state.access_token_form_open.value, true);
  const view = f.context.token_view({ store: model });
  assert.ok(nodes(view).some(node => node.props.attributes?.n === "access-token-error" && node.children[0].value === "Token 已存在"));
  const dialog = nodes(view).find(node => node.props.attributes?.n === "access-token-create-dialog");
  assert.ok(dialog.props.footer.flatMap(nodes).some(node => node.props.attributes?.n === "access-token-error"));
  model.methods.closeAccessTokenForm();
  assert.equal(model.state.access_token_form_open.value, false);
  assert.equal(model.state.access_token_action.value.error, "");
  model.methods.openAccessTokenForm();
  fail = false;
  const pending = model.methods.createAccessToken();
  assert.equal(model.state.access_token_action.value.creating, true);
  model.methods.closeAccessTokenForm();
  assert.equal(model.state.access_token_form_open.value, true);
  await model.methods.createAccessToken();
  assert.equal(f.requests.length, 2);
  finish_create();
  await pending;
  assert.equal(body.name, "测试");
  assert.equal(model.state.access_token_form_open.value, false);
  assert.equal(model.state.access_tokens.value[0].id, "new-token");
  assert.equal(model.state.access_token_action.value.created_token, "new-token-plaintext");
  assert.ok(nodes(view).some(node => node.props.attributes?.n === "created-access-token"));
  model.methods.dismissCreatedAccessToken();
  assert.equal(model.state.access_token_action.value.created_token, "");
  model.methods.dispose();
});
