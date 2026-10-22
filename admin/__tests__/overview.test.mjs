import { realtime_fixture } from "./realtime_fixture.mjs";
import { ListPaginationModel, PaginationModel, PaginationView } from "../components/pagination.js";
import { page_source } from "./page_source.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFileSync } from "node:fs";

function fixture(create_response, page_id = "overview", credit_response, task_response) {
  const requests = [];
  const intervals = [];
  const access_tokens = [];
  const statistics = { device_count: 9, online_count: 4, offline_count: 5, task_count: 42, token_count: 7,
    script_count: 200, source_count: 700, source_call_count: 1234,
    cookie_count: 3, route_count: 8, platform_count: 4, tag_count: 6,
    sources: [{ id: "a", title: "源", feed_url: "https://feeds.example/rss/a", enabled: true, tracked: true, call_count: 1234 }] };
  const context = vm.createContext({ ListPaginationModel, PaginationModel, PaginationView, URL, URLSearchParams, setTimeout: () => 0, clearTimeout() {},
    setInterval(callback, milliseconds) { intervals.push({ callback, milliseconds }); return intervals.length; }, clearInterval() {} });
  context.window = context;
  context.FindRSSAdminRealtime = realtime_fixture();
  context.document = { querySelector: () => null };
  vm.runInContext(readFileSync(new URL("../../public/assets/timeless/0.34.2/timeless.umd.min.js", import.meta.url), "utf8"), context);
  intervals.length = 0;
  const ui = context.Timeless;
  const element = (props, children = []) => ({ props, children });
  Object.assign(ui, { DOM: {}, View: element, Button: element, Input: element, Select: element,
    Popconfirm: props => element(props, [props.trigger({})]),
    EmptyCard: props => element({ attributes: { n: props.name } }, [props.title, props.description, ...props.actions]),
    Dialog: (props, children) => element(props, [...children, ...props.footer]),
    Show: ({ when, ok }) => ({ props: {}, get children() { return when.value ? [ok()] : []; } }),
    For: ({ each, render }) => ({ props: {}, get children() { return each.value.map((row, index) => render(row, { value: index })); } }) });
  context.FindRSSAdminUI = { ...ui, ui: { ...ui.ui, DialogPrimitive: { Root: props => element(props) } } };
  Object.assign(context, { vm: ui.vm, kit: ui.kit, ui: context.FindRSSAdminUI.ui });
  context.FindRSSAdminShell = { Page: element };
  context.FindRSSAdminPages = {};
  context.FindRSSAdminAuth = { fetch: async (url, options) => {
    requests.push(url);
    if (url.startsWith("/admin/api/tasks/")) return task_response(url);
    if (url.startsWith("/admin/api/credit-transactions?")) return credit_response(url, options);
    if (options?.method === "POST") return create_response(options);
    if (url.startsWith("/admin/api/access-tokens?")) {
      const params = new URL(url, "https://admin").searchParams;
      const offset = Number(params.get("offset")), limit = Number(params.get("limit"));
      return Response.json({ access_tokens: access_tokens.slice(offset, offset + limit), total_count: access_tokens.length });
    }
    return Response.json(url === "/admin/api/overview"
      ? { generated_at: 1000, statistics }
      : { devices: [], methods: [], task_counts: [], access_tokens, total_count: access_tokens.length });
  } };
  vm.runInContext(page_source("dashboard.js")
    + `\nglobalThis.model = DashboardViewModel(${JSON.stringify(page_id)}); globalThis.source_view = SourceCallsView; globalThis.metrics_view = MetricsView; globalThis.token_view = AccessTokenManagementView;`, context);
  return { context, model: context.model, statistics, access_tokens, requests, intervals, ui };
}

function nodes(view) {
  return [view, ...(view.children || []).filter(child => child && typeof child === "object" && child.props).flatMap(nodes)];
}

test("概览 Model 仅从快照刷新指标和调用明细，后续刷新更新计数", async () => {
  const f = fixture();
  await f.model.methods.refresh();
  assert.deepEqual(f.requests, ["/admin/api/overview"]);
  for (const field of ["device_count", "online_count", "offline_count", "task_count", "token_count", "script_count", "source_count", "source_call_count", "cookie_count", "route_count", "platform_count", "tag_count"])
    assert.equal(f.model.state.metrics.value[field], f.statistics[field]);
  assert.equal(f.model.state.source_calls.value[0].call_count, 1234);
  f.statistics.source_call_count = 1235;
  f.statistics.sources[0].call_count = 1235;
  await f.model.methods.refresh(false);
  assert.equal(f.model.state.metrics.value.source_call_count, 1235);
  assert.equal(f.model.state.source_calls.value[0].call_count, 1235);
});

test("设备页面不轮询，相关事件触发刷新并补同步请求期间的变化，隐藏后取消订阅", async () => {
  const f = fixture(undefined, "devices");
  f.model.methods.ready(); await new Promise(setImmediate);
  assert.equal(f.requests.length, 1); assert.equal(f.intervals.length, 0);
  await f.context.FindRSSAdminRealtime.emit({ type: "messages.changed" }); assert.equal(f.requests.length, 1);
  await f.context.FindRSSAdminRealtime.emit({ type: "devices.changed" }); assert.equal(f.requests.length, 2);
  await f.context.FindRSSAdminRealtime.emit({ type: "realtime.connected", reconnected: true }); assert.equal(f.requests.length, 3);
  f.model.methods.pause();
  await f.context.FindRSSAdminRealtime.emit({ type: "devices.changed" }); assert.equal(f.requests.length, 3);
  f.model.methods.ready(); await new Promise(setImmediate); assert.equal(f.requests.length, 4);
  f.model.methods.dispose(); assert.equal(f.context.FindRSSAdminRealtime.listeners.size, 0);
});

test("测试任务依赖状态推送，忽略其他任务与迟到旧响应，完成后不再查询", async () => {
  let reads = 0, finish_old;
  const f = fixture(() => Response.json({ task: { id: "test-task", status: "queued" } }), "devices", undefined,
    async () => {
      reads++;
      if (reads === 1) return new Promise(resolve => { finish_old = resolve; });
      return Response.json({ task: { id: "test-task", status: "completed", result: {} } });
    });
  f.model.methods.ready(); await new Promise(setImmediate);
  f.model.methods.setTestDraft("device", "url", "https://example.com/video");
  await f.model.methods.runTest("device");
  assert.equal(reads, 1); assert.equal(f.intervals.length, 0);
  await f.context.FindRSSAdminRealtime.emit({ type: "tasks.changed", ids: ["other"] }); assert.equal(reads, 1);
  await f.context.FindRSSAdminRealtime.emit({ type: "tasks.changed", ids: ["test-task"] });
  assert.equal(reads, 2); assert.equal(f.model.state.tests.value.device.task.status, "completed");
  finish_old(Response.json({ task: { id: "test-task", status: "queued" } })); await new Promise(setImmediate);
  assert.equal(f.model.state.tests.value.device.task.status, "completed");
  await f.context.FindRSSAdminRealtime.emit({ type: "tasks.changed", ids: ["test-task"] }); assert.equal(reads, 2);
  f.model.methods.dispose();
});

test("概览仅在打开和手动刷新时读取快照，不启动轮询，展示快照生成时间", async () => {
  const f = fixture();
  f.model.methods.ready();
  f.model.methods.ready();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(f.requests, ["/admin/api/overview"]);
  assert.equal(f.intervals.length, 0);
  assert.equal(f.model.state.generated_at.value, 1000);
  const status = f.model.state.refresh_status.value;
  assert.equal(status, "快照生成于 " + vm.runInContext("format_time(1000)", f.context));
  await f.model.methods.refresh();
  assert.equal(f.requests.length, 2);
  assert.equal(f.model.state.refresh_status.value, status);
  assert.equal(f.intervals.length, 0);
  const overview = f.context.OverviewPage();
  assert.ok(nodes(overview).some(node => node.children?.includes("统计快照每 5 分钟生成一次，生成后自动更新，也可手动刷新")));
  f.model.methods.dispose();
});

test("概览 View 渲染全部指标、每源次数、停用与外部源提示、空列表和可访问滚动区", async () => {
  const f = fixture();
  await f.model.methods.refresh();
  const metrics = nodes(f.context.metrics_view({ metrics: f.model.state.metrics }));
  for (const name of ["scripts", "discovery-sources", "source-calls", "cookies", "routes", "platforms", "tags"])
    assert.ok(metrics.some(node => node.props.attributes?.n === name + "-metric"));
  const sources = f.ui.refarr([...f.statistics.sources,
    { id: "b", title: "外部", feed_url: "https://example.com/feed", enabled: false, tracked: false, call_count: 0 }]);
  const rows = nodes(f.context.source_view({ sources, pagination: f.model.source_calls_pagination }));
  assert.deepEqual(rows.filter(node => node.props.attributes?.n === "source-statistics-count").map(node => node.children[0]), ["1234", "外部源 · 无法统计"]);
  assert.ok(rows.some(node => node.children?.includes("外部（已停用）")));
  assert.ok(rows.some(node => node.props.attributes?.n === "source-statistics-scroll" && node.props.attributes.tabindex === "0"));
  assert.ok(rows.every(node => node.props.attributes?.n || !node.children.length || !node.props.class));
  sources.assign([]);
  assert.ok(nodes(f.context.source_view({ sources, pagination: f.model.source_calls_pagination })).some(node => node.children?.includes("暂无订阅源")));
});

test("订阅源调用次数每页默认 20 条，翻页不请求接口，刷新保留或回退有效页", async () => {
  const f = fixture();
  f.statistics.sources = Array.from({ length: 41 }, (_, index) => ({ ...f.statistics.sources[0], id: String(index), title: "源 " + index }));
  await f.model.methods.refresh();
  const pagination = f.model.source_calls_pagination;
  const view = f.context.source_view({ sources: f.model.paged_source_calls, pagination });
  const rows = () => nodes(view).filter(node => node.props.attributes?.n === "source-statistics-row");
  const control = suffix => nodes(view).find(node => node.props.attributes?.n === "source-calls-pagination-" + suffix);
  assert.equal(rows().length, 20);
  assert.equal(pagination.state.value.total, 41);
  control("next").props.onClick();
  assert.equal(f.model.paged_source_calls.value[0].id, "20");
  await f.model.methods.refresh();
  assert.equal(pagination.state.value.page, 1);
  control("last").props.onClick();
  assert.equal(rows().length, 1);
  assert.equal(control("next").props.disabled.value, true);
  assert.equal(f.requests.length, 2);
  f.statistics.sources.pop();
  await f.model.methods.refresh();
  assert.equal(pagination.page.value, 1);
  assert.equal(rows().length, 20);
  control("size").props.onChange({ target: { value: "10" } });
  assert.equal(pagination.state.value.page, 0);
  assert.equal(rows().length, 10);
  assert.equal(f.model.state.metrics.value.source_call_count, 1234);
  f.statistics.sources = [];
  await f.model.methods.refresh();
  assert.equal(rows().length, 0);
  assert.equal(pagination.state.value.first, 0);
  assert.equal(control("prev").props.disabled.value, true);
  assert.ok(nodes(view).some(node => node.children?.includes("暂无订阅源")));
  f.model.methods.dispose();
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
  assert.deepEqual(Array.from(tokens.props.actions, node => node.props.attributes?.n), ["open-access-token-create-button"]);
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
  assert.deepEqual(f.requests, ["/admin/api/access-tokens?limit=20&offset=0"]);
  assert.deepEqual(f.intervals.map(interval => interval.milliseconds), []);
  f.access_tokens.push({ id: "test-token", name: "测试 Token" });
  await f.context.FindRSSAdminRealtime.emit({ type: "tokens.changed" });
  await new Promise(resolve => setImmediate(resolve));
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
  }, "tokens");
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

test("Token 页面使用 ListCore 后端分页，翻页与修改条数不读取全量管理概览", async () => {
  const f = fixture(undefined, "tokens");
  f.access_tokens.push(...Array.from({ length: 41 }, (_, index) => ({ id: "t" + index, name: "Token " + index })));
  await f.model.methods.refresh();
  assert.ok(f.model.token_pagination.list instanceof f.ui.kit.ListCore);
  assert.equal(f.model.state.access_tokens.value.length, 20);
  assert.equal(f.model.token_pagination.state.value.total, 41);
  await f.model.token_pagination.set_page(2);
  assert.deepEqual(Array.from(f.model.state.access_tokens.value, token => token.id), ["t40"]);
  assert.equal(f.requests.at(-1), "/admin/api/access-tokens?limit=20&offset=40");
  f.access_tokens.pop();
  await f.model.methods.refresh();
  assert.equal(f.model.token_pagination.state.value.page, 1);
  assert.equal(f.requests.at(-1), "/admin/api/access-tokens?limit=20&offset=20");
  await f.model.token_pagination.set_page_size(10);
  assert.equal(f.requests.at(-1), "/admin/api/access-tokens?limit=10&offset=0");
  assert.equal(f.model.state.access_tokens.value.length, 10);
  assert.ok(f.requests.every(url => url.startsWith("/admin/api/access-tokens?")));
  f.model.methods.dispose();
});

test("Token 列表隐藏脱敏值，查看按钮按 Token 查询积分流水并展示金额、余额与分页", async () => {
  const pages = [
    { credit_transactions: [{ id: "c2", type: "charge", amount: -2, balance_after: 8, subject: "订阅源 A", created_at: 2000 }], next_cursor: "2000_c2" },
    { credit_transactions: [{ id: "c1", type: "grant", amount: 10, balance_after: 10, note: "初始积分", created_at: 1000 }], next_cursor: null },
  ];
  const f = fixture(undefined, "tokens", (url, options) => {
    assert.equal(new URL(url, "https://admin").searchParams.get("access_token_id"), "t1");
    assert.equal(options.cache, "no-store");
    return Response.json(pages.shift());
  });
  f.access_tokens.push({ id: "t1", name: "合作方", token_hint: "abcd…wxyz" });
  await f.model.methods.refresh();
  const view = f.context.token_view({ store: f.model });
  assert.equal(nodes(view).some(node => node.props.attributes?.n === "access-token-hint"), false);
  const button = nodes(view).find(node => node.props.attributes?.n === "view-access-token-button");
  assert.deepEqual(Array.from(button.children), ["查看"]);
  await button.props.onClick();
  const log_nodes = nodes(view);
  assert.ok(log_nodes.some(node => node.props.attributes?.n === "access-token-logs-dialog"));
  assert.ok(log_nodes.some(node => node.props.attributes?.n === "access-token-log-subject" && node.children[0] === "订阅源 A"));
  assert.ok(log_nodes.some(node => node.props.attributes?.n === "access-token-log-amount" && node.children[0] === "-2 积分"));
  assert.ok(log_nodes.some(node => node.props.attributes?.n === "access-token-log-balance" && node.children[0] === "余额 8"));
  await log_nodes.find(node => node.props.attributes?.n === "load-more-access-token-logs-button").props.onClick();
  assert.equal(new URL(f.requests.at(-1), "https://admin").searchParams.get("cursor"), "2000_c2");
  assert.deepEqual(Array.from(f.model.state.access_token_logs.value, row => row.id), ["c2", "c1"]);
  assert.equal(nodes(view).some(node => node.props.attributes?.n === "load-more-access-token-logs-button"), false);
  nodes(view).find(node => node.props.attributes?.n === "close-access-token-logs-button").props.onClick();
  assert.equal(f.model.state.access_token_logs.value.length, 0);
  assert.equal(nodes(view).some(node => node.props.attributes?.n === "access-token-logs-dialog"), false);
  f.model.methods.dispose();
});

test("积分日志区分加载、空结果和错误，失败可重试，阻止重复加载", async () => {
  let finish;
  const f = fixture(undefined, "tokens", () => new Promise(resolve => { finish = resolve; }));
  f.access_tokens.push({ id: "t1", name: "测试" });
  await f.model.methods.refresh();
  const pending = f.model.methods.openAccessTokenLogs("t1");
  const view = f.context.token_view({ store: f.model });
  assert.ok(nodes(view).some(node => node.props.attributes?.n === "access-token-logs-loading"));
  assert.equal(nodes(view).some(node => node.props.attributes?.n === "access-token-logs-empty"), false);
  await f.model.methods.refreshAccessTokenLogs();
  assert.equal(f.requests.length, 2);
  finish(Response.json({ error: "读取失败" }, { status: 500 }));
  await pending;
  assert.equal(f.model.state.access_token_log_state.value.error, "读取失败");
  assert.equal(nodes(view).some(node => node.props.attributes?.n === "access-token-logs-empty"), false);
  const retry = f.model.methods.refreshAccessTokenLogs();
  finish(Response.json({ credit_transactions: [], next_cursor: null }));
  await retry;
  assert.equal(f.model.state.access_token_log_state.value.error, "");
  assert.ok(nodes(view).some(node => node.props.attributes?.n === "access-token-logs-empty"));
  f.model.methods.dispose();
});

test("切换 Token、关闭和销毁后忽略迟到的积分日志响应", async () => {
  const pending_responses = [];
  const f = fixture(undefined, "tokens", () => new Promise(resolve => pending_responses.push(resolve)));
  f.access_tokens.push({ id: "t1", name: "一" }, { id: "t2", name: "二" });
  await f.model.methods.refresh();
  const first = f.model.methods.openAccessTokenLogs("t1");
  const second = f.model.methods.openAccessTokenLogs("t2");
  pending_responses[1](Response.json({ credit_transactions: [{ id: "second" }], next_cursor: null }));
  await second;
  pending_responses[0](Response.json({ credit_transactions: [{ id: "first" }], next_cursor: "old" }));
  await first;
  assert.equal(f.model.state.access_token_logs.value[0].id, "second");
  const closed = f.model.methods.refreshAccessTokenLogs();
  f.model.methods.closeAccessTokenLogs();
  pending_responses[2](Response.json({ credit_transactions: [{ id: "late" }], next_cursor: null }));
  await closed;
  assert.equal(f.model.state.access_token_logs.value.length, 0);
  assert.equal(f.model.state.access_token_log_state.value.open, false);
  const disposed = f.model.methods.openAccessTokenLogs("t1");
  f.model.methods.dispose();
  pending_responses[3](Response.json({ error: "迟到错误" }, { status: 500 }));
  await disposed;
  assert.equal(f.model.state.access_token_log_state.value.error, "");
});

test("离开保活 Token 页面时关闭日志弹窗并丢弃未完成的响应", async () => {
  let hide, finish, stopped = false;
  const f = fixture(undefined, "tokens", () => new Promise(resolve => { finish = resolve; }));
  f.access_tokens.push({ id: "t1", name: "测试" });
  const page = f.context.TokensPage({ view: { onBeforeHide(callback) {
    hide = callback;
    return () => { stopped = true; };
  } } });
  page.children[0].props.onMounted();
  await new Promise(resolve => setImmediate(resolve));
  const pending = nodes(page).find(node => node.props.attributes?.n === "view-access-token-button").props.onClick();
  assert.ok(nodes(page).some(node => node.props.attributes?.n === "access-token-logs-dialog"));
  hide();
  finish(Response.json({ credit_transactions: [{ id: "late" }], next_cursor: null }));
  await pending;
  assert.equal(nodes(page).some(node => node.props.attributes?.n === "access-token-logs-dialog"), false);
  page.children[0].props.onUnmounted();
  assert.equal(stopped, true);
});
