import { page_source } from "./page_source.mjs";
import { navigation, initialize_admin_auth } from "../store.js";
import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { AdminAgentModel, AdminAgentView } from "../components/admin_agent.js";
import { ScriptAgentModel, ScriptAgentPanelView } from "../components/script_agent.js";
import { PaginationModel, PaginationView } from "../components/pagination.js";
import * as platform_helpers from "../components/discovery_platform.js";
import { RssRoutePatternModel } from "../../server/domain/rss_route.js";

const bundle = await build({
  entryPoints: [fileURLToPath(new URL("../components/ui.js", import.meta.url))],
  bundle: true, format: "iife", write: false, metafile: true,
  nodePaths: [fileURLToPath(new URL("../../node_modules", import.meta.url))],
  alias: { "@": fileURLToPath(new URL("..", import.meta.url)) },
  // CodeMirror 依赖浏览器 DOM；编辑器交互由 code_editor.test.mjs 与浏览器验收覆盖。
  plugins: [{ name: "codemirror-stub", setup(build) {
    build.onLoad({ filter: /node_modules\/codemirror\/.*\.js$/ }, () => ({ contents: "export default {};", loader: "js" }));
  } }],
});
const context = vm.createContext({ pages: navigation, ...platform_helpers, RssRoutePatternModel, PaginationModel, PaginationView, URL, console, setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {} });
context.window = context;
vm.runInContext(readFileSync(new URL("../../public/assets/timeless/0.34.2/timeless.umd.min.js", import.meta.url), "utf8"), context);
vm.runInContext(bundle.outputFiles[0].text, context);
const ui = context.FindRSSAdminUI;

function find(node, name) {
  if (node?.state?.attributes?.n === name) return node;
  for (const child of node?.children || []) { const result = find(child, name); if (result) return result; }
  return null;
}

test("登录页只显示密码输入框，提交密码后跳转管理后台", async () => {
  const requests = [], redirects = [];
  const login_context = vm.createContext({
    URL, URLSearchParams,
    document: { readyState: "loading", addEventListener() {} },
    window: {
      FindRSSAdminUI: { ...ui, DOM: {} },
      location: { origin: "https://feeds.example", search: "", replace: url => redirects.push(url) },
      fetch: async (url, options) => { requests.push({ url, body: JSON.parse(options.body) }); return { ok: true, json: async () => ({ logged_in: true }) }; },
    },
  });
  vm.runInContext("(" + initialize_admin_auth.toString() + ")()", login_context);
  vm.runInContext(page_source("login.js"), login_context);
  const view = vm.runInContext("LoginView()", login_context);
  try {
    const logo = find(view, "admin-login-logo");
    assert.equal(logo.t, "img");
    assert.equal(logo.state.src, "/brand/logo.svg");
    assert.equal(logo.state.attributes.alt, "FindRSS Logo");
    const form = find(view, "admin-login-form");
    assert.equal(form.t, "form");
    assert.equal(find(view, "admin-login-username-field"), null);
    const password = find(view, "admin-login-password-input");
    assert.equal(password.state.attributes.type, "password");
    password.events.onInput({ target: { value: "test-admin-password" } });
    assert.equal(find(view, "admin-login-submit").state.attributes.type, "submit");
    let prevented = false;
    await form.events.onSubmit({ preventDefault() { prevented = true; } });
    assert.equal(prevented, true);
    await new Promise(setImmediate);
    assert.deepEqual(requests, [{ url: "/admin/auth/login", body: { password: "test-admin-password" } }]);
    assert.deepEqual(redirects, ["/admin/"]);
  } finally { view.onUnmounted(); }
});

test("设备 Token 管理使用共享组件，创建、查看、复制、隐藏、撤销均由 Model 驱动", async () => {
  ui.DOM = {};
  context.document = { querySelector: () => null };
  context.FindRSSAdminShell = {};
  context.FindRSSAdminPages = {};
  const requests = [], copies = [], timers = new Map();
  let next_timer = 0, tokens = [];
  const token = { id: "token-1", name: "笔记本", note: "调试", token_hint: "frd_…1234", status: "active", created_at: 1, expires_at: null, last_used_at: null };
  context.setTimeout = (callback, delay) => { timers.set(++next_timer, { callback, delay }); return next_timer; };
  context.clearTimeout = id => timers.delete(id);
  context.navigator = { clipboard: { async writeText(value) { copies.push(value); } } };
  context.FindRSSAdminAuth = { fetch: async (url, options) => {
    requests.push({ url, method: options.method, body: options.body && JSON.parse(options.body) });
    if (url.endsWith("/reveal")) return Response.json({ token: "frd_test-plaintext" });
    if (url.endsWith("/revoke")) tokens = [{ ...token, status: "revoked" }];
    else if (options.method === "POST") tokens = [token];
    return Response.json({ device_tokens: tokens });
  } };
  vm.runInContext("(() => {\n" + page_source("dashboard.js") +
    "\nglobalThis.device_tokens_model = DeviceTokensModel; globalThis.device_tokens_view = DeviceTokensView; })();", context);
  const confirmations = [];
  const model = context.device_tokens_model(async value => { confirmations.push(value); return true; });
  await model.toggle();
  model.set_draft("name", "笔记本"); model.set_draft("note", "调试");
  await model.create();
  assert.deepEqual(requests.find(request => request.method === "POST").body, { name: "笔记本", note: "调试", expires_in_seconds: 2592000 });
  const view = context.device_tokens_view(model);
  try {
    assert.ok(find(view, "device-token-name-input"));
    assert.ok(find(view, "device-token-expiry-select"));
    assert.equal(find(view, "copy-device-token-button").state.attributes.disabled, true);
    await model.reveal(token.id);
    assert.equal(find(view, "copy-device-token-button").state.attributes.disabled, undefined);
    assert.ok([...timers.values()].some(timer => timer.delay === 30000));
    await model.copy(token.id);
    assert.deepEqual(copies, ["frd_test-plaintext"]);
    await model.reveal(token.id);
    assert.equal(model.revealed.value[token.id], undefined);
    await model.reveal(token.id);
    [...timers.values()].find(timer => timer.delay === 30000).callback();
    assert.equal(model.revealed.value[token.id], undefined);
    await model.revoke(token);
    assert.equal(model.tokens.value[0].status, "revoked");
    assert.equal(confirmations[0].danger, true);
    assert.equal(find(view, "preview-device-token-button").state.attributes.disabled, true);
  } finally { model.dispose(); view.onUnmounted(); context.setTimeout = () => 0; context.clearTimeout = () => {}; }
});

test("关闭设备 Token 管理后，迟到的明文响应不会重新显示", async () => {
  let complete;
  context.FindRSSAdminAuth.fetch = async url => url.endsWith("/reveal")
    ? new Promise(resolve => { complete = () => resolve(Response.json({ token: "late-plaintext" })); })
    : Response.json({ device_tokens: [] });
  // app.js 捕获的 fetch 是初始化时的函数，重新加载以使用本测试的请求替身。
  vm.runInContext("(() => {\n" + page_source("dashboard.js") +
    "\nglobalThis.device_tokens_model = DeviceTokensModel; })();", context);
  const model = context.device_tokens_model(async () => true);
  await model.toggle();
  const pending = model.reveal("token-1");
  model.toggle(); complete(); await pending;
  assert.equal(model.revealed.value["token-1"], undefined);
  model.dispose();
});

test("后台使用真实阅读器组件，操作按钮带 SVG 并响应禁用状态", () => {
  assert.equal(context.vm, context.Timeless.vm);
  assert.equal(context.kit, context.Timeless.kit);
  assert.equal(context.ui, context.Timeless.ui);
  assert.equal(context.Timeless.getIconRegistry().save.attrs["data-n"], "icon-save");
  assert.ok(Object.keys(bundle.metafile.inputs).some(path => path.endsWith("frui/button.js")));
  assert.ok(Object.keys(bundle.metafile.inputs).some(path => path.endsWith("frui/select.js")));
  const disabled = context.Timeless.ref(false);
  const button = ui.Button({ disabled, attributes: { n: "cookie-save-button" } }, ["保存"]);
  assert.ok(button.state.styleSet.includes("display-inline-flex"));
  assert.ok(find(button, "admin-icon-save"));
  disabled.set(true);
  assert.equal(button.state.attributes.disabled, true);
  button.onUnmounted();
});

test("真实 Select 回调保持后台事件形状，Checkbox 点击回传 checked", () => {
  let selected;
  const value = context.Timeless.ref("all");
  const select = ui.Select({ value, options: [{ value: "all", label: "全部" }, { value: "active", label: "启用" }],
    attributes: { n: "test-select" }, onChange(event) { selected = event.target.value; value.set(selected); } });
  assert.ok(select.state.styleSet.includes("width-100-percent"));
  find(select, "test-select").events.onClick();
  find(select, "test-select-option-active").events.onClick();
  assert.equal(selected, "active");
  assert.equal(value.value, "active");
  select.onUnmounted();
  let checked;
  const checkbox = ui.Input({ attributes: { n: "test-checkbox", type: "checkbox", checked: context.Timeless.ref(false) },
    onChange(event) { checked = event.target.checked; } });
  find(checkbox, "test-checkbox").events.onClick({});
  assert.equal(checked, true);
  checkbox.onUnmounted();
});

test("TableField 复用阅读器组件，参数名和说明使用共享两列布局", () => {
  assert.ok(Object.keys(bundle.metafile.inputs).some(path => path.endsWith("frui/table-field.js")));
  const table = ui.TableField({ attributes: { n: "route-parameters" }, items: [
    { key: "id", label: "id", value: "文章 ID" },
    { key: "long_parameter_name", label: "long_parameter_name", value: "长参数说明" },
  ] });
  assert.ok(table.state.styleSet.includes("display-grid"));
  assert.ok(find(table, "route-parameters-id-label"));
  assert.ok(find(table, "route-parameters-long_parameter_name-value"));
  const css = readFileSync(new URL("../style.css", import.meta.url), "utf8");
  assert.match(css, /grid-template-columns: max-content minmax\(0,1fr\)/);
  assert.match(css, /\.display-contents \{ display: contents;/);
});

test("分页复用真实 Button 与 Select，页码、总数和禁用状态随数据变化", () => {
  const total = ui.ref(41), loading = ui.ref(false);
  const model = PaginationModel(ui, { total, loading });
  const pager = PaginationView(ui, { model, name: "pager", label: "列表分页" });
  assert.equal(find(pager, "pager-first").state.attributes.disabled, true);
  assert.equal(find(pager, "pager-next").state.attributes.disabled, undefined);
  find(pager, "pager-last").events.onClick();
  assert.equal(model.state.value.page, 2);
  assert.equal(find(pager, "pager-next").state.attributes.disabled, true);
  assert.equal(find(pager, "pager-first").state.attributes.disabled, undefined);
  find(pager, "pager-size").events.onClick();
  find(pager, "pager-size-option-10").events.onClick();
  assert.equal(model.page_size.value, 10);
  assert.equal(model.state.value.page, 0);
  assert.equal(model.state.value.pages, 5);
  loading.set(true);
  assert.equal(find(pager, "pager-next").state.attributes.disabled, true);
  assert.equal(find(pager, "pager-size").state.attributes.disabled, true);
  loading.set(false);
  total.set(0);
  assert.equal(model.state.value.first, 0);
  assert.equal(model.state.value.pages, 1);
  assert.equal(find(pager, "pager-next").state.attributes.disabled, true);
  pager.onUnmounted();
});

test("SVG 状态图标随 Model 更新", () => {
  const name = context.Timeless.ref("circle");
  const icon = ui.Icon(name);
  assert.ok(find(icon, "admin-icon-circle"));
  name.set("check");
  assert.ok(find(icon, "admin-icon-check"));
  assert.equal(find(icon, "admin-icon-circle"), null);
  icon.onUnmounted();
});

test("所有 HTML 入口先加载共享 UI 与 CSS，再加载页面；旧 Timeless 版本不残留", () => {
  for (const name of ["index", "login"]) {
    const html = readFileSync(new URL("../" + name + ".html", import.meta.url), "utf8");
    assert.match(html, /href="\.\/frui\.css"/);
    assert.match(html, /assets\/timeless\/0\.34\.2\//);
    assert.ok(html.indexOf('src="./ui.js"') > html.indexOf("timeless.dom.umd.min.js"));
    assert.ok(html.indexOf('src="./ui.js"') < html.indexOf(name === "login" ? 'src="./login.js"' : 'src="./app.js"'));
  }
});

test("订阅源卡片使用 Link 与 CopyButton，复制实际地址并显示成功或失败状态", async () => {
  ui.DOM = {};
  context.document = { querySelector: () => null };
  context.FindRSSAdminAuth = { fetch() {} };
  context.FindRSSAdminShell = {};
  context.FindRSSAdminPages = {};
  vm.runInContext("(() => {\n" + page_source("discovery.js") +
    "\nglobalThis.discovery_model = DiscoveryAdminViewModel(); globalThis.discovery_card = source => SourceCardView({ store: discovery_model, source: normalize_source(source) }); globalThis.discovery_list = () => SourceListView({ store: discovery_model }); })();", context);
  const list = context.discovery_list();
  assert.equal(list.state.styleSet.includes("frui-card"), false);
  assert.equal(find(list, "card-body"), null);
  assert.equal(find(list, "discovery-source-list-heading-group"), null);
  const source = { id: "one", title: "示例", website: "https://example.com", feed_url: "https://feeds.example.com/atom/demo",
    feed_url_template: "{{hostname}}/atom/demo", avatar_url: "", enabled: true, tags: [], snapshot: { saved_at: 0, articles: [], error: "" } };
  const copied = [];
  const click_copy = async button => { button.events.onClick(); await new Promise(setImmediate); };
  context.navigator = { clipboard: { async writeText(url) { copied.push(url); } } };
  const card = context.discovery_card(source);
  for (const [kind, name, url] of [["website", "website", source.website], ["feed", "feed-link", source.feed_url]]) {
    const link = find(card, "discovery-source-card-" + name);
    assert.equal(link.t, ui.Link({ href: url }).t);
    assert.equal(link.state.href, url);
    assert.equal(link.state.target, "_blank");
    assert.equal(link.state.rel, "noopener noreferrer");
    const copy = find(card, "discovery-source-card-copy-" + kind);
    assert.ok(copy.state.styleSet.includes("display-inline-flex"));
    await click_copy(copy);
    assert.equal(copy.state.attributes["aria-label"], "已复制");
  }
  assert.deepEqual(copied, [source.website, source.feed_url]);
  card.onUnmounted();

  const template_card = context.discovery_card({ ...source, website: "", feed_url: source.feed_url_template });
  assert.equal(find(template_card, "discovery-source-card-feed-link"), null);
  assert.ok(find(template_card, "discovery-source-card-feed-value"));
  await click_copy(find(template_card, "discovery-source-card-copy-website"));
  await click_copy(find(template_card, "discovery-source-card-copy-feed"));
  assert.deepEqual(copied.slice(-2), [source.feed_url_template, source.feed_url_template]);
  template_card.onUnmounted();

  context.navigator.clipboard.writeText = async () => { throw new Error("denied"); };
  const failed_card = context.discovery_card(source);
  const failed_copy = find(failed_card, "discovery-source-card-copy-feed");
  await click_copy(failed_copy);
  assert.equal(failed_copy.state.attributes["aria-label"], "复制 RSS/Atom 地址");
  assert.match(context.discovery_model.state.list_error.value, /复制失败/);
  context.navigator.clipboard.writeText = async () => {};
  await click_copy(failed_copy);
  assert.equal(context.discovery_model.state.list_error.value, "");
  failed_card.onUnmounted();
});

test("刷新快照的完整错误响应显示在对应卡片按钮下方，重试成功后清除", async () => {
  ui.DOM = {};
  context.document = { querySelector: () => null };
  let fail = true;
  context.FindRSSAdminAuth = { fetch: async () => fail
    ? Response.json({ error: "脚本执行失败：设备离线\n请稍后重试" }, { status: 503 })
    : Response.json({ snapshot: { saved_at: 20, articles: [], error: "" } }) };
  context.FindRSSAdminShell = {};
  context.FindRSSAdminPages = {};
  vm.runInContext("(() => {\n" + page_source("discovery.js") +
    "\nglobalThis.snapshot_model = DiscoveryAdminViewModel(); globalThis.snapshot_card = source => SourceCardView({ store: snapshot_model, source: normalize_source(source) }); })();", context);
  const source = { id: "one", title: "示例", feed_url: "https://example.com/feed", enabled: true };
  context.snapshot_model.state.sources.as([source]);
  const card = context.snapshot_card(source);
  const other_card = context.snapshot_card({ ...source, id: "two" });
  try {
    const error = find(card, "discovery-source-snapshot-error");
    const actions = find(card, "discovery-source-card-actions");
    assert.equal(card.children.indexOf(error), card.children.indexOf(actions) + 1);
    assert.equal(error.state.attributes.role, "alert");
    let displayed = error.children[0].state.value;
    error.children[0].$elm = { setText(value) { displayed = value; } };
    let other_displayed = find(other_card, "discovery-source-snapshot-error").children[0].state.value;
    find(other_card, "discovery-source-snapshot-error").children[0].$elm = { setText(value) { other_displayed = value; } };
    await find(card, "discovery-source-refresh-snapshot").events.onClick();
    await new Promise(setImmediate);
    assert.equal(displayed, "脚本执行失败：设备离线\n请稍后重试");
    assert.equal(other_displayed, "");
    assert.equal(context.snapshot_model.state.list_error.value, "");
    fail = false;
    await find(card, "discovery-source-refresh-snapshot").events.onClick();
    await new Promise(setImmediate);
    assert.equal(displayed, "");
  } finally { card.onUnmounted(); other_card.onUnmounted(); }
});

test("账号菜单复用真实 DropdownMenu，右键打开、Escape 关闭，点击退出只调用一次", () => {
  let logouts = 0;
  context.FindRSSAdminAuth = { logout() { logouts++; } };
  vm.runInContext("(() => {\n" + readFileSync(new URL("../components/shell.js", import.meta.url), "utf8").replace(/^export \{[^}]*\};?$/gm, "").replace(/^import .*;$/gm, "") + "\n})();", context);
  assert.ok(Object.keys(bundle.metafile.inputs).some(path => path.endsWith("frui/dropdown-menu.js")));
  const root = context.FindRSSAdminShell.View({ page_id: "messages" }, []);
  const account = find(root, "admin-shell-account");
  assert.equal(account.state.attributes["aria-expanded"], "false");
  assert.equal(find(root, "admin-shell-logout"), null);
  let prevented = 0;
  account.events.onContextMenu({ preventDefault() { prevented++; } });
  assert.equal(account.state.attributes["aria-expanded"], "true");
  assert.ok(find(root, "admin-shell-logout"));
  account.events.onKeyDown({ key: "Escape", stopPropagation() {} });
  assert.equal(account.state.attributes["aria-expanded"], "false");
  assert.equal(find(root, "admin-shell-logout"), null);
  account.events.onKeyDown({ key: "F10", shiftKey: true, preventDefault() { prevented++; } });
  const menu = find(root, "admin-shell-account-menu");
  assert.equal(menu.state.attributes.role, "menu");
  const logout = find(root, "admin-shell-logout");
  assert.equal(logout.state.attributes.role, "menuitem");
  logout.events.onClick({});
  assert.equal(logouts, 1);
  assert.equal(account.state.attributes["aria-expanded"], "false");
  assert.equal(prevented, 2);
  root.onUnmounted();
});

test("Cookie 两栏随域名选择更新，切换保留输入，重新读取更新当前域名内容", async () => {
  let cookies = [{ domain: ".example.com", name: "sid", path: "/", value: "one" },
    { domain: ".other.com", name: "token", path: "/", value: "two" }];
  context.FindRSSAdminAuth = { fetch: async () => Response.json({ cookies }) };
  context.confirm = () => true;
  vm.runInContext("(() => {\n" + page_source("cookies.js") +
    "\nglobalThis.cookie_model = CookiesViewModel(); globalThis.cookie_workspace = () => CookieWorkspaceView({ model: cookie_model }); })();", context);
  const model = context.cookie_model;
  const root = context.cookie_workspace();
  await model.methods.refresh();
  const group = model.state.selected_groups.value[0];
  const domain_button = find(root, "cookie-domain-select-.example.com");
  const domain_content = find(domain_button, "cookie-domain-content");
  assert.ok(find(domain_content, "cookie-domain-label"));
  assert.ok(find(domain_content, "cookie-domain-count"));
  assert.equal(find(domain_button, "cookie-domain-label").state.style["text-align"], "left");
  find(root, "cookie-value-input").events.onInput({ target: { value: "draft" } });
  find(root, "cookie-add-key").events.onInput({ target: { value: "new_key" } });
  find(root, "cookie-domain-select-.other.com").events.onClick();
  assert.equal(model.state.selected_domain.value, ".other.com");
  assert.equal(find(root, "cookie-domain-select-.other.com").state.attributes["aria-pressed"], "true");
  find(root, "cookie-value-input").events.onInput({ target: { value: "other_draft" } });
  assert.equal(model.state.selected_groups.value[0].rows.value[0].value.value, "other_draft");
  find(root, "cookie-domain-select-.example.com").events.onClick();
  assert.equal(group.rows.value[0].value.value, "draft");
  assert.equal(group.new_name.value, "new_key");
  cookies = [{ ...cookies[0], name: "fresh_key", value: "fresh_value" }];
  await model.methods.refresh();
  const current = model.state.selected_groups.value[0];
  assert.equal(current.rows.value[0].cookie.name, "fresh_key");
  find(root, "cookie-value-input").events.onInput({ target: { value: "after_refresh" } });
  assert.equal(current.rows.value[0].value.value, "after_refresh");
  assert.equal(find(root, "cookie-domain-select-.other.com"), null);
  cookies = [{ ...cookies[0], value: "latest_value" }];
  await model.methods.refresh();
  assert.equal(model.state.selected_groups.value[0], current);
  assert.equal(current.rows.value[0].value.value, "latest_value");
  find(root, "cookie-value-input").events.onInput({ target: { value: "latest_draft" } });
  assert.equal(current.rows.value[0].value.value, "latest_draft");
  root.onUnmounted();
});

test("订阅源 JSON 弹窗复用 FilePicker 拖拽区，读取文件后由按钮提交", async () => {
  const writes = [];
  context.document = { querySelector: () => null, addEventListener() {}, removeEventListener() {} };
  context.FindRSSAdminAuth = { fetch: async (_, options) => {
    const source = JSON.parse(options.body);
    writes.push(source);
    return Response.json({ source: { ...source, id: "imported" } });
  } };
  vm.runInContext("(() => {\n" + page_source("discovery.js") +
    "\nglobalThis.discovery_import_model = DiscoveryAdminViewModel(); globalThis.discovery_import_view = () => SourceImportView({ store: discovery_import_model }); })();", context);
  const model = context.discovery_import_model;
  model.methods.open_import();
  const view = context.discovery_import_view();
  try {
    const dropzone = find(view, "discovery-import-file-dropzone");
    assert.ok(dropzone);
    assert.ok(find(view, "discovery-import-file"));
    let prevented = false;
    dropzone.events.onDrop({ preventDefault() { prevented = true; }, dataTransfer: {
      files: [new File(['{"sources":[{"title":"测试","feed_url":"https://example.com/feed"}]}'], "sources.json", { type: "application/json" })],
    } });
    await new Promise(setImmediate);
    assert.equal(prevented, true);
    assert.match(model.state.import_text.value, /测试/);
    assert.equal(writes.length, 0);
    await find(view, "discovery-import-submit-button").events.onClick();
    await new Promise(setImmediate);
    assert.deepEqual(writes, [{ title: "测试", feed_url: "https://example.com/feed" }]);
    assert.match(model.state.import_message.value, /已导入 1 个/);
    find(view, "discovery-import-cancel-button").events.onClick();
    assert.equal(model.state.import_open.value, false);
  } finally { view.onUnmounted(); }
});

test("脚本助手复用阅读器对话和输入框，左下模型菜单的选择进入实际对话请求", async () => {
  assert.ok(Object.keys(bundle.metafile.inputs).some(path => path.endsWith("components/xiaoxun-dialogue.js")));
  assert.ok(Object.keys(bundle.metafile.inputs).some(path => path.endsWith("components/xiaoxun-model-select.js")));
  const providers = ["one", "two"].map(id => ({ id, name: id, type: "openai_compat", enabled: true, api_key_configured: true,
    base_url: `https://${id}.example/v1`, models: [{ id: "m", name: id + " Model", model: id, enabled: true, options: {} }] }));
  const sent = [];
  const socket = { readyState: 0, send: value => sent.push(JSON.parse(value)), close() {} };
  let id = 0;
  const agent = ScriptAgentModel({ ui, new_id: () => "run-" + ++id, location: () => "https://example.com/admin/scripts", create_socket: () => socket,
    request_json: async () => ({ providers, configured: true }), get_context: () => ({ ready: true, revision: 0, script: "draft", request_url: "/debug/example", route: "" }) });
  await agent.methods.start();
  const panel = ScriptAgentPanelView({ ui, agent });
  try {
    assert.ok(find(panel, "xiaoxun-composer-editor"));
    assert.ok(find(panel, "xiaoxun-dialogue-composer-footer"));
    find(panel, "xiaoxun-model-trigger").events.onClick();
    const key = JSON.stringify(["two", "m"]);
    find(panel, "xiaoxun-model-option-" + key).events.onClick();
    assert.equal(agent.state.model_key.value, key);
    agent.pet.set_draft("修改代码");
    find(panel, "xiaoxun-dialogue-send").events.onClick();
    socket.readyState = 1; socket.onopen();
    assert.equal(sent[0].provider_id, "two"); assert.equal(sent[0].model_id, "m");
    assert.equal(sent[0].script, "draft");
    assert.equal(find(panel, "xiaoxun-model-trigger").state.attributes.disabled, true);
  } finally { panel.onUnmounted(); agent.destroy(); }
});

test("脚本模型设置使用原厂商/模型页；临时密钥用于连接测试，保存清空输入，返回设置丢弃未保存密钥", async () => {
  assert.ok(Object.keys(bundle.metafile.inputs).some(path => path.endsWith("pages/settings.ai.component.js")));
  const provider = { id: "custom", name: "Custom", type: "openai_compat", enabled: true, base_url: "https://models.example/v1", api_key_secret_name: "",
    models: [{ id: "m", name: "Model", model: "m", enabled: true, options: {} }] };
  const requests = [];
  const agent = ScriptAgentModel({ ui, new_id: () => "id", request_json: async (url, options) => {
    requests.push({ url, body: options && JSON.parse(options.body) });
    return url.endsWith("/test") ? { model: "m", elapsed_ms: 10 } : { providers: [provider], configured: true };
  } });
  await agent.methods.start();
  const panel = ScriptAgentPanelView({ ui, agent });
  try {
    find(panel, "script-agent-config-button").events.onClick();
    assert.ok(find(panel, "settings-ai-provider-search"));
    assert.ok(find(panel, "settings-save-button"));
    assert.ok(find(panel, "settings-reset-button"));
    const store = agent.settings_store;
    store.methods.set_ai_key("custom", "draft-key");
    await store.methods.test_ai_provider(provider, "m");
    assert.equal(requests.at(-1).body.api_key, "draft-key");
    await store.methods.save_settings();
    assert.equal(requests.at(-1).body.ai_keys.custom, "draft-key");
    await store.methods.save_settings();
    assert.deepEqual(requests.at(-1).body.ai_keys, {});
    store.methods.set_ai_key("custom", "discarded-key");
    agent.methods.toggle_config(); agent.methods.toggle_config();
    await store.methods.save_settings();
    assert.deepEqual(requests.at(-1).body.ai_keys, {});
    assert.doesNotMatch(JSON.stringify(agent.state.settings.value), /draft-key|discarded-key/);
  } finally { panel.onUnmounted(); agent.destroy(); }
});


test("全局小讯入口打开原阅读器对话，路由更新标题上下文且模型选择器仍可用", async () => {
  const model = AdminAgentModel({ ui, location: () => "https://example.com/admin/discovery", request_json: async () => ({ configured: false, providers: [] }) });
  const view = AdminAgentView({ ui, model });
  try {
    assert.equal(find(view, "admin-global-agent-dialog"), null);
    find(view, "admin-global-agent-toggle").events.onClick();
    assert.equal(find(view, "admin-global-agent-toggle").state.attributes["aria-expanded"], "true");
    assert.ok(find(view, "admin-global-agent-context"));
    assert.ok(find(view, "xiaoxun-model-trigger"));
    assert.ok(find(view, "xiaoxun-composer-editor"));
    model.methods.set_pathname("/admin/devices");
    assert.equal(model.state.page.value.title, "设备管理");
    find(view, "admin-global-agent-close").events.onClick();
    assert.equal(model.state.open.value, false);
    assert.equal(find(view, "admin-global-agent-dialog"), null);
  } finally { view.onUnmounted(); model.methods.destroy(); }
});
