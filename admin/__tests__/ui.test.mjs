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
import { SnapshotSettingsModel } from "../components/snapshot_settings.model.js";
import { CookiePushSettingsModel } from "../components/cookie_push_settings.model.js";
import { WebhookSettingsModel } from "../components/webhook_settings.model.js";
import { AI_PROVIDER_PRESETS } from "../domain/preferences/ai_presets.js";
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
const context = vm.createContext({ pages: navigation, ...platform_helpers, PollPolicyView, poll_policy_label, PollPolicyModel, RssRoutePatternModel, PaginationModel, PaginationView, URL, console, setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {} });
context.window = context;
vm.runInContext(readFileSync(new URL("../../public/assets/timeless/0.34.2/timeless.umd.min.js", import.meta.url), "utf8"), context);
vm.runInContext(bundle.outputFiles[0].text, context);
const ui = context.FindRSSAdminUI;

function find(node, name) {
  if (node?.state?.attributes?.n === name) return node;
  for (const child of node?.children || []) { const result = find(child, name); if (result) return result; }
  return null;
}

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

test("网络测试实际视图筛选并勾选 Cookie，最终及逐跳状态使用对应颜色的标签", async () => {
  const network_bundle = await build({
    entryPoints: [fileURLToPath(new URL("../pages/network.js", import.meta.url))],
    bundle: true, format: "iife", globalName: "NetworkTestModule", write: false,
  });
  Object.assign(context, { AbortController, Blob });
  context.FindRSSAdminShell = { Page: (_, children) => ui.View({ attributes: { n: "network-test-page" } }, children) };
  let status = 200;
  const submitted = [], copied = [];
  context.navigator = { clipboard: { writeText: async text => copied.push(text) } };
  context.FindRSSAdminAuth = { fetch: async (url, options) => {
    if (url.endsWith("/cookie-domains")) return Response.json({ domains: [
      { domain: ".example.com", count: 2 }, { domain: "other.example", count: 1 },
    ] });
    submitted.push(JSON.parse(options.body));
    if (url.endsWith("/curl")) return Response.json({ command: "curl 'https://www.example.com/'" });
    return Response.json({ status, body_kind: "file", elapsed_ms: 10,
      requests: [{ status, url: "https://www.example.com/", elapsed_ms: 10 }] });
  } };
  vm.runInContext(network_bundle.outputFiles[0].text, context);
  const root = context.NetworkTestModule.NetworkTestPage();
  try {
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
    assert.equal(submitted[0].headers.Referer, "https://www.example.com/");
    const actions = find(root, "network-actions");
    assert.ok(find(actions, "network-test-start"));
    const copy_button = find(actions, "network-copy-curl");
    assert.equal(copy_button.state.attributes["aria-label"], "复制 curl 命令");
    await copy_button.events.onClick();
    await new Promise(setImmediate);
    assert.deepEqual(copied, ["curl 'https://www.example.com/'"]);
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
    await find(root, "network-header-remove-4").events.onClick();
    assert.equal(find(root, "network-header-row-4"), null);
    await find(root, "network-header-remove-0").events.onClick();
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
  } finally { root.onUnmounted(); }
});

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
  const confirmations = [];
  const model = context.device_tokens_model(async value => { confirmations.push(value); return true; });
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
    const prefix = name === "login" ? "./" : "/admin/";
    assert.ok(html.includes(`href="${prefix}frui.css"`));
    assert.match(html, /assets\/timeless\/0\.34\.2\//);
    assert.ok(html.indexOf(`src="${prefix}ui.js"`) > html.indexOf("timeless.dom.umd.min.js"));
    assert.ok(html.indexOf(`src="${prefix}ui.js"`) < html.indexOf(`src="${prefix}${name === "login" ? "login" : "app"}.js"`));
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
    feed_url_template: "{{hostname}}/atom/demo", avatar_url: "", enabled: true, tags: [], snapshot: { saved_at: 0, articles: [], error: "" } };
  const copied = [];
  const click_copy = async button => { button.events.onClick(); await new Promise(setImmediate); };
  context.navigator = { clipboard: { async writeText(url) { copied.push(url); } } };
  const card = context.discovery_card(source);
  for (const [kind, name, url] of [["website", "website", source.website], ["feed", "feed-link", source.feed_url]]) {
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
  assert.deepEqual(copied, [source.website, source.feed_url]);
  card.onUnmounted();

  const template_card = context.discovery_card({ ...source, website: "", feed_url: source.feed_url_template });
  assert.equal(find(template_card, "discovery-source-row-feed-link"), null);
  assert.ok(find(template_card, "discovery-source-row-feed-value"));
  await click_copy(find(template_card, "discovery-source-row-copy-website"));
  await click_copy(find(template_card, "discovery-source-row-copy-feed"));
  assert.deepEqual(copied.slice(-2), [source.feed_url_template, source.feed_url_template]);
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

test("订阅源表格选择控制批量菜单，启停后行内容和数量同步更新，空表保留列头", async () => {
  ui.DOM = {};
  context.document = { querySelector: () => null };
  const sources = [{ id: "one", title: "源一", enabled: true }, { id: "two", title: "源二", enabled: true }];
  context.FindRSSAdminAuth = { fetch: async (url, options) => options.method === "PATCH"
    ? Response.json({ source: { ...sources.find(source => url.endsWith("/" + source.id)), ...JSON.parse(options.body) } })
    : Response.json({ sources }) };
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
    assert.equal(find(root, "discovery-source-header-platform"), null);
    assert.ok(find(find(root, "discovery-source-cell-identity"), "discovery-platform-option"));
    const metadata = find(root, "discovery-source-row-metadata");
    assert.ok(metadata.state.styleSet.includes("display-grid"));
    assert.equal(metadata.state.style["grid-template-columns"], "64px minmax(0, 1fr)");
    assert.ok(find(metadata, "discovery-source-row-metadata-snapshot-label"));
    assert.ok(find(metadata, "discovery-source-row-metadata-poll-rule-value"));
    assert.equal(find(root, "discovery-source-row-updated"), null);
    assert.equal(model.state.selected_ids.value.length, 0);
  } finally { root.onUnmounted(); }
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
  try {
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
    find(root, "discovery-source-public-control").events.onClick();
    finish();
    await new Promise(setImmediate);
    assert.equal(find(root, "discovery-source-public-control").state.attributes["aria-checked"], "false");
    assert.equal(model.state.sources.value[0].require_token, true);
    assert.equal(model.state.sources.value[0].credit_cost, 7);
    assert.equal(model.state.list_error.value, "");
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
  } finally { root.onUnmounted(); }
});

test("刷新快照的完整错误响应显示在对应行操作按钮下方，重试成功后清除", async () => {
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
  const source = { id: "one", title: "示例", feed_url: "https://example.com/feed", enabled: true };
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

test("设置页读取失败可重试，加载成功后使用与 XiaoxunAgent 相同的厂商模型编辑器", async () => {
  context.WebhookSettingsModel = options => WebhookSettingsModel({ ...options, request_json: async (url, options) => {
    const response = await context.window.FindRSSAdminAuth.fetch(url, options || {});
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    return result;
  } });
  context.CookiePushSettingsModel = options => CookiePushSettingsModel({ ...options, request_json: async (url, options) => {
    const response = await context.window.FindRSSAdminAuth.fetch(url, options || {});
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    return result;
  } });
  context.SnapshotSettingsModel = options => SnapshotSettingsModel({ ...options, request_json: async (url, request_options) => {
    const response = await context.window.FindRSSAdminAuth.fetch(url, request_options);
    const value = await response.json();
    if (!response.ok) throw new Error(value.error);
    return value;
  } });
  context.AISettingsStore = AISettingsStore;
  context.FindRSSAdminShell = { Page: (props, children) => ui.View({ attributes: { n: "settings-test-page" } }, children) };
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
    if (url === "/admin/api/settings/webhook" && !fail_read) {
      if (options.method === "PUT") {
        const body = JSON.parse(options.body);
        webhook_settings = { url: body.url, template: body.template, token_configured: Boolean(body.token) };
      }
      return Response.json(webhook_settings);
    }
    if (url === "/admin/api/settings/cookies" && !fail_read) {
      if (options.method === "PUT") cookie_settings = { uuid: JSON.parse(options.body).uuid, configured: true };
      return Response.json(cookie_settings);
    }
    return fail_read ? Response.json({ error: "读取失败" }, { status: 500 }) : Response.json({ providers: [provider], configured: true });
  } };
  vm.runInContext("(() => {\n" + page_source("dashboard.js") +
    "\nglobalThis.DeviceTokensModel = DeviceTokensModel; globalThis.DeviceTokensView = DeviceTokensView; })();", context);
  vm.runInContext("(() => {\n" + page_source("settings.js") + "\nglobalThis.settings_test_page = SettingsPage; })();", context);
  const route_handlers = {};
  const root = context.settings_test_page({ view: {
    onShow(callback) { route_handlers.show = callback; return () => { delete route_handlers.show; }; },
    onBeforeHide(callback) { route_handlers.hide = callback; return () => { delete route_handlers.hide; }; },
  } });
  try {
    find(root, "settings-content").onMounted();
    await new Promise(setImmediate);
    assert.ok(find(root, "settings-load-error"));
    assert.equal(find(root, "settings-save-button"), null);
    assert.ok(find(root, "device-token-management"));
    find(root, "device-token-name-input").events.onInput({ target: { value: token.name } });
    await find(root, "create-device-token-button").events.onClick();
    await new Promise(setImmediate);
    assert.ok(find(root, "device-token-created-dialog"));
    assert.equal(find(root, "device-token-created-value").children[0].state.value, "settings-plaintext");
    assert.deepEqual(requests.find(request => request.url === "/admin/api/device-tokens" && request.method === "POST").body,
      { name: token.name, note: "", expires_in_seconds: 2592000 });
    const token_value = find(root, "device-token-value").children[0];
    let displayed_token = token_value.state.value;
    token_value.$elm = { setText(value) { displayed_token = value; } };
    await find(root, "preview-device-token-button").events.onClick();
    await new Promise(setImmediate);
    assert.equal(displayed_token, "settings-plaintext");
    fail_read = false;
    await find(root, "settings-retry-button").events.onClick();
    await new Promise(setImmediate);
    assert.ok(find(root, "settings-ai-provider-search"));
    assert.ok(find(root, "settings-ai-nav-custom:custom"));
    assert.ok(find(root, "settings-save-button"));
    await find(root, "settings-save-button").events.onClick();
    await new Promise(setImmediate);
    assert.equal(requests.at(-1).url, "/admin/api/scripts/agent/settings");
    assert.equal(requests.at(-1).method, "PUT");
    await find(root, "settings-cookie-retry").events.onClick();
    await new Promise(setImmediate);
    assert.ok(find(root, "settings-cookie-decryption"));
    assert.equal(find(root, "settings-cookie-password").state.attributes.type, "text");
    find(root, "settings-cookie-uuid").events.onInput({ target: { value: "123" } });
    find(root, "settings-cookie-password").events.onInput({ target: { value: "cookie-secret" } });
    await find(root, "settings-cookie-save").events.onClick();
    await new Promise(setImmediate);
    assert.deepEqual(requests.at(-1).body, { uuid: "123", password: "cookie-secret" });
    assert.equal(find(root, "settings-cookie-password").state.value, "");
    await find(root, "settings-webhook-retry").events.onClick();
    await new Promise(setImmediate);
    assert.ok(find(root, "settings-webhook"));
    assert.equal(find(root, "settings-webhook-token").state.attributes.type, "password");
    find(root, "settings-webhook-url").events.onInput({ target: { value: "https://notify.example/api" } });
    find(root, "settings-webhook-token").events.onInput({ target: { value: "notify-secret" } });
    find(root, "settings-webhook-template").events.onInput({ target: { value: '{"text":"{{error_text}}"}' } });
    await find(root, "settings-webhook-save").events.onClick();
    await new Promise(setImmediate);
    assert.deepEqual(requests.at(-1).body, { url: "https://notify.example/api", token: "notify-secret", template: '{"text":"{{error_text}}"}' });
    assert.equal(find(root, "settings-webhook-token").state.value, "");
    route_handlers.hide();
    assert.equal(find(root, "settings-ai-form"), null);
    assert.equal(find(root, "device-token-created-dialog"), null);
    assert.equal(displayed_token, token.token_hint);
    const token_reads = requests.filter(request => request.url === "/admin/api/device-tokens" && request.method === "GET").length;
    await route_handlers.show();
    assert.equal(requests.at(-1).method, "GET");
    assert.equal(requests.filter(request => request.url === "/admin/api/device-tokens" && request.method === "GET").length, token_reads + 1);
    assert.ok(find(root, "settings-ai-form"));
  } finally { find(root, "settings-content").onUnmounted(); root.onUnmounted(); }
  assert.deepEqual(route_handlers, {});
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
