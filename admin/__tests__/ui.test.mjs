import { paged_fixture } from "./list_fixture.mjs";
import { PollPolicyView, poll_policy_label } from "../components/poll_policy.js";
import { PollPolicyModel } from "../components/poll_policy.model.js";
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
import { AISettingsStore } from "../components/ai_settings.js";
import { AI_PROVIDER_PRESETS } from "../domain/preferences/ai_presets.js";
import { ListPaginationModel, PaginationModel, PaginationView } from "../components/pagination.js";
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
const context = vm.createContext({ pages: navigation, ...platform_helpers, PollPolicyView, poll_policy_label, PollPolicyModel, RssRoutePatternModel, ListPaginationModel, PaginationModel, PaginationView, URL, console, setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {} });
context.window = context;
vm.runInContext(readFileSync(new URL("../../public/assets/timeless/0.34.2/timeless.umd.min.js", import.meta.url), "utf8"), context);
vm.runInContext(bundle.outputFiles[0].text, context);
const ui = context.FindRSSAdminUI;

function find(node, name) {
  if (node?.state?.attributes?.n === name) return node;
  for (const child of node?.children || []) { const result = find(child, name); if (result) return result; }
  return null;
}

test("页面布局分离页头和内容，复用间距且操作区允许换行", () => {
  const item = ui.View({ attributes: { n: "layout-test-item" } }, ["业务内容"]);
  const action = ui.Button({ attributes: { n: "layout-test-action" } }, ["新增"]);
  const content = ui.PageContent({}, [item, null, false]);
  const header = ui.PageHeader({
    title: "订阅源管理",
    actions: [action],
    titleProps: { attributes: { id: "layout-test-title" } },
    actionsProps: { attributes: { "aria-label": "页面操作" } },
  });
  const root = ui.PageLayout({ header, attributes: { "aria-labelledby": "layout-test-title" } }, [content]);
  try {
    assert.deepEqual(Array.from(root.children), [header, content]);
    assert.deepEqual(Array.from(content.children), [item]);
    assert.equal(root.state.attributes["aria-labelledby"], "layout-test-title");
    assert.equal(root.state.style.padding, "var(--frui-space-4) var(--frui-space-4) var(--frui-space-6)");
    assert.equal(root.state.style["--max-640-padding"], "var(--frui-space-3) var(--frui-space-3) var(--frui-space-5)");
    assert.ok(root.state.styleSet.includes("w-full"));
    assert.ok(root.state.styleSet.includes("gap-space-3"));
    assert.ok(header.state.styleSet.includes("m-0"));
    assert.ok(header.state.styleSet.includes("flex-wrap"));
    assert.ok(!header.state.styleSet.includes("height-56-pixels"));
    assert.equal(find(header, "page-header-title").state.attributes.id, "layout-test-title");
    const actions = find(header, "page-header-actions");
    assert.deepEqual(Array.from(actions.children), [action]);
    assert.equal(actions.state.attributes["aria-label"], "页面操作");
    assert.ok(actions.state.styleSet.includes("flex-wrap"));
    assert.ok(!actions.state.styleSet.includes("overflow-x-auto"));
  } finally { root.onUnmounted(); }
});

test("Popconfirm 取消不提交，确认期间阻止重复操作并响应禁用状态", async () => {
  const disabled = ui.ref(false);
  let calls = 0, finish;
  const root = ui.Popconfirm({ title: "删除此记录？", disabled,
    attributes: { n: "delete-test-confirmation" },
    trigger: props => ui.Button({ ...props, attributes: { ...props.attributes, n: "delete-test-button" } }, ["删除"]),
    onConfirm: () => { calls++; return new Promise(resolve => { finish = resolve; }); },
  });
  try {
    const trigger = find(root, "delete-test-button");
    trigger.events.onClick();
    find(root, "delete-test-confirmation-cancel").events.onClick();
    assert.equal(calls, 0);
    assert.equal(find(root, "delete-test-confirmation-confirm"), null);
    trigger.events.onClick();
    const confirm = find(root, "delete-test-confirmation-confirm");
    disabled.as(true);
    confirm.events.onClick();
    assert.equal(calls, 0);
    disabled.as(false);
    confirm.events.onClick();
    confirm.events.onClick();
    assert.equal(calls, 1);
    assert.equal(confirm.state.attributes.disabled, true);
    assert.equal(find(root, "delete-test-confirmation-cancel").state.attributes.disabled, true);
    finish();
    await new Promise(setImmediate);
    assert.equal(find(root, "delete-test-confirmation-confirm"), null);
    assert.equal(trigger.state.attributes.disabled, undefined);
  } finally { root.onUnmounted(); disabled.destroy(); }
});

test("Popconfirm 删除列表项后在确认回调完成前移除浮层", async () => {
  const rows = ui.refarr([{ id: "delete-row" }]);
  let finish_delete, finish_reload, popup_visible = true;
  const deleted = new Promise(resolve => { finish_delete = resolve; });
  const reloaded = new Promise(resolve => { finish_reload = resolve; });
  const root = ui.For({ each: rows, render: () => ui.View({}, [ui.Popconfirm({
    title: "删除此记录？", attributes: { n: "delete-row-confirmation" },
    trigger: props => ui.Button({ ...props, attributes: { ...props.attributes, n: "delete-row-button" } }, ["删除"]),
    async onConfirm() {
      await deleted;
      rows.as([]);
      await reloaded;
    },
  })]) });
  try {
    find(root, "delete-row-button").events.onClick();
    const popup = root.children[0].children[0].children[1].children[0];
    assert.equal(popup.t, "show");
    assert.ok(find(popup, "delete-row-confirmation-confirm"));
    // 模拟挂在 Portal 下的 DOM；列表项销毁必须主动移除这些节点。
    popup.$elm = { removeChildren() { popup_visible = false; } };
    const submitted = find(popup, "delete-row-confirmation-confirm").events.onClick();
    finish_delete();
    await new Promise(setImmediate);
    assert.equal(root.children.length, 0);
    assert.equal(popup_visible, false);
    assert.equal(find(popup, "delete-row-confirmation-confirm"), null);
    finish_reload();
    await submitted;
    assert.equal(popup_visible, false);
  } finally { finish_delete(); finish_reload(); root.destroy(); rows.destroy(); }
});

test("存储文件树使用虚拟窗口，目录可展开且只提供预览", async () => {
  const storage_bundle = await build({
    entryPoints: [fileURLToPath(new URL("../pages/storage.js", import.meta.url))],
    bundle: true, format: "iife", globalName: "StorageModule", write: false,
  });
  Object.assign(context, { URLSearchParams, AbortController, TextDecoder });
  const requests = [];
  context.FindRSSAdminShell = { Page: (props, children) => ui.View({ attributes: { n: "storage-test-page" } }, [...props.actions, ...children]) };
  context.FindRSSAdminAuth = { fetch: async (url, options) => {
    requests.push(url);
    if (url.endsWith("/usage")) return Response.json({ bytes: 1024, objects: 5000, generated_at: Date.now() });
    if (url.includes("/file?")) return new Response(options.method === "HEAD" ? null : "<script>预览文本</script>", { headers: { "Content-Type": "text/plain" } });
    const child = new URL("https://test" + url).searchParams.get("prefix");
    return Response.json({ objects: child ? Array.from({ length: 5000 }, (_, index) => ({ key: "files/" + index, size: 1024, uploaded: "2026-10-16T00:00:00Z" })) : [],
      delimited_prefixes: child ? [] : ["files/"], truncated: false, cursor: null });
  } };
  vm.runInContext(storage_bundle.outputFiles[0].text, context);
  const root = context.StorageModule.StoragePage();
  let usage_text;
  find(root, "storage-usage").children[0].$elm = { setText(value) { usage_text = value; } };
  find(root, "storage-page").onMounted();
  await new Promise(setImmediate);
  assert.equal(usage_text, "1.0 KB");
  const tree = find(root, "storage-tree");
  assert.equal(tree.t, "list-view-v2");
  assert.equal(tree.state.attributes.role, "tree");
  assert.equal(tree.state.attributes.tabindex, "0");
  assert.equal(tree.config.itemHeight, 40);
  const folder = tree.renderItem(ui.ref(tree.source.value[0]), ui.ref(0));
  assert.equal(find(folder, "storage-tree-name").children[0].state.value, "files");
  assert.equal(find(folder, "storage-tree-row").state.attributes["aria-expanded"], "true");
  assert.equal(tree.source.value.length, 5001);
  tree.model.setItems(tree.source.value);
  for (const top of [0, 3200, tree.model.getTotalHeight() - 560]) {
    const range = tree.model.getRange(top, 560, tree.config.buffer);
    assert.ok(range.end - range.start <= 27, "5000 个文件只渲染视口及缓冲行");
  }
  const last = tree.model.getRange(tree.model.getTotalHeight() - 560, 560, tree.config.buffer);
  assert.equal(last.end, 5001);
  const file = tree.renderItem(ui.ref(tree.source.value[1]), ui.ref(1));
  assert.equal(find(file, "storage-tree-row").state.attributes["aria-level"], 2);
  find(file, "storage-tree-row").events.onClick();
  await new Promise(setImmediate);
  assert.equal(find(root, "storage-preview-text").children[0].state.value, "<script>预览文本</script>");
  for (const name of ["storage-file-download", "storage-pagination", "storage-previous", "storage-next"]) assert.equal(find(root, name), null);
  assert.equal(tree.state.attributes.draggable, undefined);
  const expanded = tree.renderItem(ui.ref(tree.source.value[0]), ui.ref(0));
  find(expanded, "storage-tree-row").events.onClick();
  await new Promise(setImmediate);
  tree.model.setItems(tree.source.value);
  assert.equal(tree.model.items.length, 1);
  assert.equal(requests.filter(url => url.endsWith("/usage")).length, 1);
  folder.destroy(); file.destroy(); expanded.destroy();
  find(root, "storage-page").onUnmounted();
});

test("存储列表通过 ListViewV2 empty 展示 EmptyCard，加载及有文件时隐藏", async () => {
  const storage_bundle = await build({
    entryPoints: [fileURLToPath(new URL("../components/storage_tree.js", import.meta.url))],
    bundle: true, format: "iife", globalName: "StorageTreeModule", write: false,
  });
  vm.runInContext(storage_bundle.outputFiles[0].text, context);
  const rows = ui.refarr([]), busy = ui.ref(false), active_key = ui.ref("");
  const root = context.StorageTreeModule.StorageTreeView({ model: {
    state: { rows, busy, active_key }, methods: {},
  } });
  try {
    const tree = find(root, "storage-tree");
    assert.equal(find(root, "storage-empty"), find(tree, "storage-empty"));
    assert.ok(find(tree, "storage-empty-illustration"));
    assert.equal(find(tree, "storage-empty-title").children[0].state.value, "暂无文件");
    busy.as(true);
    assert.equal(find(root, "storage-empty"), null);
    busy.as(false);
    assert.ok(find(tree, "storage-empty"));
    rows.push({ id: "file", key: "file", title: "file", depth: 0 });
    assert.equal(find(root, "storage-empty"), null);
    rows.clear();
    assert.ok(find(tree, "storage-empty"));
  } finally { root.destroy(); rows.destroy(); busy.destroy(); active_key.destroy(); }
});

test("网络测试实际视图筛选并勾选 Cookie，最终及逐跳状态使用对应颜色的标签", async () => {
  const network_bundle = await build({
    entryPoints: [fileURLToPath(new URL("../pages/network.js", import.meta.url))],
    bundle: true, format: "iife", globalName: "NetworkTestModule", write: false,
  });
  Object.assign(context, { AbortController, Blob });
  context.FindRSSAdminShell = { Page: (_, children) => ui.View({ attributes: { n: "network-test-page" } }, children) };
  let status = 200;
  const submitted = [], copied = [], submitted_urls = [];
  context.navigator = { clipboard: { writeText: async text => copied.push(text) } };
  context.FindRSSAdminAuth = { fetch: async (url, options) => {
    if (url.endsWith("/cookie-domains")) return Response.json({ domains: [
      { domain: ".example.com", count: 2 }, { domain: "other.example", count: 1 },
    ] });
    submitted.push(JSON.parse(options.body));
    submitted_urls.push(url);
    if (url.endsWith("/curl")) return Response.json({ command: "curl 'https://www.example.com/'" });
    return Response.json({ status, body_kind: "file", elapsed_ms: 10,
      requests: [{ status, url: "https://www.example.com/", elapsed_ms: 10 }] });
  } };
  vm.runInContext(network_bundle.outputFiles[0].text, context);
  const root = context.NetworkTestModule.NetworkTestPage();
  try {
    assert.equal(find(root, "network-transport").state.attributes["aria-labelledby"], "network-transport-label");
    const transport = find(root, "network-transport");
    for (const key of ["ArrowDown", "ArrowDown", "Enter"]) transport.events.onKeyDown({ key, preventDefault() {}, stopPropagation() {} });
    find(root, "network-url").events.onInput({ target: { value: "https://www.example.com/" } });
    await find(root, "network-cookies-refresh").events.onClick();
    await new Promise(setImmediate);
    assert.equal(find(root, "network-cookie-domain-.example.com").state.attributes["aria-checked"], "true");
    assert.equal(find(root, "network-cookie-domain-other.example"), null);
    for (const [code, color] of [[200, "success"], [204, "success"], [301, "warning"], [304, "warning"], [403, "danger"], [500, "danger"], [null, "danger"], [101, "link"]]) {
      status = code;
      await find(root, "network-test-start").events.onClick();
      await new Promise(setImmediate);
      for (const name of ["network-status", "network-trace-status"]) {
        const badge = find(root, name);
        assert.ok(badge, name);
        assert.ok(badge.state.styleSet.includes("frui-badge-color-color-" + color), `${name}: ${code}`);
        assert.equal(badge.children[0].state.value, code == null ? (name === "network-status" ? "未收到 HTTP 响应" : "无响应") : `HTTP ${code}`);
      }
    }
    assert.deepEqual(submitted[0].cookie_domains, [".example.com"]);
    assert.equal(submitted[0].transport, "tcp");
    assert.equal(submitted[0].headers.Referer, "https://www.example.com/");
    const actions = find(root, "network-actions");
    assert.ok(find(actions, "network-test-start"));
    const copy_button = find(actions, "network-copy-curl");
    assert.equal(copy_button.state.attributes["aria-label"], "复制 curl 命令");
    await copy_button.events.onClick();
    await new Promise(setImmediate);
    assert.deepEqual(copied, ["curl 'https://www.example.com/'"]);
    assert.equal(submitted.at(-1).transport, "tcp");
    assert.equal(copy_button.state.attributes["aria-label"], "已复制 curl 命令");
    assert.ok(find(root, "network-curl-help"));
    await find(root, "network-header-add").events.onClick();
    const header_row = find(root, "network-header-row-4");
    assert.ok(header_row);
    const header_key = find(header_row, "network-header-key-4");
    const header_value = find(header_row, "network-header-value-4");
    header_key.events.onInput({ target: { value: "Origin" } });
    header_value.events.onInput({ target: { value: "https://local.example" } });
    assert.equal(find(root, "network-header-row-4"), header_row);
    assert.equal(find(root, "network-header-key-4"), header_key);
    await find(root, "network-test-start").events.onClick();
    await new Promise(setImmediate);
    assert.equal(submitted.at(-1).headers.Origin, "https://local.example");
    header_key.events.onInput({ target: { value: "Cache-Control" } });
    header_value.events.onInput({ target: { value: "no-cache" } });
    await copy_button.events.onClick();
    await new Promise(setImmediate);
    assert.equal(submitted.at(-1).headers["Cache-Control"], "no-cache");
    assert.equal(submitted.at(-1).headers.Origin, undefined);
    const remove_button = find(root, "network-header-remove-4");
    assert.equal(remove_button.state.attributes["aria-label"], "删除此请求头");
    assert.ok(find(remove_button, "button-icon"));
    assert.equal(find(remove_button, "button-content"), null);
    await find(root, "network-header-remove-confirm-4").events.onClick();
    assert.equal(find(root, "network-header-row-4"), header_row);
    assert.ok(find(root, "network-header-remove-confirm-4-title"));
    await find(root, "network-header-remove-confirm-4-cancel").events.onClick();
    assert.equal(find(root, "network-header-row-4"), header_row);
    assert.equal(find(root, "network-header-remove-confirm-4-confirm"), null);
    await find(root, "network-header-remove-confirm-4").events.onClick();
    await find(root, "network-header-remove-confirm-4-confirm").events.onClick();
    assert.equal(find(root, "network-header-row-4"), null);
    await find(root, "network-header-remove-confirm-0").events.onClick();
    await find(root, "network-header-remove-confirm-0-confirm").events.onClick();
    find(root, "network-url").events.onInput({ target: { value: "https://www.example.com/changed#section" } });
    assert.ok(find(root, "network-header-key-5"));
    find(root, "network-header-value-5").events.onInput({ target: { value: "https://manual.example/" } });
    await find(root, "network-test-start").events.onClick();
    await new Promise(setImmediate);
    assert.equal(submitted.at(-1).headers.Referer, "https://manual.example/");
    assert.equal(submitted.at(-1).headers["Cache-Control"], undefined);
    find(root, "network-url").events.onInput({ target: { value: "https://unmatched.example/" } });
    assert.equal(find(root, "network-cookie-domain-.example.com"), null);
    assert.ok(find(root, "network-cookies-no-match"));
    const execution = find(root, "network-execution");
    assert.equal(execution.state.attributes["aria-labelledby"], "network-execution-label");
    for (const key of ["ArrowDown", "ArrowDown", "Enter"]) execution.events.onKeyDown({ key, preventDefault() {}, stopPropagation() {} });
    await find(root, "network-test-start").events.onClick();
    assert.equal(submitted_urls.at(-1), "/admin/api/network-test?execution=script");
  } finally { root.onUnmounted(); }
});

test("登录页可切换密码可见性，提交原密码后跳转管理后台", async () => {
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
    password.onMounted({ target: { get$elm: () => ({ setAttribute() {} }) } });
    assert.equal(password.state.attributes.type, "password");
    password.events.onInput({ target: { value: "test-admin-password" } });
    const visibility = find(view, "admin-login-password-visibility");
    assert.equal(visibility.state.attributes.type, "button");
    assert.equal(visibility.state.attributes["aria-label"], "显示密码");
    assert.equal(visibility.state.attributes["aria-pressed"], "false");
    assert.ok(find(visibility, "admin-icon-eye"));
    visibility.events.onClick();
    assert.equal(password.state.attributes.type, "text");
    assert.equal(visibility.state.attributes["aria-label"], "隐藏密码");
    assert.equal(visibility.state.attributes["aria-pressed"], "true");
    assert.ok(find(visibility, "admin-icon-eye-off"));
    visibility.events.onClick();
    assert.equal(password.state.attributes.type, "password");
    assert.equal(visibility.state.attributes["aria-label"], "显示密码");
    assert.equal(visibility.state.attributes["aria-pressed"], "false");
    assert.ok(find(visibility, "admin-icon-eye"));
    assert.equal(password.state.value, "test-admin-password");
    assert.equal(requests.length, 0);
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
  context.document = { querySelector: () => null, addEventListener() {}, removeEventListener() {} };
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
    else if (options.method === "POST") { tokens = [token]; return Response.json({ device_token: token }); }
    return Response.json({ device_tokens: tokens });
  } };
  vm.runInContext("(() => {\n" + page_source("dashboard.js") +
    "\nglobalThis.device_tokens_model = DeviceTokensModel; globalThis.device_tokens_view = DeviceTokensView; })();", context);
  const model = context.device_tokens_model();
  await model.toggle();
  model.set_draft("name", "笔记本"); model.set_draft("note", "调试");
  await model.create();
  assert.deepEqual(requests.find(request => request.method === "POST").body, { name: "笔记本", note: "调试", expires_in_seconds: 2592000 });
  const view = context.device_tokens_view(model);
  try {
    assert.ok(find(view, "device-token-created-dialog"));
    assert.equal(find(view, "device-token-created-value").children[0].state.value, "frd_test-plaintext");
    assert.equal(model.revealed.value[token.id], undefined);
    await find(view, "copy-created-device-token-button").events.onClick();
    await new Promise(setImmediate);
    assert.deepEqual(copies, ["frd_test-plaintext"]);
    find(view, "close-created-device-token-button").events.onClick();
    assert.equal(find(view, "device-token-created-dialog"), null);
    assert.equal(model.created.value.token, "");
    copies.length = 0;
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
    const revoke = find(view, "revoke-device-token-button");
    revoke.events.onClick();
    assert.equal(requests.some(request => request.url.endsWith("/revoke")), false);
    find(view, "revoke-device-token-confirmation-cancel").events.onClick();
    assert.equal(model.tokens.value[0].status, "active");
    revoke.events.onClick();
    await find(view, "revoke-device-token-confirmation-confirm").events.onClick();
    await new Promise(setImmediate);
    assert.equal(model.tokens.value[0].status, "revoked");
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

test("创建设备 Token 期间离开页面，迟到的创建或明文响应不会打开弹窗", async t => {
  for (const stage of ["create", "reveal"]) {
    await t.test(stage, async () => {
      let complete;
      const requests = [];
      context.FindRSSAdminAuth.fetch = async (url, options) => {
        requests.push(url);
        if (url.endsWith("/reveal")) {
          return new Promise(resolve => { complete = () => resolve(Response.json({ token: "late-created-plaintext" })); });
        }
        if (options.method === "POST") {
          const value = { device_token: { id: "late-token", name: "迟到的设备" } };
          if (stage === "create") return new Promise(resolve => { complete = () => resolve(Response.json(value)); });
          return Response.json(value);
        }
        return Response.json({ device_tokens: [] });
      };
      vm.runInContext("(() => {\n" + page_source("dashboard.js") +
        "\nglobalThis.device_tokens_model = DeviceTokensModel; })();", context);
      const model = context.device_tokens_model(async () => true);
      await model.toggle();
      const pending = model.create();
      await new Promise(setImmediate);
      model.dispose();
      complete();
      await pending;
      assert.equal(model.created.value.token, "");
      assert.deepEqual(Object.keys(model.revealed.value), []);
      if (stage === "create") assert.equal(requests.some(url => url.endsWith("/reveal")), false);
    });
  }
});

test("后台使用真实阅读器组件，显式设置按钮图标并响应禁用状态", () => {
  assert.equal(context.vm, context.Timeless.vm);
  assert.equal(context.kit, context.Timeless.kit);
  assert.equal(context.ui, context.Timeless.ui);
  assert.equal(context.Timeless.getIconRegistry().save.attrs["data-n"], "icon-save");
  assert.ok(Object.keys(bundle.metafile.inputs).some(path => path.endsWith("frui/button.js")));
  assert.ok(Object.keys(bundle.metafile.inputs).some(path => path.endsWith("frui/select.js")));
  const disabled = context.Timeless.ref(false);
  const button = ui.Button({ disabled, icon: ui.Icon("save"), attributes: { n: "cookie-save-button" } }, ["保存"]);
  assert.ok(button.state.styleSet.includes("display-inline-flex"));
  assert.ok(find(button, "admin-icon-save"));
  disabled.set(true);
  assert.equal(button.state.attributes.disabled, true);
  button.onUnmounted();
});

test("Button 默认不按语义名称添加图标", () => {
  for (const action of ["reset", "save", "refresh", "delete", "remove", "submit", "new"]) {
    const button = ui.Button({ attributes: { n: `test-${action}-button` } }, [action]);
    try {
      assert.equal(find(button, "button-icon"), null, action);
      assert.equal(find(button, "button-loading"), null, action);
    } finally { button.onUnmounted(); }
  }
});

test("Button 默认隐藏加载图标，loading 切换时同步图标和禁用状态", () => {
  for (const href of [undefined, "/admin/scripts"]) {
    for (const props of [{}, { disabled: true }, { loading: false }, { loading: true }]) {
      const plain = ui.Button({ ...props, href }, ["新对话"]);
      assert.equal(Boolean(find(plain, "button-loading")), props.loading === true);
      plain.onUnmounted();
    }

    const loading = ui.ref(false);
    const button = ui.Button({ href, loading, icon: ui.Icon("settings") }, ["设置"]);
    try {
      for (const value of [false, true, false, true]) {
        loading.set(value);
        const spinner = find(button, "button-loading");
        if (value) {
          assert.ok(spinner);
          assert.ok(spinner.state.styleSet.includes("display-inline-flex"));
        } else assert.equal(spinner, null);
        assert.equal(find(button, "button-icon").state.style.display, value ? "none" : "inline-flex");
        assert.equal(button.state.attributes["aria-busy"], value ? "true" : undefined);
        assert.equal(href ? button.state.attributes["aria-disabled"] : button.state.attributes.disabled,
          value ? (href ? "true" : true) : undefined);
      }
    } finally { button.onUnmounted(); }
  }
});

test("厂商 logo 使用真实图片或主题遮罩，厂商列表和旧草稿不再包含 Workers AI", () => {
  const store = AISettingsStore({ ui, settings: ui.ref({ providers: [
    { id: "old-workers", type: "workers_ai", name: "Workers AI", models: [] },
  ] }), request_json: async () => ({}) });
  const editor = ui.AIPreferencesView({ store });
  try {
    assert.equal(AI_PROVIDER_PRESETS.some(provider => provider.type === "workers_ai"), false);
    assert.equal(store.state.settings_draft.value.ai_providers.some(provider => provider.type === "workers_ai"), false);
    assert.equal(find(editor, "settings-ai-nav-preset:workers_ai"), null);
    for (const provider of AI_PROVIDER_PRESETS) {
      const logo = ui.AIProviderLogoModel(provider).toValue();
      assert.ok(logo.src, provider.id);
      assert.ok(readFileSync(new URL("../../public" + logo.src, import.meta.url), "utf8").includes("<svg"));
      const card = find(editor, "settings-ai-nav-preset:" + provider.id);
      assert.ok(card, provider.id);
      if (logo.monochrome) assert.ok(find(card, "ai-provider-logo-mask"), provider.id);
      else {
        const image = find(card, "ai-provider-logo-image");
        assert.equal(image.t, "img", provider.id);
        assert.equal(image.state.src, logo.src, provider.id);
      }
    }
  } finally { editor.onUnmounted(); store.destroy(); }
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

test("Select 菜单宽度跟随触发框，布局改变后鼠标和键盘重新打开均同步宽度", () => {
  let width = 112;
  const select = ui.Select({ attributes: { n: "width-select" },
    options: [{ value: "one", label: "很长的选项名称".repeat(20) }] });
  const trigger = find(select, "width-select");
  const element = { getBoundingClientRect: () => ({ x: 0, y: 0, width, height: 32, top: 0, left: 0, right: width, bottom: 32 }), focus() {} };
  try {
    trigger.onMounted({ target: element });
    trigger.events.onClick({ currentTarget: element });
    assert.equal(find(select, "width-select-popup").state.style.width, "112px");
    find(select, "width-select-option-one").events.onClick();
    width = 320;
    trigger.events.onKeyDown({ key: "ArrowDown", preventDefault() {}, stopPropagation() {} });
    assert.equal(find(select, "width-select-popup").state.style.width, "320px");
    find(select, "width-select-option-one").events.onClick();
    width = 180;
    trigger.events.onClick({ currentTarget: element });
    assert.equal(find(select, "width-select-popup").state.style.width, "180px");
  } finally { select.onUnmounted(); }
});

test("社媒主页使用真实 ArrayFieldCore，立即编辑、确认删中间项再新增及清空均同步草稿", async () => {
  ui.DOM = {};
  context.document = { querySelector: () => null };
  context.FindRSSAdminAuth = { fetch() {} };
  context.FindRSSAdminShell = {};
  vm.runInContext("(() => {\n" + page_source("discovery.js") +
    "\nglobalThis.social_model = DiscoveryAdminViewModel(); globalThis.social_editor = () => SourceSocialUrlsView({ store: social_model }); })();", context);
  const all = (node, name) => [
    ...(node?.state?.attributes?.n === name ? [node] : []),
    ...(node?.children || []).flatMap(child => all(child, name)),
  ];
  const model = context.social_model;
  const original = ["https://x.com/one", "https://x.com/two", "https://x.com/three"];
  model.methods.set_draft("social_urls", original);
  const editor = context.social_editor();
  const values = () => Array.from(model.state.draft_social_urls.value);
  try {
    let inputs = all(editor, "discovery-source-social-input");
    assert.equal(inputs.length, 3);
    inputs[0].events.onInput({ target: { value: "https://x.com/edited" } });
    assert.deepEqual(values(), ["https://x.com/edited", ...original.slice(1)]);
    all(editor, "discovery-source-social-remove")[1].events.onClick();
    assert.deepEqual(values(), ["https://x.com/edited", original[1], original[2]]);
    await find(editor, "discovery-source-social-remove-confirmation-confirm").events.onClick();
    assert.deepEqual(values(), ["https://x.com/edited", original[2]]);
    find(editor, "discovery-source-social-add").events.onClick();
    inputs = all(editor, "discovery-source-social-input");
    assert.equal(inputs.length, 3);
    inputs[2].events.onInput({ target: { value: "https://x.com/new" } });
    assert.deepEqual(values(), ["https://x.com/edited", original[2], "https://x.com/new"]);
    all(editor, "discovery-source-social-remove")[1].events.onClick();
    await find(editor, "discovery-source-social-remove-confirmation-confirm").events.onClick();
    assert.deepEqual(values(), ["https://x.com/edited", "https://x.com/new"]);
    while (all(editor, "discovery-source-social-remove").length) {
      all(editor, "discovery-source-social-remove")[0].events.onClick();
      await find(editor, "discovery-source-social-remove-confirmation-confirm").events.onClick();
    }
    assert.deepEqual(values(), []);
    find(editor, "discovery-source-social-add").events.onClick();
    find(editor, "discovery-source-social-input").events.onInput({ target: { value: "https://x.com/fresh" } });
    assert.deepEqual(values(), ["https://x.com/fresh"]);
  } finally { editor.onUnmounted(); }
});

test("抓取规则不再提供每天指定时间，单时间点显示在多个时间点中", () => {
  const model = PollPolicyModel({ ui });
  model.methods.reset({ mode: "times", times: ["08:30"], days: [0,1,2,3,4,5,6], timezone: "UTC" });
  const root = PollPolicyView(model);
  try {
    assert.ok(find(root, "poll-policy-times"));
    assert.equal(find(root, "poll-policy-time"), null);
    find(root, "poll-policy-mode").events.onClick();
    assert.ok(find(root, "poll-policy-mode-option-times"));
    assert.equal(find(root, "poll-policy-mode-option-daily"), null);
  } finally {
    root.onUnmounted();
  }
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
  const token_pager = PaginationView(ui, { model, name: "access-token-pagination", label: "Token 分页" });
  for (const suffix of ["first", "prev", "next", "last"]) {
    const button = find(token_pager, "access-token-pagination-" + suffix);
    assert.equal(find(button, "button-icon"), null);
    assert.equal(find(button, "admin-icon-lock"), null);
    assert.equal(button.state.attributes.disabled, find(pager, "pager-" + suffix).state.attributes.disabled);
  }
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
  assert.equal(find(token_pager, "access-token-pagination-next").state.attributes.disabled, true);
  assert.equal(find(token_pager, "button-icon"), null);
  pager.onUnmounted();
  token_pager.onUnmounted();
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
  for (const name of ["index", "login", "oauth"]) {
    const html = readFileSync(new URL("../" + name + ".html", import.meta.url), "utf8");
    const prefix = name === "login" ? "./" : "/admin/";
    assert.ok(html.includes(`href="${prefix}frui.css"`));
    assert.match(html, /assets\/timeless\/0\.34\.2\//);
    assert.ok(html.indexOf(`src="${prefix}ui.js"`) > html.indexOf("timeless.dom.umd.min.js"));
    assert.ok(html.indexOf(`src="${prefix}ui.js"`) < html.indexOf(`src="${prefix}${name === "index" ? "app" : name}.js"`));
  }
});

test("订阅源表格使用 Link 与 CopyButton，复制实际地址并显示成功或失败状态", async () => {
  ui.DOM = {};
  context.document = { querySelector: () => null };
  context.FindRSSAdminAuth = { fetch() {} };
  context.FindRSSAdminShell = {};
  context.FindRSSAdminPages = {};
  vm.runInContext("(() => {\n" + page_source("discovery.js") +
    "\nglobalThis.discovery_model = DiscoveryAdminViewModel(); globalThis.discovery_card = source => SourceRowView({ store: discovery_model, source: normalize_source(source) }); globalThis.discovery_list = () => SourceListView({ store: discovery_model }); })();", context);
  const list = context.discovery_list();
  assert.equal(list.state.styleSet.includes("frui-card"), false);
  assert.equal(find(list, "card-body"), null);
  assert.equal(find(list, "discovery-source-list-heading-group"), null);
  const source = { id: "one", title: "示例", website: "https://example.com", feed_url: "https://feeds.example.com/atom/demo",
    social_url: "https://x.com/example",
    feed_url_template: "{{hostname}}/atom/demo", avatar_url: "", enabled: true, tags: [], snapshot: { saved_at: 0, articles: [], error: "" } };
  const copied = [];
  const click_copy = async button => { button.events.onClick(); await new Promise(setImmediate); };
  context.navigator = { clipboard: { async writeText(url) { copied.push(url); } } };
  const card = context.discovery_card(source);
  for (const [kind, name, url] of [["website", "website", source.website], ["social", "social", source.social_url], ["feed", "feed-link", source.feed_url]]) {
    const link = find(card, "discovery-source-row-" + name);
    assert.equal(link.t, ui.Link({ href: url }).t);
    assert.equal(link.state.href, url);
    assert.equal(link.state.target, "_blank");
    assert.equal(link.state.rel, "noopener noreferrer");
    const copy = find(card, "discovery-source-row-copy-" + kind);
    assert.ok(copy.state.styleSet.includes("display-inline-flex"));
    await click_copy(copy);
    assert.equal(copy.state.attributes["aria-label"], "已复制");
  }
  assert.deepEqual(copied, [source.website, source.social_url, source.feed_url]);
  card.onUnmounted();

  const template_card = context.discovery_card({ ...source, website: "", feed_url: source.feed_url_template });
  assert.equal(find(template_card, "discovery-source-row-website-address"), null);
  assert.equal(find(template_card, "discovery-source-row-copy-website"), null);
  assert.equal(find(template_card, "discovery-source-row-feed-link"), null);
  assert.ok(find(template_card, "discovery-source-row-feed-value"));
  await click_copy(find(template_card, "discovery-source-row-copy-feed"));
  assert.equal(copied.at(-1), source.feed_url_template);
  template_card.onUnmounted();

  context.navigator.clipboard.writeText = async () => { throw new Error("denied"); };
  const failed_card = context.discovery_card(source);
  const failed_copy = find(failed_card, "discovery-source-row-copy-feed");
  await click_copy(failed_copy);
  assert.equal(failed_copy.state.attributes["aria-label"], "复制 RSS/Atom 地址");
  assert.match(context.discovery_model.state.list_error.value, /复制失败/);
  context.navigator.clipboard.writeText = async () => {};
  await click_copy(failed_copy);
  assert.equal(context.discovery_model.state.list_error.value, "");
  failed_card.onUnmounted();
});

test("订阅源搜索区右侧可刷新列表，加载期间禁用按钮并保留筛选", async () => {
  ui.DOM = {};
  context.document = { querySelector: () => null };
  let finish, calls = 0, delayed = false;
  context.FindRSSAdminAuth = { fetch: async url => {
    assert.match(url, /^\/admin\/api\/discovery\/sources\?limit=20&offset=0/);
    if (!delayed) return Response.json({ sources: [], total_count: 0 });
    calls++;
    return new Promise(resolve => { finish = resolve; });
  } };
  vm.runInContext("(() => {\n" + page_source("discovery.js") +
    "\nglobalThis.refresh_model = DiscoveryAdminViewModel(); globalThis.refresh_list = SourceListView({ store: refresh_model }); })();", context);
  const root = context.refresh_list;
  const model = context.refresh_model;
  try {
    const form = find(root, "discovery-source-filter-form");
    const refresh = find(form, "discovery-source-list-refresh");
    assert.equal(form.children.at(-1), refresh);
    await model.methods.set_filter("query", "更新");
    await model.methods.set_filter("status", "enabled");
    delayed = true;
    const pending = refresh.events.onClick();
    assert.equal(refresh.state.attributes.disabled, true);
    finish(Response.json({ sources: [{ id: "one", title: "更新的源", enabled: true }], total_count: 1 }));
    await pending; await new Promise(setImmediate);
    assert.equal(calls, 1);
    assert.equal(refresh.state.attributes.disabled, undefined);
    assert.equal(model.state.query.value, "更新");
    assert.equal(model.state.filter_status.value, "enabled");
    assert.equal(model.state.sources.value[0].title, "更新的源");
    assert.ok(find(root, "discovery-source-row"));
  } finally { root.onUnmounted(); }
});

test("订阅源表格选择控制批量菜单，启停后行内容和数量同步更新，空表保留列头", async () => {
  ui.DOM = {};
  context.document = { querySelector: () => null };
  const sources = [{ id: "one", title: "源一", enabled: true }, { id: "two", title: "源二", enabled: true }];
  context.FindRSSAdminAuth = { fetch: async (url, options) => {
    if (options.method === "PATCH") {
      const source = sources.find(source => url.endsWith("/" + source.id));
      Object.assign(source, JSON.parse(options.body));
      return Response.json({ source });
    }
    return paged_fixture(Response.json({ sources }), url);
  } };
  vm.runInContext("(() => {\n" + page_source("discovery.js") +
    "\nglobalThis.table_model = DiscoveryAdminViewModel(); globalThis.table_list = SourceListView({ store: table_model }); })();", context);
  const root = context.table_list;
  const model = context.table_model;
  try {
    assert.equal(find(root, "discovery-source-table").state.attributes.role, "table");
    assert.equal(find(root, "discovery-source-refresh-status-button"), null);
    assert.ok(find(root, "discovery-source-table-state"));
    await model.methods.refresh_list();
    await new Promise(setImmediate);
    assert.ok(find(root, "discovery-source-row"));
    const poll_help = find(root, "discovery-source-poll-rule-help");
    assert.ok(poll_help);
    assert.equal(poll_help.state.attributes["aria-label"], "查看抓取规则");
    assert.match(poll_help.state.attributes["aria-describedby"], /^frui-tooltip-/);
    const toaster = ui.Toaster();
    const host = ui.TooltipHost();
    try {
      poll_help.onMounted({ target: {
        getBoundingClientRect: () => ({ x: 20, y: 20, width: 14, height: 14 }),
        addEventListener() {}, removeEventListener() {}, contains: () => false,
      } });
      poll_help.events.onMouseEnter();
      assert.equal(poll_help.state.attributes["aria-describedby"], find(host, "tooltip-content").state.attributes.id);
      assert.match(find(host, "tooltip-body").children[0].state.value, /^抓取规则：/);
      poll_help.events.onClick();
      assert.ok(find(host, "tooltip-content").state.styleSet.includes("animate-tooltip-out"));
      assert.equal(find(toaster, "toast"), null);
    } finally { host.onUnmounted(); toaster.onUnmounted(); }
    assert.ok(find(find(root, "discovery-source-next-snapshot-details"), "discovery-source-poll-rule-help"));
    assert.equal(find(root, "discovery-source-bulk-menu").state.attributes.disabled, true);
    find(root, "discovery-source-select").events.onClick({});
    assert.equal(model.state.selected_ids.value.length, 1);
    assert.equal(find(root, "discovery-source-select").state.attributes["aria-checked"], "true");
    assert.equal(find(root, "discovery-source-bulk-menu").state.attributes.disabled, undefined);
    find(root, "discovery-source-select-page").events.onClick({});
    assert.equal(model.state.selected_ids.value.length, 2);
    await model.methods.bulk_action("disable");
    await new Promise(setImmediate);
    assert.equal(find(root, "discovery-source-row"), null);
    assert.ok(find(root, "discovery-source-header-identity"));
    assert.ok(find(root, "discovery-source-table-state"));
    model.methods.set_filter("status", "all");
    await new Promise(setImmediate);
    assert.equal(find(root, "discovery-source-enabled-control").state.attributes["aria-checked"], "false");
    assert.equal(find(root, "discovery-source-public-control").state.attributes["aria-checked"], "true");
    assert.equal(find(root, "discovery-source-toggle-button"), null);
    assert.ok(find(root, "discovery-source-header-platform"));
    assert.ok(find(find(root, "discovery-source-cell-platform"), "discovery-platform-option"));
    assert.equal(find(find(root, "discovery-source-cell-identity"), "discovery-platform-option"), null);
    const metadata = find(root, "discovery-source-row-metadata");
    assert.ok(metadata.state.styleSet.includes("display-grid"));
    assert.equal(metadata.state.style["grid-template-columns"], "64px minmax(0, 1fr)");
    assert.ok(find(metadata, "discovery-source-row-metadata-snapshot-label"));
    assert.equal(find(metadata, "discovery-source-row-metadata-poll-rule-value"), null);
    assert.equal(find(root, "discovery-source-row-updated"), null);
    assert.equal(model.state.selected_ids.value.length, 0);
  } finally { root.onUnmounted(); }
});

test("抓取与快照每 60 秒仅更新相对时间，保留列表与选择，卸载后停止计时", async () => {
  ui.DOM = {};
  context.FindRSSAdminShell ||= {};
  context.document = { querySelector: () => null };
  let current_time = Date.UTC(2026, 9, 17, 12);
  let requests = 0;
  const timers = new Map();
  let timer_id = 0;
  const previous_date = context.Date;
  const previous_set_interval = context.setInterval;
  const previous_clear_interval = context.clearInterval;
  context.Date = class extends Date { static now() { return current_time; } };
  context.setInterval = (callback, delay) => {
    assert.equal(delay, 60_000);
    timers.set(++timer_id, callback);
    return timer_id;
  };
  context.clearInterval = id => timers.delete(id);
  context.FindRSSAdminAuth = { fetch: async () => {
    requests++;
    return Response.json({ sources: [{ id: "relative", title: "相对时间", enabled: true,
      feed_url: "https://example.com/rss/time", next_snapshot_at: current_time + 60_000,
      cache: { saved_at: current_time - 600_000, status: "fresh", bytes: 100 },
      snapshot: { saved_at: current_time - 600_000, articles: [], error: "" },
    }] });
  } };
  let root;
  try {
    vm.runInContext("(() => {\n" + page_source("discovery.js") +
      "\nglobalThis.relative_model = DiscoveryAdminViewModel(); globalThis.relative_table = SourceTableView({ store: relative_model }); })();", context);
    root = context.relative_table;
    const model = context.relative_model;
    await model.methods.refresh_list();
    await new Promise(setImmediate);
    model.methods.toggle_selection("relative");
    const row = find(root, "discovery-source-row");
    const sources = model.state.sources.value;
    const displayed = {};
    for (const name of ["xml-saved-at", "snapshot-saved-at", "next-snapshot-time"]) {
      const time = find(root, "discovery-source-" + name);
      assert.match(time.state.attributes.title, /2026-10-17/);
      displayed[name] = time.children[0].state.value;
      time.children[0].$elm = { setText(value) { displayed[name] = value; } };
    }
    assert.deepEqual(displayed, { "xml-saved-at": "10分钟前", "snapshot-saved-at": "10分钟前", "next-snapshot-time": "1分钟后" });
    root.onMounted();
    root.onMounted();
    assert.equal(timers.size, 1);
    const request_count = requests;
    current_time += 60_000;
    for (const callback of timers.values()) callback();
    assert.deepEqual(displayed, { "xml-saved-at": "11分钟前", "snapshot-saved-at": "11分钟前", "next-snapshot-time": "等待调度" });
    assert.equal(requests, request_count);
    assert.equal(model.state.sources.value, sources);
    assert.equal(find(root, "discovery-source-row"), row);
    assert.deepEqual(Array.from(model.state.selected_ids.value), ["relative"]);
    root.onUnmounted();
    assert.equal(timers.size, 0);
    current_time += 60_000;
    root.onMounted();
    assert.equal(displayed["xml-saved-at"], "12分钟前");
    assert.equal(timers.size, 1);
  } finally {
    root?.onUnmounted();
    if (previous_date === undefined) delete context.Date;
    else context.Date = previous_date;
    context.setInterval = previous_set_interval;
    context.clearInterval = previous_clear_interval;
  }
});

test("逾期补抓按钮显示范围说明、提交 loading 和结果状态", async () => {
  ui.DOM = {};
  context.FindRSSAdminShell ||= {};
  context.document = { querySelector: () => null };
  let finish;
  context.FindRSSAdminAuth = { fetch: async url => url.endsWith("/recover-overdue")
    ? new Promise(resolve => { finish = resolve; }) : Response.json({ sources: [] }) };
  vm.runInContext("(() => {\n" + page_source("discovery.js") +
    "\nglobalThis.recovery_model = DiscoveryAdminViewModel(); globalThis.recovery_button = OverdueRecoveryButton({ store: recovery_model }); globalThis.recovery_list = SourceListView({ store: recovery_model }); })();", context);
  const model = context.recovery_model, button = context.recovery_button;
  try {
    assert.match(button.state.attributes.title, /全部启用.*至少 5 小时/);
    assert.match(button.state.attributes.title, /不受分页和筛选影响/);
    const pending = button.events.onClick();
    assert.equal(model.state.recovery_busy.value, true);
    assert.equal(button.state.attributes.disabled, true);
    assert.equal(button.state.attributes["aria-busy"], "true");
    finish(Response.json({ matched_count: 2, queued_count: 1, skipped_count: 1 }, { status: 202 }));
    await pending;
    await new Promise(setImmediate);
    assert.equal(model.state.recovery_busy.value, false);
    assert.equal(button.state.attributes.disabled, undefined);
    assert.equal(button.state.attributes["aria-busy"], undefined);
    const result = find(context.recovery_list, "discovery-source-recovery-message");
    assert.equal(result.state.attributes.role, "status");
    assert.match(result.children[0].state.value, /已提交 1 个补抓任务/);
  } finally {
    button.onUnmounted();
    model.methods.destroy();
  }
});

test("刷新快照完成后按当前时间显示下次抓取，不受表格上一分钟的时钟影响", async () => {
  ui.DOM = {};
  context.FindRSSAdminShell ||= {};
  context.document = { querySelector: () => null };
  let current_time = Date.UTC(2026, 9, 18, 12);
  const previous_date = context.Date;
  context.Date = class extends Date { static now() { return current_time; } };
  let finish, saved_at = current_time - 600_000, next_snapshot_at = current_time + 1_800_000;
  context.FindRSSAdminAuth = { fetch: async (url, options) => {
    if (url.startsWith("/admin/api/background-tasks?")) return Response.json({ tasks: [] });
    if (url.endsWith("/snapshot") && options.method === "POST") return new Promise(resolve => { finish = resolve; });
    return Response.json({ sources: [{ id: "refresh-time", title: "每60分钟", enabled: true,
      feed_url: "https://example.com/feed", poll_policy: { mode: "interval", interval: 3600 },
      poll_effective: { mode: "interval", interval: 3600 }, next_snapshot_at,
      snapshot: { saved_at, articles: [], error: "" },
    }] });
  } };
  let root, model;
  try {
    vm.runInContext("(() => {\n" + page_source("discovery.js") +
      "\nglobalThis.refresh_time_model = DiscoveryAdminViewModel(); globalThis.refresh_time_table = SourceTableView({ store: refresh_time_model }); })();", context);
    root = context.refresh_time_table;
    model = context.refresh_time_model;
    await model.methods.start();
    root.onMounted();
    assert.equal(find(root, "discovery-source-next-snapshot-time").children[0].state.value, "30分钟后");
    // 距上次分钟计时已有 45 秒；抓取耗时 2 秒，期间没有触发分钟计时器。
    current_time += 45_000;
    next_snapshot_at = current_time + 3_600_000;
    const pending = model.methods.refresh_snapshot("refresh-time");
    current_time += 2000;
    saved_at = current_time;
    finish(Response.json({ snapshot: { saved_at, articles: [], error: "" }, next_snapshot_at,
      poll_effective: { mode: "interval", interval: 3600 } }));
    assert.equal(await pending, true);
    assert.equal(model.state.sources.value[0].next_snapshot_at, next_snapshot_at);
    assert.equal(find(root, "discovery-source-next-snapshot-time").children[0].state.value, "60分钟后");
    assert.equal(find(root, "discovery-source-snapshot-saved-at").children[0].state.value, "刚刚");
    await model.methods.refresh_list();
    assert.equal(find(root, "discovery-source-next-snapshot-time").children[0].state.value, "60分钟后");
  } finally {
    root?.onUnmounted();
    model?.methods.destroy();
    if (previous_date === undefined) delete context.Date;
    else context.Date = previous_date;
  }
});

test("启用与公开 Switch 直接保存明确状态，请求中禁用，失败恢复原开关", async () => {
  ui.DOM = {};
  context.document = { querySelector: () => null };
  let saved = { id: "switch", title: "开关测试", enabled: true, require_token: false, credit_cost: 7 };
  const writes = [];
  let finish;
  context.FindRSSAdminAuth = { fetch: async (_url, options) => {
    if (options.method !== "PATCH") return Response.json({ sources: [saved] });
    const body = JSON.parse(options.body);
    writes.push(body);
    return new Promise(resolve => { finish = error => {
      if (error) return resolve(Response.json({ error }, { status: 500 }));
      saved = { ...saved, ...body };
      resolve(Response.json({ source: saved }));
    }; });
  } };
  vm.runInContext("(() => {\n" + page_source("discovery.js") +
    "\nglobalThis.switch_model = DiscoveryAdminViewModel(); switch_model.methods.set_filter('status', 'all'); globalThis.switch_list = SourceListView({ store: switch_model }); })();", context);
  const root = context.switch_list;
  const model = context.switch_model;
  const toaster = ui.Toaster();
  try {
    assert.equal(find(root, "discovery-source-list-message"), null);
    await model.methods.refresh_list();
    await new Promise(setImmediate);
    find(root, "discovery-source-public-control").events.onClick();
    assert.deepEqual(writes, [{ require_token: true }]);
    assert.equal(find(root, "discovery-source-enabled-control").state.attributes["aria-disabled"], "true");
    find(root, "discovery-source-enabled-control").events.onClick();
    find(root, "discovery-source-public-control").events.onClick();
    assert.equal(writes.length, 1);
    finish("保存失败");
    await new Promise(setImmediate);
    assert.equal(find(root, "discovery-source-public-control").state.attributes["aria-checked"], "true");
    assert.equal(find(root, "discovery-source-public-control").state.attributes["aria-disabled"], "false");
    assert.equal(model.state.list_error.value, "保存失败");
    assert.equal(find(toaster, "toast"), null);
    find(root, "discovery-source-public-control").events.onClick();
    finish();
    await new Promise(setImmediate);
    assert.equal(find(root, "discovery-source-public-control").state.attributes["aria-checked"], "false");
    assert.equal(model.state.sources.value[0].require_token, true);
    assert.equal(model.state.sources.value[0].credit_cost, 7);
    assert.equal(model.state.list_error.value, "");
    assert.equal(find(toaster, "toast").children[0].children[0].state.value, "开关测试 已设为需要 token 访问。");
    find(root, "discovery-source-public-control").events.onClick();
    finish();
    await new Promise(setImmediate);
    assert.deepEqual(writes.at(-1), { require_token: false });
    assert.equal(find(root, "discovery-source-public-control").state.attributes["aria-checked"], "true");
    find(root, "discovery-source-enabled-control").events.onClick();
    finish();
    await new Promise(setImmediate);
    assert.deepEqual(writes.at(-1), { enabled: false });
    assert.equal(find(root, "discovery-source-enabled-control").state.attributes["aria-checked"], "false");
    assert.equal(find(root, "discovery-source-toggle-button"), null);
    assert.equal(find(toaster, "toast").children[0].children[0].state.value, "开关测试 已停用。");
  } finally { root.onUnmounted(); toaster.onUnmounted(); }
});

test("刷新失败在对应行显示错误、警示时间与原因提示，重试成功后恢复", async () => {
  ui.DOM = {};
  context.document = { querySelector: () => null };
  let fail = true;
  context.FindRSSAdminAuth = { fetch: async () => fail
    ? Response.json({ error: "脚本执行失败：设备离线\n请稍后重试" }, { status: 503 })
    : Response.json({ snapshot: { saved_at: 20, articles: [], error: "" } }) };
  context.FindRSSAdminShell = {};
  context.FindRSSAdminPages = {};
  vm.runInContext("(() => {\n" + page_source("discovery.js") +
    "\nglobalThis.snapshot_model = DiscoveryAdminViewModel(); globalThis.snapshot_card = source => SourceRowView({ store: snapshot_model, source: normalize_source(source) }); })();", context);
  const source = { id: "one", title: "示例", feed_url: "https://example.com/feed", enabled: true,
    cache: { status: "fresh", saved_at: 10 }, snapshot: { saved_at: 10, articles: [], error: "" } };
  context.snapshot_model.state.sources.as([source]);
  const card = context.snapshot_card(source);
  const other_card = context.snapshot_card({ ...source, id: "two" });
  try {
    const error = find(card, "discovery-source-snapshot-error");
    const actions = find(card, "discovery-source-row-actions");
    assert.equal(actions.children.indexOf(error), 1);
    assert.equal(error.state.attributes.role, "alert");
    let displayed = error.children[0].state.value;
    error.children[0].$elm = { setText(value) { displayed = value; } };
    let other_displayed = find(other_card, "discovery-source-snapshot-error").children[0].state.value;
    find(other_card, "discovery-source-snapshot-error").children[0].$elm = { setText(value) { other_displayed = value; } };
    await find(card, "discovery-source-refresh-snapshot").events.onClick();
    await new Promise(setImmediate);
    assert.equal(displayed, "脚本执行失败：设备离线\n请稍后重试");
    assert.equal(other_displayed, "");
    for (const name of ["xml-saved-at", "snapshot-saved-at"]) {
      assert.ok(find(card, "discovery-source-" + name).state.styleSet.includes("text-warning"));
      const info = find(card, "discovery-source-" + name + "-info");
      assert.equal(info.state.attributes.title, undefined);
      assert.match(info.state.attributes["aria-label"], /设备离线\n请稍后重试/);
      assert.match(info.state.attributes["aria-describedby"], /^frui-tooltip-/);
      assert.match(info.state.attributes["aria-label"], /上次成功时间/);
      assert.ok(find(info, "admin-icon-info-circle"));
      assert.equal(find(other_card, "discovery-source-" + name + "-info"), null);
    }
    assert.equal(context.snapshot_model.state.list_error.value, "");
    fail = false;
    await find(card, "discovery-source-refresh-snapshot").events.onClick();
    await new Promise(setImmediate);
    assert.equal(displayed, "");
    for (const name of ["xml-saved-at", "snapshot-saved-at"]) {
      assert.equal(find(card, "discovery-source-" + name).state.styleSet.includes("text-warning"), false);
      assert.equal(find(card, "discovery-source-" + name + "-info"), null);
    }
  } finally { card.onUnmounted(); other_card.onUnmounted(); }
});

test("自动抓取失败保留成功时间，info 图标悬停展示原因且不触发 Toaster，私密源仅提示 XML 错误", () => {
  ui.DOM = {};
  context.FindRSSAdminAuth = { fetch: async () => Response.json({ sources: [] }) };
  context.FindRSSAdminShell = {};
  vm.runInContext("(() => {\n" + page_source("discovery.js") +
    "\nglobalThis.failed_snapshot_view = source => SourceSnapshotView({ source: normalize_source(source) }); })();", context);
  for (const saved_at of [0, 10]) {
    for (const require_token of [false, true]) {
      const root = context.failed_snapshot_view({ enabled: true, feed_url: "{{hostname}}/rss/example", require_token,
        cache: { saved_at, status: saved_at ? "fresh" : "empty" },
        snapshot: { saved_at, error: "上游返回 HTTP 502", articles: [] } });
      const toaster = ui.Toaster();
      const host = ui.TooltipHost();
      const transition = find(host, "tooltip-positioner").children[0];
      // 模拟 DOM 在退场动画结束后卸载子树、再次显示时挂载子树。
      function unmount(node) {
        for (const child of node.children || []) unmount(child);
        node.onUnmounted?.();
      }
      transition.$elm = {
        removeChildren() { for (const child of transition.children) unmount(child); },
        insertChildren(children) { for (const child of children) child.onMounted?.({ target: child.$elm }); },
      };
      function close_tooltip(trigger) {
        trigger.events.onMouseLeave();
        const element = {};
        find(host, "tooltip-content").events.onAnimationEnd({ target: element, currentTarget: element });
      }
      try {
        const poll_help = find(root, "discovery-source-poll-rule-help");
        if (poll_help) {
          poll_help.events.onMouseEnter();
          assert.match(find(host, "tooltip-body").children[0].state.value, /^抓取规则：/);
          close_tooltip(poll_help);
        }
        for (const name of ["xml-saved-at", ...(!require_token ? ["snapshot-saved-at"] : [])]) {
          const time = find(root, "discovery-source-" + name);
          assert.ok(time.state.styleSet.includes(saved_at ? "text-warning" : "text-danger"));
          if (!saved_at) assert.match(time.children[0].state.value, /失败/);
          const info = find(root, "discovery-source-" + name + "-info");
          assert.equal(info.state.attributes.title, undefined);
          const handlers = {};
          info.onMounted({ target: {
            getBoundingClientRect: () => ({ x: 20, y: 20, width: 14, height: 14 }),
            addEventListener: (name, handler) => { handlers[name] = handler; },
            removeEventListener: name => { delete handlers[name]; },
            contains: () => false,
          } });
          info.events.onMouseEnter();
          let tooltip = find(host, "tooltip-content");
          assert.equal(tooltip.state.attributes.role, "tooltip");
          assert.equal(info.state.attributes["aria-describedby"], tooltip.state.attributes.id);
          assert.match(find(host, "tooltip-body").children[0].state.value, /HTTP 502/);
          assert.match(find(host, "tooltip-body").children[0].state.value,
            name === "xml-saved-at" ? /^抓取失败：/ : /^快照生成失败：/);
          close_tooltip(info);
          info.events.onMouseEnter();
          tooltip = find(host, "tooltip-content");
          assert.match(find(host, "tooltip-body").children[0].state.value, /HTTP 502/);
          info.events.onClick();
          assert.equal(find(toaster, "toast"), null);
          assert.ok(tooltip.state.styleSet.includes("animate-tooltip-out"));
          const element = {};
          tooltip.events.onAnimationEnd({ target: element, currentTarget: element });
          assert.equal(find(host, "tooltip-positioner").state.style.display, "none");
          info.onUnmounted();
          assert.deepEqual(Object.keys(handlers), []);
        }
        if (require_token) assert.equal(find(root, "discovery-source-snapshot-saved-at-info"), null);
      } finally { root.onUnmounted(); host.onUnmounted(); toaster.onUnmounted(); }
    }
  }
});

test("Tooltip 共用浮层，焦点和悬停显示最新内容，Esc 收起，卸载清理事件与当前内容", () => {
  const previous_document = context.document;
  const document_handlers = new Map();
  context.document = {
    addEventListener: (name, handler) => document_handlers.set(name, handler),
    removeEventListener: name => document_handlers.delete(name),
  };
  const host = ui.TooltipHost();
  const explanation = ui.ref("初始原因");
  const first = ui.Tooltip({ as: "button", content: explanation });
  const second = ui.Tooltip({ as: "button", content: "另一原因" });
  function mount(trigger) {
    const handlers = new Map();
    trigger.onMounted({ target: {
      getBoundingClientRect: () => ({ x: 20, y: 20, width: 14, height: 14 }),
      addEventListener: (name, handler) => handlers.set(name, handler),
      removeEventListener: name => handlers.delete(name),
      contains: () => false,
    } });
    return handlers;
  }
  function finish_animation() {
    const element = {};
    find(host, "tooltip-content").events.onAnimationEnd({ target: element, currentTarget: element });
  }
  const first_handlers = mount(first);
  const second_handlers = mount(second);
  host.onMounted();
  try {
    const positioner = find(host, "tooltip-positioner");
    assert.equal(positioner.state.style.display, "none");
    first_handlers.get("focusin")();
    assert.equal(positioner.state.style.display, "block");
    assert.equal(find(host, "tooltip-body").children[0].state.value, "初始原因");
    finish_animation();
    let displayed;
    find(host, "tooltip-body").children[0].$elm = { setText(value) { displayed = value; } };
    explanation.set("更新原因");
    assert.equal(displayed, "更新原因");
    first.events.onMouseEnter();
    first.events.onMouseLeave();
    assert.ok(!find(host, "tooltip-content").state.styleSet.includes("animate-tooltip-out"), "保留键盘焦点时继续显示");
    document_handlers.get("keydown")({ key: "Escape" });
    assert.ok(find(host, "tooltip-content").state.styleSet.includes("animate-tooltip-out"));
    finish_animation();
    assert.equal(positioner.state.style.display, "none");
    second.events.onMouseEnter();
    assert.equal(find(host, "tooltip-body").children[0].state.value, "另一原因");
    assert.equal(first.state.attributes["aria-describedby"], second.state.attributes["aria-describedby"]);
    first.events.onMouseEnter();
    assert.equal(find(host, "tooltip-body").children[0].state.value, "更新原因");
    second.events.onMouseEnter();
    assert.equal(find(host, "tooltip-body").children[0].state.value, "另一原因");
    first.onUnmounted();
    assert.equal(first_handlers.size, 0);
    assert.equal(find(host, "tooltip-body").children[0].state.value, "另一原因", "旧触发节点卸载不关闭当前提示");
    second.events.onMouseLeave();
    finish_animation();
    assert.equal(positioner.state.style.display, "none");
    second.onUnmounted();
    assert.equal(second_handlers.size, 0);
    assert.equal(find(host, "tooltip-body"), null);
  } finally {
    first.onUnmounted(); second.onUnmounted(); host.onUnmounted();
    context.document = previous_document;
  }
  assert.equal(document_handlers.size, 0);
});

test("Token 成功加载空列表时显示品牌 EmptyCard，创建入口可用，加载与错误时隐藏", async () => {
  ui.DOM = {};
  context.document = { querySelector: () => null, activeElement: null, addEventListener() {}, removeEventListener() {} };
  context.FindRSSAdminShell = {};
  let finish;
  context.FindRSSAdminAuth = { fetch: () => new Promise(resolve => { finish = resolve; }) };
  vm.runInContext("(() => {\n" + page_source("dashboard.js") +
    "\nglobalThis.empty_token_model = DashboardViewModel('tokens'); globalThis.empty_token_view = AccessTokenManagementView({ store: empty_token_model }); })();", context);
  const root = context.empty_token_view;
  const model = context.empty_token_model;
  try {
    assert.equal(find(root, "empty-access-token-list"), null);
    const loading = model.methods.refresh();
    assert.equal(find(root, "empty-access-token-list"), null);
    finish(Response.json({ devices: [], access_tokens: [] }));
    await loading;
    const empty = find(root, "empty-access-token-list");
    assert.ok(empty);
    const image = find(empty, "empty-access-token-list-illustration");
    assert.equal(image.state.src, "/brand/empty.svg");
    assert.equal(image.state.attributes["aria-hidden"], "true");
    assert.equal(find(empty, "empty-access-token-list-title").children[0].state.value, "还没有 Token");
    find(empty, "empty-create-access-token-button").events.onClick();
    assert.ok(find(root, "access-token-create-dialog"));
    model.methods.closeAccessTokenForm();
    const failed = model.methods.refresh();
    assert.equal(find(root, "empty-access-token-list"), null);
    finish(Response.json({ error: "加载失败" }, { status: 503 }));
    await failed;
    assert.equal(find(root, "empty-access-token-list"), null);
    model.state.error.as("");
    model.state.access_tokens.assign([{ id: "one", name: "已有 Token", status: "active" }]);
    assert.equal(find(root, "empty-access-token-list"), null);
    assert.ok(find(root, "access-token-card"));
  } finally { root.onUnmounted(); model.methods.dispose(); }
});

test("侧边栏移除账号信息，真实退出按钮直接调用认证模块一次", () => {
  let logouts = 0;
  context.FindRSSAdminAuth = { logout() { logouts++; } };
  vm.runInContext("(() => {\n" + readFileSync(new URL("../components/shell.js", import.meta.url), "utf8").replace(/^export \{[^}]*\};?$/gm, "").replace(/^import .*;$/gm, "") + "\n})();", context);
  const root = context.FindRSSAdminShell.View({ page_id: "messages" }, []);
  for (const name of ["account", "account-avatar", "account-name", "account-role", "account-menu"]) {
    assert.equal(find(root, "admin-shell-" + name), null);
  }
  const logout = find(find(root, "admin-shell-footer"), "admin-shell-logout");
  assert.ok(logout);
  assert.equal(logout.state.attributes["aria-label"], "退出登录");
  assert.equal(logout.state.attributes["aria-haspopup"], undefined);
  assert.equal(logout.state.attributes["aria-expanded"], undefined);
  assert.ok(find(logout, "admin-icon-log-out"));
  logout.events.onClick({});
  assert.equal(logouts, 1);
  root.onUnmounted();
});

test("Toaster 空闲时无提示，错误优先显示，关闭和卸载清理自动消失计时", () => {
  const message = ui.ref(""), error = ui.ref("");
  const timers = new Map();
  const previous_timeout = context.setTimeout, previous_clear = context.clearTimeout;
  let next_timer = 0;
  context.setTimeout = (callback, delay) => { timers.set(++next_timer, { callback, delay }); return next_timer; };
  context.clearTimeout = id => timers.delete(id);
  const dismiss = () => { message.set(""); error.set(""); };
  const root = ui.Toaster({ message, error, onDismiss: dismiss });
  try {
    assert.equal(root.t, "portal");
    assert.equal(find(root, "toast"), null);
    message.set("Cookie 已保存");
    const success = find(root, "toast");
    assert.equal(success.state.attributes.role, "status");
    success.onMounted();
    assert.equal([...timers.values()][0].delay, 4000);
    [...timers.values()][0].callback();
    assert.equal(find(root, "toast"), null);
    assert.equal(timers.size, 0);
    message.set("之前的成功提示");
    error.set("保存失败，草稿已保留");
    const failure = find(root, "toast");
    assert.equal(failure.state.attributes.role, "alert");
    assert.equal(failure.children[0].children[0].state.value, error.value);
    failure.onMounted();
    assert.equal([...timers.values()][0].delay, 8000);
    find(root, "toast-dismiss").events.onClick();
    assert.equal(find(root, "toast"), null);
    assert.equal(timers.size, 0);
    message.set("再次保存");
    find(root, "toast").onMounted();
    root.onUnmounted();
    assert.equal(timers.size, 0);
  } finally {
    root.onUnmounted();
    context.setTimeout = previous_timeout;
    context.clearTimeout = previous_clear;
  }
});

test("各页说明共用 Toaster，字段说明点击读取最新内容，重复提示可重新展示", () => {
  const root = ui.Toaster();
  const explanation = ui.ref("字段说明");
  const field = ui.Field({ label: "设置", tooltip: explanation, attributes: { n: "toast-field" } });
  try {
    assert.equal(find(root, "tooltip-host"), null);
    const help = find(field, "toast-field-help-button");
    assert.equal(help.state.attributes["aria-describedby"], undefined);
    help.events.onClick();
    const first = find(root, "toast");
    assert.equal(first.children[0].children[0].state.value, "字段说明");
    help.events.onClick();
    assert.notEqual(find(root, "toast"), first);
    explanation.set("更新后的说明");
    help.events.onClick();
    assert.equal(find(root, "toast").children[0].children[0].state.value, "更新后的说明");
    ui.notify("操作失败", { error: true });
    assert.equal(find(root, "toast").state.attributes.role, "alert");
    ui.notify("下一条提示");
    assert.equal(find(root, "toast").state.attributes.role, "status");
    find(root, "toast-dismiss").events.onClick();
    assert.equal(find(root, "toast"), null);
    ui.notify("离开页面前的提示");
  } finally { field.onUnmounted(); root.onUnmounted(); }
  const next = ui.Toaster();
  try { assert.equal(find(next, "toast"), null); }
  finally { next.onUnmounted(); }
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
    if (!options?.body) return Response.json({ sources: [], total_count: 0 });
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
    const new_chat = find(panel, "script-agent-reset-button");
    assert.ok(new_chat);
    assert.equal(find(new_chat, "button-icon"), null);
    assert.equal(find(new_chat, "admin-icon-rotate-ccw"), null);
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

async function load_settings_pages() {
  ui.DOM ||= {};
  context.document = { querySelector: () => null, addEventListener() {}, removeEventListener() {} };
  const settings_bundle = await build({
    stdin: {
      contents: ["settings.js", "oauth.view.js", ...["device-tokens", "mcp-tokens", "cookies", "webhook", "snapshots", "models", "about"].map(name => "settings/" + name + ".js")]
        .map(name => 'export * from "./' + name + '";').join("\n"),
      resolveDir: fileURLToPath(new URL("../pages/", import.meta.url)),
    },
    bundle: true, format: "iife", globalName: "SettingsPages", write: false,
  });
  vm.runInContext(settings_bundle.outputFiles[0].text, context);
  return context.SettingsPages;
}

test("设置子页面各自加载配置，保留编辑和重试功能，切换清除密钥且返回重新加载", async () => {
  const requests = [];
  let tokens = [];
  const token = { id: "settings-token", name: "设置页设备", note: "", token_hint: "frd_…1234", status: "active", created_at: 1, expires_at: null, last_used_at: null };
  let fail_read = true;
  let cookie_settings = { uuid: "", configured: false };
  let webhook_settings = { url: "", token_configured: false, template: '{"text":"{{message}}"}' };
  const provider = { id: "custom", name: "Custom", type: "openai_compat", enabled: true,
    base_url: "https://models.example/v1", api_key_secret_name: "",
    models: [{ id: "m", name: "Model", model: "m", enabled: true, options: {} }] };
  context.FindRSSAdminAuth = { fetch: async (url, options) => {
    requests.push({ url, method: options.method || "GET", body: options.body && JSON.parse(options.body) });
    if (url.startsWith("/admin/api/device-tokens")) {
      if (url.endsWith("/reveal")) return Response.json({ token: "settings-plaintext" });
      if (options.method === "POST") { tokens = [token]; return Response.json({ device_token: token }); }
      return Response.json({ device_tokens: tokens });
    }
    if (fail_read) return Response.json({ error: "读取失败" }, { status: 500 });
    if (url === "/admin/api/settings/webhook") {
      if (options.method === "PUT") {
        const body = JSON.parse(options.body);
        webhook_settings = { url: body.url, template: body.template, token_configured: Boolean(body.token) };
      }
      return Response.json(webhook_settings);
    }
    if (url === "/admin/api/settings/cookies") {
      if (options.method === "PUT") cookie_settings = { uuid: JSON.parse(options.body).uuid, configured: true };
      return Response.json(cookie_settings);
    }
    if (url === "/admin/api/settings/snapshots") return Response.json({ policy: { mode: "interval", every: 3600 } });
    return Response.json({ providers: [provider], configured: true });
  } };
  context.FindRSSAdminShell = {};
  const pages = await load_settings_pages();
  const definitions = [
    ["device-tokens", pages.SettingsDeviceTokensPage], ["models", pages.SettingsModelsPage],
    ["cookies", pages.SettingsCookiesPage], ["webhook", pages.SettingsWebhookPage],
    ["snapshots", pages.SettingsSnapshotsPage],
  ];
  const handlers = {}, views = {}, sections = {}, mounted = new Set(), route_listeners = new Set();
  const history = { onRouteChange(callback) { route_listeners.add(callback); return () => route_listeners.delete(callback); } };
  for (const [id, Page] of definitions) {
    handlers[id] = {};
    views[id] = { onBeforeHide(callback) { handlers[id].hide = callback; return () => { delete handlers[id].hide; }; } };
    sections[id] = Page({ view: views[id], history });
  }
  const root = ui.View({}, Object.values(sections));
  let current;
  async function activate(id) {
    if (current) handlers[current].hide();
    current = id;
    if (!mounted.has(id)) { sections[id].onMounted(); mounted.add(id); }
    else for (const listener of route_listeners) listener({ view: views[id] });
    await new Promise(setImmediate);
  }
  try {
    assert.equal(requests.length, 0);
    await activate("models");
    assert.deepEqual(requests.map(request => request.url), ["/admin/api/scripts/agent/settings"]);
    assert.ok(find(root, "settings-load-error"));
    assert.equal(find(root, "settings-save-button"), null);
    fail_read = false;
    await find(root, "settings-retry-button").events.onClick();
    await new Promise(setImmediate);
    assert.ok(find(root, "settings-ai-provider-search"));
    assert.ok(find(root, "settings-ai-nav-custom:custom"));
    await find(root, "settings-save-button").events.onClick();
    await new Promise(setImmediate);
    assert.equal(requests.at(-1).url, "/admin/api/scripts/agent/settings");
    assert.equal(requests.at(-1).method, "PUT");

    await activate("device-tokens");
    assert.equal(find(root, "settings-ai-form"), null);
    assert.equal(requests.at(-1).url, "/admin/api/device-tokens");
    find(root, "device-token-name-input").events.onInput({ target: { value: token.name } });
    await find(root, "create-device-token-button").events.onClick();
    await new Promise(setImmediate);
    assert.ok(find(root, "device-token-created-dialog"));
    assert.equal(find(root, "device-token-created-value").children[0].state.value, "settings-plaintext");
    assert.deepEqual(requests.find(request => request.url === "/admin/api/device-tokens" && request.method === "POST").body,
      { name: token.name, note: "", expires_in_seconds: 2592000 });
    assert.equal(find(root, "device-token-value"), null);
    await find(root, "preview-device-token-button").events.onClick();
    await new Promise(setImmediate);
    assert.equal(find(root, "device-token-value").children[0].state.value, "settings-plaintext");

    fail_read = true;
    await activate("cookies");
    assert.equal(find(root, "device-token-created-dialog"), null);
    assert.equal(find(root, "device-token-value"), null);
    assert.equal(requests.at(-1).url, "/admin/api/settings/cookies");
    assert.ok(find(root, "settings-cookie-retry"));
    fail_read = false;
    await find(root, "settings-cookie-retry").events.onClick();
    await new Promise(setImmediate);
    assert.equal(find(root, "settings-cookie-password").state.attributes.type, "text");
    find(root, "settings-cookie-uuid").events.onInput({ target: { value: "123" } });
    find(root, "settings-cookie-password").events.onInput({ target: { value: "cookie-secret" } });
    await find(root, "settings-cookie-save").events.onClick();
    await new Promise(setImmediate);
    assert.deepEqual(requests.at(-1).body, { uuid: "123", password: "cookie-secret" });
    assert.equal(find(root, "settings-cookie-password").state.value, "");
    find(root, "settings-cookie-password").events.onInput({ target: { value: "unsaved-cookie-secret" } });

    fail_read = true;
    await activate("webhook");
    assert.equal(find(root, "settings-cookie-fields"), null);
    assert.equal(requests.at(-1).url, "/admin/api/settings/webhook");
    assert.ok(find(root, "settings-webhook-retry"));
    fail_read = false;
    await find(root, "settings-webhook-retry").events.onClick();
    await new Promise(setImmediate);
    assert.equal(find(root, "settings-webhook-token").state.attributes.type, "password");
    find(root, "settings-webhook-url").events.onInput({ target: { value: "https://notify.example/api" } });
    find(root, "settings-webhook-token").events.onInput({ target: { value: "notify-secret" } });
    find(root, "settings-webhook-template").events.onInput({ target: { value: '{"text":"{{error_text}}"}' } });
    await find(root, "settings-webhook-save").events.onClick();
    await new Promise(setImmediate);
    assert.deepEqual(requests.at(-1).body, { url: "https://notify.example/api", token: "notify-secret", template: '{"text":"{{error_text}}"}' });
    assert.equal(find(root, "settings-webhook-token").state.value, "");
    find(root, "settings-webhook-token").events.onInput({ target: { value: "unsaved-webhook-secret" } });

    await activate("snapshots");
    assert.equal(find(root, "settings-webhook-fields"), null);
    assert.equal(requests.at(-1).url, "/admin/api/settings/snapshots");
    assert.ok(find(root, "settings-snapshot-save"));
    const concurrency = find(root, "settings-snapshot-concurrency");
    assert.equal(concurrency.state.value, "4");
    assert.equal(concurrency.state.attributes.type, "number");
    assert.equal(concurrency.state.attributes.min, 1);
    assert.equal(concurrency.state.attributes.max, 16);
    concurrency.events.onInput({ target: { value: "8" } });
    await find(root, "settings-snapshot-save").events.onClick();
    await new Promise(setImmediate);
    assert.equal(requests.at(-1).url, "/admin/api/settings/snapshots");
    assert.equal(requests.at(-1).method, "PUT");
    assert.equal(requests.at(-1).body.max_concurrency, 8);

    const token_reads = requests.filter(request => request.url === "/admin/api/device-tokens" && request.method === "GET").length;
    await activate("device-tokens");
    assert.equal(requests.filter(request => request.url === "/admin/api/device-tokens" && request.method === "GET").length, token_reads + 1);
    await activate("models");
    assert.equal(requests.at(-1).url, "/admin/api/scripts/agent/settings");
    assert.ok(find(root, "settings-ai-form"));
    await activate("cookies");
    assert.equal(find(root, "settings-cookie-password").state.value, "");
    await activate("webhook");
    assert.equal(find(root, "settings-webhook-token").state.value, "");
  } finally {
    for (const id of mounted) sections[id].onUnmounted();
    root.onUnmounted();
  }
  assert.equal(route_listeners.size, 0);
  for (const value of Object.values(handlers)) assert.deepEqual(value, {});
});


test("独立 OAuth 页面只加载授权申请，顶部展示 Logo 和当前版本，确认后回调", async () => {
  const requests = [], redirects = [];
  const old_location = context.location;
  context.location = { search: "?request=pending-one", assign: url => redirects.push(url) };
  const consent = { id: "pending-one", client_name: "代码助手", client_id: "registered-client", redirect_uri: "http://127.0.0.1:45678/callback",
    scopes: ["discovery:create", "scripts:create"] };
  context.FindRSSAdminAuth = { fetch: async (url, options = {}) => {
    requests.push({ url, options });
    if (url.endsWith("/decision")) return Response.json({ redirect_uri: consent.redirect_uri + "?code=one-use&state=client-state" });
    return Response.json({ authorization: consent });
  } };
  const pages = await load_settings_pages(), root = pages.OauthView();
  try {
    root.onMounted(); await new Promise(setImmediate);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, "/admin/api/mcp-oauth/requests/pending-one");
    assert.equal(find(root, "oauth-logo").state.src, "/brand/logo.svg");
    const version = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")).version;
    assert.equal(find(root, "oauth-version").children[0].state.value, "v" + version);
    for (const name of ["mcp-token-row", "mcp-token-refresh", "settings-navigation", "admin-shell-sidebar", "admin-agent-launcher"]) assert.equal(find(root, name), null);
    assert.ok(find(root, "mcp-consent"));
    assert.match(find(root, "mcp-consent-callback").children[0].state.value, /127.0.0.1:45678/);
    assert.equal(find(root, "mcp-token-subscriptions").state.attributes["aria-checked"], "true");
    assert.equal(find(root, "mcp-token-scripts").state.attributes["aria-checked"], "true");
    find(root, "mcp-token-scripts").events.onClick();
    find(root, "mcp-consent-approve").events.onClick(); await new Promise(setImmediate);
    assert.deepEqual(JSON.parse(requests.at(-1).options.body), { approved: true, scopes: ["discovery:create"] });
    assert.equal(redirects[0], consent.redirect_uri + "?code=one-use&state=client-state");
    assert.equal(find(root, "mcp-consent"), null);
    assert.equal(requests.length, 2);
  } finally { root.onUnmounted(); context.location = old_location; }
});

test("MCP 设置只展示授权列表和撤销操作，不加载授权申请", async () => {
  const old_location = context.location, requests = [];
  context.location = { search: "?request=pending-one" };
  context.FindRSSAdminAuth = { fetch: async url => { requests.push(url); return Response.json({ resource: "https://example.com/mcp", mcp_tokens: [] }); } };
  const pages = await load_settings_pages(), root = pages.SettingsMcpTokensPage();
  try {
    root.onMounted(); await new Promise(setImmediate);
    assert.deepEqual(requests, ["/admin/api/mcp-tokens"]);
    assert.equal(find(root, "mcp-consent"), null);
  } finally { root.onUnmounted(); context.location = old_location; }
});

test("MCP 授权分页限制每页 20 条，后续页面仍可撤销已有授权", async () => {
  context.FindRSSAdminShell = {};
  const tokens = Array.from({ length: 21 }, (_, id) => ({ id: "mcp-" + id, name: "agent " + id,
    scopes: ["discovery:create"], resource: "https://example.com/mcp", status: "active", token_hint: "masked", expires_at: Date.now() + 86400000 }));
  const requests = [];
  context.FindRSSAdminAuth = { fetch: async url => {
    requests.push(url);
    return Response.json(url.endsWith("/revoke") ? { mcp_token: { ...tokens[20], status: "revoked" } }
      : { resource: "https://example.com/mcp", mcp_tokens: tokens });
  } };
  const pages = await load_settings_pages(), section = pages.SettingsMcpTokensPage();
  const root = ui.View({}, [section]);
  const rows = node => (node?.state?.attributes?.n === "mcp-token-row" ? 1 : 0) + (node?.children || []).reduce((count, child) => count + rows(child), 0);
  try {
    section.onMounted(); await new Promise(setImmediate);
    assert.equal(rows(root), 20);
    find(root, "mcp-tokens-next").events.onClick();
    assert.equal(rows(root), 1);
    assert.equal(find(root, "mcp-token-row").state.attributes["data-token-id"], "mcp-20");
    find(root, "mcp-token-revoke").events.onClick();
    find(root, "mcp-token-confirm-revoke").events.onClick(); await new Promise(setImmediate);
    assert.equal(requests.at(-1), "/admin/api/mcp-tokens/mcp-20/revoke");
    assert.equal(find(root, "mcp-token-revoke"), null);
    find(root, "mcp-tokens-previous").events.onClick(); assert.equal(rows(root), 20);
  } finally { section.onUnmounted(); root.onUnmounted(); }
});

test("设置 layout 提供七个真实路由链接，共用 KeepAlive 内容区域且高亮随路由更新", async () => {
  context.FindRSSAdminAuth = { fetch: async () => { throw new Error("layout 不应请求配置"); } };
  context.FindRSSAdminShell = {};
  const pages = await load_settings_pages();
  const listeners = new Set(), pushed = [];
  const root = pages.SettingsPage({
    view: { curView: { name: "root.admin.settings.models" }, subViews: [] },
    history: {
      onRouteChange(callback) { listeners.add(callback); return () => listeners.delete(callback); },
      push(name) { pushed.push(name); for (const callback of listeners) callback({ name }); },
    },
    views: {},
  });
  try {
    assert.equal(root.state.attributes.n, "settings-layout");
    assert.ok(root.state.styleSet.includes("h-full"));
    assert.ok(find(root, "settings-subviews").state.styleSet.includes("relative"));
    assert.equal(find(root, "settings-subviews").children.length, 1);
    const navigation = find(root, "settings-navigation");
    assert.equal(navigation.children.length, 7);
    assert.ok(navigation.state.styleSet.includes("flex-direction-column"));
    assert.ok(navigation.state.styleSet.includes("border-inline-end-1-pixels-solid-color-border"));
    const content = find(root, "page-content");
    assert.equal(content.state.style["grid-template-columns"], "180px minmax(0, 1fr)");
    assert.equal(content.state.style["grid-template-rows"], "minmax(0, 1fr)");
    assert.equal(content.children[0], navigation);
    assert.equal(content.children[1], find(root, "settings-subviews"));
    const models = find(root, "settings-nav-models");
    const cookies = find(root, "settings-nav-cookies");
    assert.equal(models.state.href, "/admin/settings/models");
    assert.equal(cookies.state.href, "/admin/settings/cookies");
    assert.equal(models.state.attributes["aria-current"], "page");
    assert.equal(cookies.state.attributes["aria-current"], undefined);
    let prevented = 0;
    cookies.events.onClick({ button: 0, preventDefault() { prevented += 1; } });
    assert.deepEqual(pushed, ["root.admin.settings.cookies"]);
    assert.equal(models.state.attributes["aria-current"], undefined);
    assert.equal(cookies.state.attributes["aria-current"], "page");
    for (const modifiers of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }, { defaultPrevented: true }]) {
      models.events.onClick({ button: 0, ...modifiers, preventDefault() { prevented += 1; } });
    }
    assert.equal(prevented, 1);
    assert.equal(pushed.length, 1);
  } finally { root.onUnmounted(); }
  assert.equal(listeners.size, 0);
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
