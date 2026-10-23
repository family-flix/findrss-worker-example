import { list_runtime, paged_fixture } from "./list_fixture.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { applyPatch } from "diff";
import { DEFAULT_RSS_SCRIPT, DEFAULT_HOT_SCRIPT } from "../pages/script.default.js";

// 脚本管理页的 Timeless stub：只实现 Model/View 用到的构造器与 ref 语义。
// computed(source, map) 在 map 缺失时必须抛错——上次 /scripts 整页空白正是
// 「把 combine 的结果又包进 computed」触发的（computed 签名是 (ref, fn)），
// 这里让它显式失败，避免同类回归再次静默产出空白页。
function create_element(type, props, children) {
  return { type, props: props || {}, children: Array.isArray(children) ? children : [] };
}

/** 静态 stub 无法重放响应，因此用队列预置 refarr 的初始数据（scripts、logs 各一次）。 */
let refarr_seeds = [];
let fetch_handler = async () => new Response(JSON.stringify({}), { status: 200 });
let routes_handler = async () => Response.json({ error: "测试草稿尚未声明有效路由" }, { status: 400 });

function ref(value) {
  return {
    __is_ref: true,
    value,
    set(next_value) {
      this.value = next_value;
    },
    as(next_value) {
      this.value = next_value;
    },
  };
}

function refarr(initial) {
  const seed = refarr_seeds.length > 0 ? refarr_seeds.shift() : initial;
  return {
    __is_ref: true,
    value: seed,
    set(next_value) {
      this.value = next_value;
    },
    as(next_value) {
      this.value = next_value;
    },
    assign(next_value) {
      this.value = next_value;
    },
  };
}

globalThis.document = { querySelector: () => null };
globalThis.window = {
  localStorage: { getItem: () => null, setItem() {} },
  FindRSSAdminAuth: {
    fetch: async (url, options) => paged_fixture(await (url === "/admin/api/scripts/routes" ? routes_handler : fetch_handler)(url, options), url),
    beforeReady: async () => true,
  },

  FindRSSAdminShell: {
    Page(options, children) {
      return create_element("shell", { ...options, attributes: { n: "admin-shell" } }, [options.header, ...(options.header ? [] : options.actions || []), ...children].filter(Boolean));
    },
    View(options, children) {
      return create_element("shell", { attributes: { n: "admin-shell" } }, children);
    },
  },
  Timeless: {
    ...list_runtime,
    DOM: {},
    Button(props, children) {
      return create_element("button", props, children);
    },
    Input(props, children) {
      return create_element("input", props, children);
    },
    Link(props, children) { return create_element("a", props, children); },
    Select(props, children) {
      return create_element("select", props, children);
    },
    Textarea(props, children) {
      return create_element("textarea", props, children);
    },
    View(props, children) {
      return create_element("view", props, children);
    },
    Video(props) { return create_element("video", props, []); },
    Audio(props) { return create_element("audio", props, []); },
    For({ each, render }) {
      const node = create_element("view", {}, []);
      Object.defineProperty(node, "children", { get() {
        const items = each && each.__is_ref ? each.value : each;
        return (items || []).map((item) => render(item));
      } });
      return node;
    },
    Show({ when, ok, fail, else: fallback }) {
      const node = create_element("show", {}, []);
      Object.defineProperty(node, "children", { get() {
        const value = when && when.__is_ref ? when.value : when;
        return value ? [ok()] : (fallback || fail) ? [(fallback || fail)()] : [];
      } });
      return node;
    },
    combine(refs, map) {
      if (typeof map !== "function") {
        throw new TypeError("combine(refs, map) 缺少 map 函数");
      }
      return {
        __is_ref: true,
        get value() {
          return map(
            Object.fromEntries(
              Object.entries(refs).map(([key, source]) => [key, source.value]),
            ),
          );
        },
      };
    },
    computed(source, map) {
      if (typeof map !== "function") {
        throw new TypeError("computed(source, map) 缺少 map 函数");
      }
      return {
        __is_ref: true,
        get value() {
          return map(source.__is_ref ? source.value : source);
        },
      };
    },
    XiaoxunComposerModel(pet) { return { pet, destroy() {} }; },
    XiaoxunDialogueView({ dialogue }) { return create_element("dialogue", {}, [
      create_element("input", { attributes: { n: "xiaoxun-dialogue-input" }, onInput: event => dialogue.model.set_draft(event.target.value) }),
      create_element("button", { attributes: { n: "xiaoxun-dialogue-send" }, onClick: dialogue.model.send }),
    ]); },
    AIPreferencesView() { return create_element("settings", {}, []); },
    ref,
    refarr,
    refobj: ref,
  },
};

const script_fixture = {
  id: "",
  path: "/wxmp/:account?",
  name: "微信公众号文章",
  url: "mp.weixin.qq.com",
  maintainers: ["tester"],
  example: "/wxmp/wow36kr",
  parameters: { account: "公众号账号" },
  description: "测试用脚本",
  script: "export const route = {};",
  enabled: true,
  created_at: 1700000000000,
  updated_at: 1700000001000,
};

const log_fixture = {
  id: 9,
  route: "",
  path: "/wxmp/:account?",
  source: "request",
  method: "GET",
  pathname: "/rss/wxmp/wow36kr",
  params: { account: "wow36kr" },
  query: {},
  status: "error",
  phase: "runtime",
  level: "error",
  message: "脚本执行失败：boom",
  error_text: "脚本执行失败：boom\n    at handler (script.js:8:3)",
  lines: [{ level: "info", text: '"params" {"account":"wow36kr"}' }],
  elapsed_ms: 12,
  invoked: true,
  created_at: 1700000002000,
};

window.FindRSSAdminUI = window.Timeless;
window.FindRSSAdminUI.CodeEditor = (props) => create_element("code-editor", props, []);
window.FindRSSAdminUI.Card = (props, children) => create_element("view", props, children);
window.FindRSSAdminUI.Badge = (props, children) => create_element("badge", props, children);
window.FindRSSAdminUI.Dialog = (props, children) => create_element("dialog", props, [...children, ...(props.footer || [])]);
window.FindRSSAdminUI.Popconfirm = props => create_element("popconfirm", props, [props.trigger({})]);
window.FindRSSAdminUI.Tabs = (props) => create_element("tabs", props, props.items.flatMap(item => item.content));
window.FindRSSAdminUI.CopyButton = (props) => create_element("button", props, []);
window.FindRSSAdminUI.Switch = (props) => create_element("switch", props, []);
window.FindRSSAdminUI.TableField = (props) => create_element("field-table", props, []);
let notification = "";
window.FindRSSAdminUI.notify = message => { notification = message; };
window.FindRSSAdminUI.Icon = (name) => create_element("svg", { attributes: { n: "admin-icon-" + name } }, []);
window.FindRSSAdminUI.Img = (props) => create_element("img", props, []);
window.FindRSSAdminUI.Field = (props, children) => create_element("view", props, children);
window.FindRSSAdminUI.FeedAddressEditor = (props) => create_element("feed-address-editor", props, []);
window.FindRSSAdminUI.FilePicker = (props, children) => create_element("file-picker", props, children);
window.FindRSSAdminUI.PageHeader = (props) => create_element("view", props, [create_element("h1", { attributes: props.title_attributes }, [props.title])]);

const { ScriptPage } = await import("../pages/script.js");
const { normalize_script: normalize_fixture } = await import("../pages/script.model.js");
const { ScriptConfigModel } = await import("../components/script_config.model.js");
const { ScriptViewModel } = await import("../pages/script.model.js");

const install_fixture = {
  script: "export const route = { path: '/installed', name: '安装测试', handler() { return {}; } };",
  source_url: "https://example.com/script.js",
  metadata: { kind: "hot", name: "安装测试", routes: [{ name: "安装测试", path: "/installed", example: "/installed", parameters: {} }],
    permissions: { cookies: [{ id: "session", names: ["SID"], origin: "https://example.com", purpose: "读取订阅内容" }] } },
};

test("安装按钮打开独立弹窗，URL/源码先解析预览，确认前不保存；修改输入使预览失效", async () => {
  const calls = [];
  fetch_handler = async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    return Response.json(install_fixture);
  };
  const root = build_page([], false);
  assert.equal(find_node(root, "script-install-dialog"), undefined);
  find_node(root, "script-install-button").props.onClick();
  assert.equal(find_node(root, "script-form-dialog"), undefined);
  await find_node(root, "script-install-parse").props.onClick();
  assert.equal(calls.length, 0);
  assert.match(child_texts(find_node(root, "script-install-error")).join(""), /请输入/);
  for (const input of [install_fixture.source_url, install_fixture.script]) {
    find_node(root, "script-install-input").props.onInput({ target: { value: input } });
    await find_node(root, "script-install-parse").props.onClick();
    assert.deepEqual(calls.at(-1), { url: "/admin/api/scripts/install-preview", body: { input } });
    assert.deepEqual(child_texts(find_node(root, "script-install-name")), ["安装测试"]);
    assert.match(child_texts(find_node(root, "script-install-permissions")).join(""), /SID/);
    assert.equal(find_node(root, "script-install-source-code").props.value.value, install_fixture.script);
    assert.equal(find_node(root, "script-install-source-code").props.attributes.readonly, true);
    find_node(root, "script-install-input").props.onInput({ target: { value: "changed" } });
    assert.equal(find_node(root, "script-install-preview"), undefined);
    assert.equal(find_node(root, "script-install-save"), undefined);
  }
  find_node(root, "script-install-cancel").props.onClick();
  assert.equal(find_node(root, "script-install-dialog"), undefined);
  assert.equal(calls.length, 2);
});

test("安装预览自动填写声明版本，支持手动修改；更换脚本不沿用旧版本", async t => {
  const original_fetch = fetch_handler;
  t.after(() => { fetch_handler = original_fetch; });
  const calls = [];
  let preview = { ...install_fixture, metadata: { ...install_fixture.metadata, version: "1.2.3" } };
  fetch_handler = async (url, options) => {
    const body = JSON.parse(options.body);
    calls.push({ url, body });
    if (url.endsWith("/install-preview")) return Response.json(preview);
    return Response.json({ script: { ...script_fixture, id: "version-install", status: body.status, version: body.version } });
  };
  const root = build_page([], false);
  find_node(root, "script-install-button").props.onClick();
  find_node(root, "script-install-input").props.onInput({ target: { value: install_fixture.source_url } });
  await find_node(root, "script-install-parse").props.onClick();
  assert.equal(find_node(root, "script-install-version").props.value.value, "1.2.3");
  find_node(root, "script-install-version").props.onInput({ target: { value: "1.2.4" } });
  await find_node(root, "script-install-publish").props.onClick();
  assert.equal(calls.at(-1).body.version, "1.2.4");
  assert.equal(calls.at(-1).body.status, "published");
  find_node(root, "script-install-button").props.onClick();
  find_node(root, "script-install-input").props.onInput({ target: { value: install_fixture.script } });
  await find_node(root, "script-install-parse").props.onClick();
  assert.equal(find_node(root, "script-install-version").props.value.value, "1.2.3");
  preview = install_fixture;
  find_node(root, "script-install-input").props.onInput({ target: { value: install_fixture.script + "\n" } });
  await find_node(root, "script-install-parse").props.onClick();
  assert.equal(find_node(root, "script-install-version").props.value.value, "");
  find_node(root, "script-install-cancel").props.onClick();
});

test("R2 脚本编辑按需加载源码，版本历史支持查看、取消和确认回退", async t => {
  const original_fetch = fetch_handler, original_confirm = window.confirm;
  t.after(() => { fetch_handler = original_fetch; window.confirm = original_confirm; });
  const calls = [];
  let current = { ...script_fixture, id: "r2-script", script: "", source_loaded: false,
    version: "2.0.0", current_release_id: "release-new" };
  fetch_handler = async (url, options = {}) => {
    calls.push({ url, body: options.body ? JSON.parse(options.body) : null });
    if (url.endsWith("/versions")) return Response.json({ versions: [
      { id: "release-old", version: "1.0.0", bytes: 100, created_at: 1, current: current.version === "1.0.0" },
      { id: "release-new", version: "2.0.0", bytes: 100, created_at: 2, current: current.version === "2.0.0" },
    ] });
    if (url.endsWith("/versions/release-old")) return Response.json({ version: { script: "// 历史源码" } });
    if (url.endsWith("/rollback")) {
      current = { ...current, current_release_id: "release-old", version: "1.0.0" };
      return Response.json({ script: current });
    }
    return Response.json({ scripts: [{ ...current, ...(url.includes("&id=") ? { script: "// 编辑时加载的源码", source_loaded: true } : {}) }] });
  };
  const root = build_page(current, false);
  t.after(() => find_node(root, "scripts-content").props.onUnmounted());
  assert.equal(calls.length, 0);
  await find_node(root, "script-edit-button").props.onClick();
  assert.match(calls[0].url, /id=r2-script/);
  assert.equal(find_node(root, "script-code-textarea").props.value.value, "// 编辑时加载的源码");
  find_node(root, "script-form-close-button").props.onClick();
  assert.equal(find_node(root, "script-history-button"), undefined);
  const version_button = find_node(find_node(root, "script-card-release"), "script-status");
  assert.equal(version_button.type, "button");
  assert.deepEqual(child_texts(version_button), ["2.0.0"]);
  assert.equal(version_button.props.icon.props.attributes.n, "admin-icon-chevron-down");
  assert.equal(version_button.props.icon_position, "end");
  assert.equal(version_button.props.attributes["aria-haspopup"], "dialog");
  await version_button.props.onClick();
  assert.ok(find_node(root, "script-history-dialog"));
  await find_node(root, "script-history-view").props.onClick();
  assert.equal(find_node(root, "script-history-source").props.value.value, "// 历史源码");
  window.confirm = () => false;
  await find_node(root, "script-history-rollback").props.onClick();
  assert.equal(calls.some(call => call.url.endsWith("/rollback")), false);
  window.confirm = () => true;
  await find_node(root, "script-history-rollback").props.onClick();
  const rollback = calls.find(call => call.url.endsWith("/rollback"));
  assert.deepEqual(rollback.body, { release_id: "release-old", expected_release_id: "release-new" });
  assert.match(child_texts(find_node(root, "script-history-version-name")).join(""), /1\.0\.0.*当前使用/);
  find_node(root, "script-history-close").props.onClick();
  assert.equal(find_node(root, "script-history-dialog"), undefined);
});

test("安装解析与保存期间阻止重复提交和关闭，失败保留输入与预览，成功按识别类型显示新脚本", async t => {
  refarr_seeds = [];
  const model = ScriptViewModel();
  t.after(() => model.methods.destroy());
  const calls = [];
  let finish;
  fetch_handler = (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    return new Promise(resolve => { finish = resolve; });
  };
  model.methods.open_install();
  model.methods.set_install_input(install_fixture.source_url);
  const parsing = model.methods.preview_install();
  await model.methods.preview_install();
  model.methods.close_install();
  model.methods.set_install_input("changed");
  assert.equal(model.state.install_input.value, install_fixture.source_url);
  assert.equal(model.state.install_open.value, true);
  assert.equal(calls.length, 1);
  finish(Response.json({ error: "下载失败" }, { status: 400 }));
  await parsing;
  assert.match(model.state.form_error.value, /下载失败/);
  assert.equal(model.state.install_preview.value, null);
  const retry = model.methods.preview_install();
  const set_preview = model.state.install_preview.set.bind(model.state.install_preview);
  model.state.install_preview.set = value => {
    if (value) assert.equal(model.state.install_busy.value, false);
    set_preview(value);
  };
  finish(Response.json(install_fixture));
  await retry;
  const saving = model.methods.save_install();
  await model.methods.save_install();
  model.methods.close_install();
  assert.equal(model.state.install_open.value, true);
  assert.equal(calls.length, 3);
  assert.equal(calls[2].body.script, install_fixture.script);
  assert.equal(calls[2].body.kind, "hot");
  assert.equal(calls[2].body.status, "draft");
  finish(Response.json({ error: "保存失败" }, { status: 400 }));
  await saving;
  assert.equal(model.state.install_preview.value.script, install_fixture.script);
  assert.match(model.state.form_error.value, /保存失败/);
  const saved = model.methods.save_install();
  finish(Response.json({ script: { ...script_fixture, id: "installed", kind: "hot", status: "draft", script: install_fixture.script } }));
  await saved;
  assert.equal(model.state.install_open.value, false);
  assert.equal(model.state.script_type.value, "hot");
  assert.equal(model.visible_scripts.value[0].id, "installed");
});

test("发布安装沿用版本校验和 Cookie 授权，取消不授权，确认后用同一份源码保存", async t => {
  refarr_seeds = [];
  const model = ScriptViewModel();
  t.after(() => model.methods.destroy());
  const calls = [];
  fetch_handler = async (url, options) => {
    const body = JSON.parse(options.body);
    calls.push({ url, body });
    if (url.endsWith("/install-preview")) return Response.json(install_fixture);
    if (url.endsWith("/cookie-grants")) return Response.json({ cookie_grant_id: "install-grant" });
    if (body.cookie_grant_id) return Response.json({ script: { ...script_fixture, id: "installed", status: "published" } });
    return Response.json({ error: "需要授权", cookie_permissions: { script_id: "", version: body.version,
      script_hash: "source-hash", permissions: install_fixture.metadata.permissions, visibility: {} } }, { status: 409 });
  };
  model.methods.open_install();
  model.methods.set_install_input(install_fixture.source_url);
  await model.methods.preview_install();
  await model.methods.save_install("published");
  assert.match(model.state.form_error.value, /版本号/);
  assert.equal(calls.length, 1);
  model.methods.set_draft("version", "1.0.0");
  await model.methods.save_install("published");
  assert.equal(model.state.cookie_consent.value.open, true);
  model.methods.close_install();
  assert.equal(model.state.install_open.value, true);
  model.methods.cancel_cookie_consent();
  assert.equal(calls.length, 2);
  await model.methods.save_install("published");
  await model.methods.confirm_cookie_consent();
  assert.equal(calls[3].url, "/admin/api/scripts/cookie-grants");
  assert.equal(calls[3].body.script, install_fixture.script);
  assert.equal(calls[4].body.cookie_grant_id, "install-grant");
  assert.equal(model.state.install_open.value, false);
});

/** 每次构建都重置 refarr 预置数据（ViewModel 是每次调用新建的）。 */
function build_page(script = script_fixture, open = true) {
  refarr_seeds = [(Array.isArray(script) ? script : [script]).map(normalize_fixture), [log_fixture]];
  const root = ScriptPage();
  if (open) find_node(root, "script-create-button").props.onClick();
  return root;
}

test("脚本卡片右侧集中管理按钮，新增订阅源复用弹窗并支持取消、失败重试和保存", async t => {
  const original = fetch_handler;
  t.after(() => { fetch_handler = original; });
  const writes = [];
  const reads = [];
  let fail = true;
  fetch_handler = async (url, options = {}) => {
    if (options.method === "POST") {
      writes.push({ url, body: JSON.parse(options.body) });
      return fail ? Response.json({ error: "订阅源保存失败" }, { status: 400 })
        : Response.json({ source: { id: "new-source", ...writes.at(-1).body } });
    }
    reads.push(url);
    return Response.json(url.includes("/scripts") ? { scripts: [] }
      : { sources: [], platforms: [{ id: "website", name: "网页" }, { id: "custom", name: "自定义平台" }], tags: ["科技"] });
  };
  const root = build_page({ ...script_fixture, id: "one", status: "published", cookie_grant_id: "grant",
    draft: { script: script_fixture.script + "\n// 草稿", updated_at: 1700000002000 } }, false);
  t.after(() => find_node(root, "scripts-content").props.onUnmounted());
  const management = find_node(root, "script-card-management-actions");
  assert.deepEqual(child_texts(find_node(find_node(root, "script-card-release"), "script-draft-status")), ["存在草稿版本"]);
  assert.deepEqual(child_texts(find_node(root, "script-edit-button")), ["编辑草稿"]);
  for (const name of ["script-cookie-revoke", "script-status-button", "script-delete-button"]) {
    assert.ok(find_node(management, name));
  }
  assert.equal(find_node(management, "script-source-create-button"), undefined);
  const create = find_node(root, "script-source-create-button");
  assert.equal(find_node(root, "discovery-source-dialog"), undefined);
  await create.props.onClick();
  assert.equal(find_node(root, "discovery-source-dialog").props.title.value, "新增订阅源");
  assert.equal(find_node(root, "script-form-dialog"), undefined);
  assert.ok(reads.includes("/admin/api/scripts?kind=rss"));
  assert.ok(find_node(root, "discovery-source-tag-option"));
  const edit = (name, value) => find_node(root, name).props.onInput({ target: { value } });
  edit("discovery-source-title-input", "待取消");
  find_node(root, "discovery-source-cancel-button").props.onClick();
  assert.equal(find_node(root, "discovery-source-dialog"), undefined);
  assert.equal(writes.length, 0);
  await create.props.onClick();
  assert.equal(find_node(root, "discovery-source-title-input").props.value.value, "");
  edit("discovery-source-title-input", "新订阅源");
  edit("discovery-source-feed-input", "{{hostname}}/rss/wxmp/wow36kr");
  await find_node(root, "discovery-source-submit-button").props.onClick();
  assert.match(child_texts(find_node(root, "discovery-source-form-error")).join(""), /订阅源保存失败/);
  assert.equal(find_node(root, "discovery-source-title-input").props.value.value, "新订阅源");
  fail = false;
  await find_node(root, "discovery-source-submit-button").props.onClick();
  assert.equal(find_node(root, "discovery-source-dialog"), undefined);
  assert.equal(writes.at(-1).url, "/admin/api/discovery/sources");
  assert.equal(writes.at(-1).body.feed_url, "{{hostname}}/rss/wxmp/wow36kr");
  assert.deepEqual(child_texts(find_node(root, "script-source-status")), ["新订阅源 已保存。"]);
});

test("脚本配置按钮按 Schema 渲染、校验、保存并重新填入旧值；取消不提交", async () => {
  const config_schema = { type: "object", required: ["token"], properties: {
    token: { type: "string", title: "Token", minLength: 1, writeOnly: true },
    count: { type: "integer", minimum: 0, maximum: 10, default: 0 },
    enabled: { type: "boolean", default: false },
    mode: { type: "string", enum: ["all", "new"], enumDescriptions: ["全部", "最新"], default: "new" },
    options: { type: "object", properties: { tags: { type: "array", items: { type: "string" } } } },
  } };
  let saved = { ...script_fixture, id: "configured", config_schema, config: { token: "old" } };
  const requests = [];
  fetch_handler = async (url, options) => {
    if (options?.method === "PATCH") {
      const body = JSON.parse(options.body);
      requests.push(body);
      saved = { ...saved, config: body.config, updated_at: saved.updated_at + 1 };
      return Response.json({ script: saved });
    }
    return Response.json({ scripts: [saved] });
  };
  assert.equal(find_node(build_page(script_fixture, false), "script-config-button"), undefined);
  const root = build_page(saved, false);
  find_node(root, "script-config-button").props.onClick();
  assert.ok(find_node(root, "script-config-dialog"));
  assert.equal(find_node(root, "script-config-field-token").props.type, "password");
  assert.equal(find_node(root, "script-config-field-count").props.value.value, "0");
  assert.equal(find_node(root, "script-config-field-enabled").props.checked.value, false);
  assert.deepEqual(find_node(root, "script-config-field-mode").props.options.map(option => option.label), ["全部", "最新"]);
  find_node(root, "script-config-field-token").props.onChange("");
  assert.equal(await find_node(root, "script-config-save").props.onClick(), false);
  assert.equal(requests.length, 0);
  assert.match(find_node(root, "script-config-error").children[0].value, /token/);
  find_node(root, "script-config-field-token").props.onChange("new");
  find_node(root, "script-config-field-mode").props.onChange({ target: { value: '"all"' } });
  find_node(root, "script-config-field-options-tags").props.onChange('["news"]');
  assert.equal(await find_node(root, "script-config-save").props.onClick(), true);
  assert.deepEqual(requests, [{ config: { token: "new", count: 0, enabled: false, mode: "all", options: { tags: ["news"] } } }]);
  assert.equal(find_node(root, "script-config-dialog"), undefined);
  find_node(root, "script-config-button").props.onClick();
  assert.equal(find_node(root, "script-config-field-token").props.value.value, "new");
  find_node(root, "script-config-field-token").props.onChange("cancelled");
  find_node(root, "script-config-cancel").props.onClick();
  assert.equal(requests.length, 1);
});

test("配置 Model 保留失败输入、防止重复保存并按新 Schema 切换字段", async () => {
  let reject_save;
  const model = ScriptConfigModel({ save: () => new Promise((resolve, reject) => { reject_save = reject; }) });
  const script = { id: "one", config_schema: { type: "object", properties: {
    amount: { type: "number" }, list: { type: "array", items: { type: "integer" } },
  } }, config: {} };
  model.methods.open(script);
  model.methods.set_field('["list"]', "[");
  assert.equal(await model.methods.save(), false);
  assert.match(model.state.error.value, /JSON 数组/);
  model.methods.set_field('["list"]', "[0]");
  model.methods.set_field('["amount"]', "0.5");
  const pending = model.methods.save();
  assert.equal(model.state.busy.value, true);
  model.methods.close();
  assert.equal(model.state.open.value, true);
  assert.equal(await model.methods.save(), false);
  reject_save(new Error("保存失败"));
  assert.equal(await pending, false);
  assert.equal(model.state.fields.value[0].value.value, "0.5");
  assert.equal(model.state.error.value, "保存失败");
  model.methods.close();
  model.methods.open({ id: "two", config_schema: { type: "object", properties: { title: { type: "string", default: "新表单" } } } });
  assert.deepEqual(model.state.fields.value.map(field => field.path), [["title"]]);
  assert.equal(model.state.fields.value[0].value.value, "新表单");
});

test("Schema 移除字段或把字段改为对象后，配置表单仍可修复并保存，取消不删除旧值", async () => {
  let saved;
  const model = ScriptConfigModel({ save: async (id, config) => { saved = config; } });
  const config = { removed: "old", options: "legacy" };
  const script = { id: "updated", config, config_schema: { type: "object", additionalProperties: false, properties: {
    options: { type: "object", properties: { title: { type: "string" } } },
  } } };
  model.methods.open(script);
  model.methods.close();
  assert.deepEqual(config, { removed: "old", options: "legacy" });
  model.methods.open(script);
  model.methods.set_field('["options","title"]', "updated");
  assert.equal(await model.methods.save(), true);
  assert.deepEqual(saved, { options: { title: "updated" } });
  model.methods.open({ id: "empty-object", config_schema: { type: "object", required: ["options"], properties: {
    options: { type: "object", properties: {} },
  } } });
  assert.equal(await model.methods.save(), true);
  assert.deepEqual(saved, { options: {} });
});

test("多位维护者显示昵称、头像和安全链接，保留旧字符串并屏蔽非法 URL", () => {
  const root = build_page({ ...script_fixture, platform: "zhihu", maintainers: [
    { nickname: "甲", url: "https://example.com/author", avatar: "https://example.com/avatar.png" },
    { nickname: "乙", url: "javascript:alert(1)", avatar: "data:image/svg+xml,bad" }, "旧维护者",
  ] }, false);
  assert.equal(find_node(root, "script-maintainer-link").props.href, "https://example.com/author");
  assert.equal(find_node(root, "script-maintainer-avatar").props.src, "https://example.com/avatar.png");
  assert.deepEqual(child_texts(find_node(root, "script-maintainer-nickname")), ["乙"]);
  assert.ok(child_texts(find_node(root, "script-card-maintainers-value")).includes("旧维护者"));
  assert.equal(find_node(root, "script-card-platform").children.at(-1), "知乎");
});

test("维护者兼容 name 与头像，空头像和非法地址不渲染图片", () => {
  for (const avatar of ["https://example.com/avatar.png", "", "javascript:alert(1)"]) {
    const root = build_page({ ...script_fixture, maintainers: [{ name: "维护者", avatar }] }, false);
    assert.deepEqual(child_texts(find_node(root, "script-maintainer-nickname")), ["维护者"]);
    assert.equal(find_node(root, "script-maintainer-avatar")?.props.src,
      avatar.startsWith("https:") ? avatar : undefined);
  }
});

test("卡片首行展示平台、网站、共享者和大小，第二行展示分钟级更新时间", () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M0 0h24v24H0z"/></svg>';
  for (const [platform, expected] of [
    [{ name: "独立平台", icon: svg }, "data:image/svg+xml," + encodeURIComponent(svg)],
    [{ name: "独立平台", icon: "https://example.com/icon.png" }, "https://example.com/icon.png"],
    [{ name: "独立平台", icon: "" }, "/platform-icons/website.svg"],
    ["zhihu", "/platform-icons/zhihu.svg"],
  ]) {
    const root = build_page({ ...script_fixture, platform, updated_at: new Date(2026, 9, 16, 8, 5, 49).getTime() }, false);
    const identity = find_node(root, "script-card-identity");
    assert.deepEqual(find_node(identity, "script-card-metadata").children.map(node => node.props.attributes.n),
      ["script-card-platform", "script-card-website", "script-card-maintainers", "script-card-size"]);
    assert.deepEqual(child_texts(find_node(identity, "script-card-updated")), ["更新于 2026-10-16 08:05"]);
    assert.equal(find_node(identity, "script-card-platform-icon").props.src, expected);
    assert.equal(find_node(root, "script-card-title"), undefined);
    assert.equal(find_node(root, "script-card-description"), undefined);
    assert.equal(find_node(root, "script-card-maintainers").props.attributes["aria-label"], "共享者");
    assert.deepEqual(child_texts(find_node(identity, "script-card-size")), ["1 KB"]);
    assert.equal(find_node(identity, "script-card-platform").children.at(-1), typeof platform === "string" ? "知乎" : platform.name);
  }
  for (const updated_at of [0, "invalid"]) {
    assert.deepEqual(child_texts(find_node(build_page({ ...script_fixture, updated_at }, false), "script-card-updated")), ["更新于 未知"]);
  }
});

test("RSS/Hot Tabs 按 RSS 优先排序，各自筛选列表与计数，新增沿用当前类型", async t => {
  const original = fetch_handler;
  t.after(() => { fetch_handler = original; });
  const scripts = [
    { ...script_fixture, id: "rss-one", name: "RSS 一", kind: "rss", script_type: "hot" },
    { ...script_fixture, id: "rss-two", name: "RSS 二", kind: "rss", enabled: false },
    { ...script_fixture, id: "hot-one", name: "热榜一", kind: "hot", script_type: "rss" },
  ];
  fetch_handler = async () => Response.json({ scripts });
  const root = build_page(scripts.filter(script => script.kind === "rss"), false);
  const tabs = find_node(root, "script-type-tabs");
  assert.deepEqual(tabs.props.items.map(({ id, label }) => [id, label]), [["rss", "RSS"], ["hot", "Hot"]]);
  assert.equal(root.props.title, "脚本管理");
  assert.equal(root.props.count, undefined);
  assert.equal(find_node(root, "script-type-count"), undefined);
  assert.equal(find_node(root, "script-page-actions"), undefined);
  const names = () => card_names(root);
  assert.deepEqual(names(), ["RSS 一", "RSS 二"]);
  await find_node(root, "script-filter-query-input").props.onInput({ target: { value: "RSS 一" } });
  assert.deepEqual(names(), ["RSS 一"]);
  assert.deepEqual(child_texts(find_node(root, "scripts-pagination-summary")), ["共 1 条 · 显示 1–1"]);
  await tabs.props.onChange("hot");
  assert.deepEqual(names(), ["热榜一"]);
  assert.equal(find_node(root, "script-filter-query-input").props.value.value, "");
  assert.equal(find_node(root, "script-copy-rss-button"), undefined);
  assert.equal(find_node(root, "script-preview-button"), undefined);
  assert.equal(find_node(root, "script-copy-button"), undefined);
  find_node(root, "script-create-button").props.onClick();
  assert.equal(find_node(root, "script-code-textarea").props.value.value, DEFAULT_HOT_SCRIPT);
  assert.equal(find_node(root, "script-debug-url").props.value.value, "/baidu/hot");
  find_node(root, "script-form-close-button").props.onClick();
  await tabs.props.onChange("rss");
  assert.deepEqual(names(), ["RSS 一", "RSS 二"]);
  assert.equal(find_node(root, "script-copy-rss-button"), undefined);
  await find_node(root, "script-filter-status-select").props.onChange({ target: { value: "disabled" } });
  assert.deepEqual(names(), ["RSS 二"]);
});

test("草稿调试输入仅含路径，提交时固定添加 /debug，展示完整输出", async t => {
  const original = fetch_handler;
  t.after(() => { fetch_handler = original; });
  const calls = [];
  fetch_handler = async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    return Response.json({ ok: true, status: 200, rss_debug: {
      phase: "ok", elapsed_ms: 5, invoked: true, output: "x".repeat(5000),
      request: { params: { uid: "actual" } }, lines: [{ level: "info", text: "执行日志" }],
      upstream_requests: [], script: { path: "/sample/:uid" },
    } });
  };
  const root = build_page();
  t.after(() => find_node(root, "scripts-content").props.onUnmounted());
  assert.ok(find_node(root, "script-code-pane"));
  assert.ok(find_node(root, "script-debug-pane"));
  find_node(root, "script-code-textarea").props.onInput({ target: { value: "未保存代码" } });
  find_node(root, "script-debug-url").props.onInput({ target: { value: "/sample/actual?q=2" } });
  assert.equal(find_node(root, "script-debug-url").props.value.value, "/sample/actual?q=2");
  await find_node(root, "script-debug-run-button").props.onClick();
  assert.deepEqual(calls, [{ url: "/admin/api/scripts/debug", body: {
    script: "未保存代码", version: "", request_url: "/debug/sample/actual?q=2", route: "", cookie_grant_id: "",
  } }]);
  const output = find_node(root, "script-debug-output-content");
  assert.equal(output.props.value.value.length, 5000);
  assert.equal(output.props.readOnly, true);
  assert.equal(output.props.mode.value, "text/plain");
  assert.match(child_texts(find_node(root, "script-debug-logs-content")).join(""), /执行日志/);
  assert.match(child_texts(find_node(root, "script-debug-request-content")).join(""), /actual/);
  assert.match(child_texts(find_node(root, "script-debug-summary")).join(""), /HTTP 200.*已调用设备/);
  const tabs = find_node(root, "script-debug-tabs");
  assert.deepEqual(tabs.props.items.map(({ id, label }) => [id, label]),
    [["output", "输出"], ["context", "上下文"], ["logs", "日志"], ["xml", "XML预览"], ["feed", "预览"]]);
  const panels = tabs.props.items.map(item => item.content[0]);
  assert.ok(find_node(panels[0], "script-debug-output-content"));
  assert.equal(find_node(panels[0], "script-debug-request-content"), undefined);
  for (const name of ["request", "upstream", "route"]) assert.ok(find_node(panels[1], "script-debug-" + name + "-content"));
  assert.ok(find_node(panels[2], "script-debug-logs-content"));
  assert.equal(find_node(panels[2], "script-debug-output-content"), undefined);
  find_node(root, "script-debug-url").props.onInput({ target: { value: "/debug/sample/copied?q=3" } });
  assert.equal(find_node(root, "script-debug-url").props.value.value, "/sample/copied?q=3");
  await find_node(root, "script-debug-run-button").props.onClick();
  assert.equal(calls.at(-1).body.request_url, "/debug/sample/copied?q=3", "粘贴调试地址不会重复添加前缀");
});

test("RSS Debug 格式化 XML 代码并渲染频道和分页列表，响应变化更新解析结果", async t => {
  const original = fetch_handler;
  t.after(() => { fetch_handler = original; });
  let body = JSON.stringify({
    title: "预览频道", link: "https://example.com/", description: "频道说明", image: "https://example.com/icon.png",
    items: Array.from({ length: 23 }, (_, index) => ({ title: `文章 ${index + 1}`, link: `/post/${index + 1}`, description: `<p>摘要 ${index + 1}</p>` })),
  });
  fetch_handler = async () => Response.json({ status: 200, rss_debug: {
    phase: "ok", output: body, request: { public_origin: "https://worker.example", pathname: "/debug/test", query: { limit: "23" } },
  } });
  const root = build_page();
  t.after(() => find_node(root, "scripts-content").props.onUnmounted());
  assert.match(child_texts(find_node(root, "script-feed-empty")).join(""), /运行调试/);
  assert.equal(find_node(root, "script-debug-xml-content"), undefined);
  await find_node(root, "script-debug-run-button").props.onClick();
  const xml = find_node(root, "script-debug-xml-content");
  assert.equal(xml.props.readOnly, true);
  assert.equal(xml.props.mode, "application/xml");
  assert.match(xml.props.value.value, /<rss [\s\S]*\n\s+<channel>/);
  assert.match(xml.props.value.value, /https:\/\/worker.example\/rss\/test\?limit=23/);
  assert.equal(child_texts(find_node(root, "script-feed-channel-title")).join(""), "预览频道");
  assert.equal(find_node(root, "script-feed-icon").props.src.value, "https://example.com/icon.png");
  assert.equal(walk(root).filter(node => node.props?.attributes?.n === "script-feed-item").length, 20);
  assert.equal(find_node(root, "script-feed-item-title").props.href, "https://example.com/post/1");
  assert.equal(child_texts(find_node(root, "script-feed-item-summary")).join(""), "摘要 1");
  assert.equal(child_texts(find_node(root, "script-feed-count")).join(""), "RSS · 23 条内容");
  const feed_panel = find_node(root, "script-debug-tabs").props.items.find(item => item.id === "feed").content[0];
  find_node(feed_panel, "script-feed-pagination-next").props.onClick();
  assert.equal(child_texts(find_node(feed_panel, "script-feed-item-title")).join(""), "文章 21");
  assert.equal(walk(feed_panel).filter(node => node.props?.attributes?.n === "script-feed-item").length, 3);

  body = '<rss version="2.0"><channel><title>更新频道</title><item><title>更新文章</title></item></channel></rss>';
  await find_node(root, "script-debug-run-button").props.onClick();
  assert.equal(child_texts(find_node(root, "script-feed-channel-title")).join(""), "更新频道");
  assert.equal(child_texts(find_node(root, "script-feed-item-title")).join(""), "更新文章");
  assert.match(find_node(root, "script-debug-xml-content").props.value.value, /更新文章/);
  body = "<rss><channel></rss>";
  await find_node(root, "script-debug-run-button").props.onClick();
  assert.equal(find_node(root, "script-feed-channel"), undefined);
  assert.match(child_texts(find_node(root, "script-feed-error")).join(""), /XML/);
});

test("草稿图片预览使用 Debug 会话，相同输出再次调试也更新图标和封面入口", async t => {
  const original = fetch_handler;
  t.after(() => { fetch_handler = original; });
  const origin = "https://feeds.example";
  const icon = origin + "/img/draft?url=https%3A%2F%2Fcdn.example%2Ficon.png";
  const cover = origin + "/img/draft?url=https%3A%2F%2Fcdn.example%2Fcover.png";
  const output = JSON.stringify({ title: "草稿", link: "https://example.com/", image: icon,
    items: [{ title: "文章", link: "https://example.com/1", image: cover }] });
  let id = "11111111-1111-4111-8111-111111111111";
  fetch_handler = async () => Response.json({ status: 200, rss_debug: { phase: "ok", output,
    request: { public_origin: origin, pathname: "/debug/draft" }, preview_assets: {
      endpoint: "/admin/api/scripts/preview-assets/" + id, public_origin: origin, paths: ["/img/draft"],
    } } });
  const root = build_page();
  t.after(() => find_node(root, "scripts-content").props.onUnmounted());
  for (const next of [id, "22222222-2222-4222-8222-222222222222"]) {
    id = next;
    await find_node(root, "script-debug-run-button").props.onClick();
    const endpoint = "/admin/api/scripts/preview-assets/" + id;
    assert.equal(find_node(root, "script-feed-icon").props.src.value, endpoint + "?url=" + encodeURIComponent(icon));
    assert.equal(find_node(root, "script-feed-item-image").props.src, endpoint + "?url=" + encodeURIComponent(cover));
    const xml = find_node(root, "script-debug-xml-content").props.value.value;
    assert.ok(xml.includes(icon));
    assert.equal(xml.includes(endpoint), false);
  }
});

test("预览 Tabs 按正在编辑的草稿 kind 显示，Hot 不显示 XML 和卡片预览", () => {
  const root = build_page([{ ...script_fixture, id: "hot", kind: "hot" }], false);
  find_node(root, "script-type-tabs").props.onChange("hot");
  find_node(root, "script-create-button").props.onClick();
  assert.deepEqual(find_node(root, "script-debug-tabs").props.items.map(item => item.id), ["output", "context", "logs"]);
  find_node(root, "script-form-close-button").props.onClick();
  find_node(root, "script-edit-button").props.onClick();
  find_node(root, "script-type-tabs").props.onChange("rss");
  assert.deepEqual(find_node(root, "script-debug-tabs").props.items.map(item => item.id), ["output", "context", "logs"]);
});

test("正式脚本保存独立草稿，重新打开继续编辑草稿，Diff 对比正式源码，发布才替换正式版本", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const original = fetch_handler;
  t.after(() => { fetch_handler = original; });
  let script = { ...script_fixture, id: "published-script", status: "published", version: "1.0.0",
    published_version: "1.0.0", published_script: script_fixture.script };
  const requests = [];
  fetch_handler = async (url, options = {}) => {
    if (!options.body) return Response.json({ scripts: [script] });
    const body = JSON.parse(options.body);
    requests.push({ url, body });
    if (body.status === "draft") script = { ...script, draft: { ...body, updated_at: 1792213445000 } };
    else {
      script = { ...script, ...body, published_script: body.script, published_version: body.version };
      delete script.draft;
    }
    return Response.json({ script });
  };
  refarr_seeds = [[normalize_fixture(script)]];
  const model = ScriptViewModel();
  t.after(() => model.methods.destroy());
  model.methods.edit_script(script.id);
  const next = script_fixture.script + "\n// 下一版草稿";
  model.methods.set_draft("script", next);
  model.methods.set_draft("version", "1.0.1");
  model.methods.set_draft("debug", true);
  await model.methods.save_script();
  assert.equal(model.state.form_open.value, true);
  assert.equal(model.state.draft_script.value, next);
  assert.match(model.state.form_message.value, /保存为草稿/);
  assert.equal(model.state.draft_saved_at.value, 1792213445000);
  assert.equal(model.state.scripts.value[0].status, "published");
  assert.equal(model.state.scripts.value[0].script, script_fixture.script);
  model.methods.close_form();
  model.methods.edit_script(script.id);
  assert.equal(model.state.draft_script.value, next);
  assert.equal(model.state.draft_version.value, "1.0.1");
  assert.equal(model.state.draft_debug.value, true);
  assert.equal(model.state.draft_saved_at.value, 1792213445000);
  model.methods.open_diff();
  assert.equal(applyPatch(script_fixture.script, model.state.diff_text.value), next);
  model.methods.close_diff();
  await model.methods.save_script("published");
  assert.equal(requests.at(-1).url, "/admin/api/scripts/published-script");
  assert.equal(requests.at(-1).body.script, next);
  assert.equal(requests.at(-1).body.version, "1.0.1");
  assert.equal(model.state.form_open.value, false);
  assert.equal(model.state.scripts.value[0].draft, null);
  model.methods.edit_script(script.id);
  model.methods.open_diff();
  assert.equal(model.state.draft_script.value, next);
  assert.equal(model.state.diff_text.value, "");
});

for (const editing of [false, true]) {
  test(`${editing ? "编辑" : "新增"}起点多路由使用一级 Tab，草稿重新编译保留各自输入并同步路由增删`, async t => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const old_fetch = fetch_handler, old_routes = routes_handler;
    t.after(() => { fetch_handler = old_fetch; routes_handler = old_routes; });
    let routes = [
      { path: "/qidian/book/:book_id", name: "章节列表", example: "/qidian/book/1036526469" },
      { path: "/qidian/chapter/:book_id/:chapter_id", name: "正文", example: "/qidian/chapter/1036526469/745825165" },
    ];
    const source = readFileSync(new URL("../../examples/scripts/rss/qidian.js", import.meta.url), "utf8");
    const requests = [];
    routes_handler = async (_url, options) => {
      assert.equal(JSON.parse(options.body).script, source);
      return Response.json({ routes });
    };
    fetch_handler = async (_url, options) => {
      const body = JSON.parse(options.body);
      requests.push(body);
      return Response.json({ status: 200, rss_debug: { output: body.request_url, phase: "ok", elapsed_ms: 1 } });
    };
    const root = build_page({ ...script_fixture, id: "qidian", script: source, routes }, false);
    t.after(() => find_node(root, "scripts-content").props.onUnmounted());
    const rows = () => walk(root).filter(node => node.props?.attributes?.n === "script-debug-route-row");
    const tabs = () => find_node(root, "script-debug-route-tabs");
    const select = path => tabs().props.onChange(path);
    find_node(root, editing ? "script-edit-button" : "script-create-button").props.onClick();
    const code = find_node(root, "script-code-textarea");
    if (!editing) code.props.onInput({ target: { value: source } });
    t.mock.timers.tick(400);
    await new Promise(setImmediate);
    assert.equal(rows().length, 1);
    assert.deepEqual(tabs().props.items.map(item => [item.id, item.label]), routes.map(route => [route.path, route.name]));
    assert.equal(find_node(root, "script-debug-url").props.value.value, routes[0].example);
    assert.equal(find_node(root, "script-debug-url-field"), undefined);
    assert.equal(find_node(root, "script-debug-route-path"), undefined);
    for (const row of rows()) assert.deepEqual(row.children.map(node => node.props.attributes.n),
      ["script-debug-url", "script-debug-run-button"]);
    await find_node(root, "script-debug-run-button").props.onClick();
    select(routes[1].path);
    assert.equal(find_node(root, "script-debug-url").props.value.value, routes[1].example);
    assert.equal(find_node(root, "script-debug-output-content"), undefined);
    const input = find_node(root, "script-debug-url");
    input.props.onInput({ target: { value: "/qidian/chapter/123/456?full=1" } });
    await find_node(root, "script-debug-run-button").props.onClick();
    assert.deepEqual(requests.map(body => body.request_url), [
      "/debug/qidian/book/1036526469", "/debug/qidian/chapter/123/456?full=1",
    ]);
    assert.ok(requests.every(body => body.script === source && body.route === (editing ? "qidian" : "")));
    select(routes[0].path);
    assert.equal(find_node(root, "script-debug-output-content").props.value.value, "/debug/qidian/book/1036526469");
    select(routes[1].path);
    assert.equal(find_node(root, "script-debug-output-content").props.value.value, "/debug/qidian/chapter/123/456?full=1");
    t.mock.timers.tick(800);
    await new Promise(setImmediate);
    assert.equal(requests.length, 2, "切换路由不会自动调试");
    routes = [routes[1], { path: "/qidian/latest", name: "最新", example: "/qidian/latest" }];
    code.props.onInput({ target: { value: source } });
    t.mock.timers.tick(400);
    await new Promise(setImmediate);
    assert.equal(rows().length, 1);
    assert.deepEqual(tabs().props.items.map(item => item.id), routes.map(route => route.path));
    assert.equal(find_node(root, "script-debug-url").props.value.value, "/qidian/chapter/123/456?full=1");
    select(routes[1].path);
    assert.equal(find_node(root, "script-debug-url").props.value.value, "/qidian/latest");
    select(routes[0].path);
    input.props.onInput({ target: { value: "" } });
    code.props.onInput({ target: { value: source } });
    t.mock.timers.tick(400);
    await new Promise(setImmediate);
    assert.equal(find_node(rows()[0], "script-debug-url").props.value.value, "");
    assert.equal(find_node(rows()[0], "script-debug-run-button").props.disabled.value, true);
  });
}

test("RSS 和图片代理各自调试并保留输出、上下文与日志，修改源码后两条路由都标记过期", async t => {
  const old_fetch = fetch_handler;
  t.after(() => { fetch_handler = old_fetch; });
  const routes = [
    { path: "/feed/:id", name: "RSS 订阅", example: "/feed/123" },
    { path: "/img/draft", name: "图片代理", example: "/img/draft?url=https%3A%2F%2Fcdn.example%2Fcover.png", allowed_hosts: ["cdn.example"] },
  ];
  const calls = [];
  fetch_handler = async (_url, options) => {
    const body = JSON.parse(options.body);
    calls.push(body);
    const image = body.request_url.startsWith("/debug/img/");
    return Response.json({ status: 200, rss_debug: {
      phase: "ok", elapsed_ms: 1,
      output: JSON.stringify(image ? { url: "https://cdn.example/cover.png", headers: { Referer: "https://example.com/" } }
        : { title: "RSS 频道", link: "https://example.com/", items: [] }),
      request: { pathname: body.request_url }, lines: [{ level: "info", text: image ? "图片日志" : "RSS 日志" }],
    } });
  };
  const root = build_page({ ...script_fixture, id: "multi", routes }, false);
  t.after(() => find_node(root, "scripts-content").props.onUnmounted());
  find_node(root, "script-edit-button").props.onClick();
  const tabs = () => find_node(root, "script-debug-route-tabs");
  const select = path => tabs().props.onChange(path);
  assert.deepEqual(tabs().props.items.map(item => item.label), ["RSS 订阅", "图片代理"]);
  assert.ok(find_node(tabs().props.items[0].content, "script-debug-tabs"), "结果 Tab 位于路由 Tab 内");
  await find_node(root, "script-debug-run-button").props.onClick();
  assert.equal(child_texts(find_node(root, "script-feed-channel-title")).join(""), "RSS 频道");
  select(routes[1].path);
  assert.deepEqual(find_node(root, "script-debug-tabs").props.items.map(item => item.id), ["output", "context", "logs"]);
  assert.equal(find_node(root, "script-debug-output-content"), undefined);
  await find_node(root, "script-debug-run-button").props.onClick();
  assert.match(find_node(root, "script-debug-output-content").props.value.value, /cdn.example/);
  assert.match(child_texts(find_node(root, "script-debug-logs-content")).join(""), /图片日志/);
  assert.match(child_texts(find_node(root, "script-debug-request-content")).join(""), /img\/draft/);
  select(routes[0].path);
  assert.equal(child_texts(find_node(root, "script-feed-channel-title")).join(""), "RSS 频道");
  assert.match(child_texts(find_node(root, "script-debug-logs-content")).join(""), /RSS 日志/);
  assert.doesNotMatch(child_texts(find_node(root, "script-debug-request-content")).join(""), /img\/draft/);
  find_node(root, "script-code-textarea").props.onInput({ target: { value: "修改过的完整源码" } });
  assert.match(child_texts(find_node(root, "script-debug-summary")).join(""), /等待重新调试/);
  select(routes[1].path);
  assert.match(child_texts(find_node(root, "script-debug-summary")).join(""), /等待重新调试/);
  assert.equal(calls.length, 2, "切换 Tab 不会额外执行请求");
});

test("切换路由会取消原调试，迟到结果不能覆盖当前路由；删除路由后不会保留其旧结果", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const old_fetch = fetch_handler, old_routes = routes_handler;
  t.after(() => { fetch_handler = old_fetch; routes_handler = old_routes; });
  let routes = [
    { path: "/feed", name: "RSS", example: "/feed" },
    { path: "/img/test", name: "图片", example: "/img/test?url=x", image_proxy: true },
  ];
  const pending = [];
  routes_handler = async () => Response.json({ routes });
  fetch_handler = (_url, options) => new Promise(resolve => pending.push({ resolve, signal: options.signal }));
  const root = build_page({ ...script_fixture, id: "multi", routes }, false);
  t.after(() => find_node(root, "scripts-content").props.onUnmounted());
  find_node(root, "script-edit-button").props.onClick();
  const tabs = () => find_node(root, "script-debug-route-tabs");
  const select = path => tabs().props.onChange(path);
  const first = find_node(root, "script-debug-run-button").props.onClick();
  select("/img/test");
  assert.equal(pending[0].signal.aborted, true);
  assert.equal(find_node(root, "script-debug-run-button").props.disabled.value, undefined);
  const second = find_node(root, "script-debug-run-button").props.onClick();
  pending[1].resolve(Response.json({ status: 200, rss_debug: { phase: "ok", output: '"当前图片结果"' } }));
  await second;
  pending[0].resolve(Response.json({ status: 502, rss_debug: { error_text: "迟到的 RSS 错误" } }));
  await first;
  assert.equal(find_node(root, "script-debug-output-content").props.value.value, "当前图片结果");
  assert.equal(find_node(root, "script-debug-stack-content"), undefined);
  select("/feed");
  assert.equal(find_node(root, "script-debug-output-content"), undefined);
  const edit = value => find_node(root, "script-code-textarea").props.onInput({ target: { value } });
  const removed = routes[1];
  routes = [routes[0]];
  edit("删除图片路由"); t.mock.timers.tick(400); await new Promise(setImmediate);
  assert.equal(tabs().props.items.length, 1);
  routes = [...routes, removed];
  edit("重新添加图片路由"); t.mock.timers.tick(400); await new Promise(setImmediate);
  select(removed.path);
  assert.equal(find_node(root, "script-debug-output-content"), undefined, "重新添加的路由从未调试状态开始");
});

test("二级 Tab 随 handler 返回的 kind 更新，分别渲染图片、MP4 和音频控件", async t => {
  const original = fetch_handler;
  t.after(() => { fetch_handler = original; });
  let returned;
  const endpoint = "/admin/api/scripts/preview-assets/11111111-1111-4111-8111-111111111111";
  fetch_handler = async () => Response.json({ status: 200, rss_debug: { phase: "ok", output: JSON.stringify(returned),
    preview_assets: { endpoint, media_url: endpoint + "?media=1" } } });
  const root = build_page();
  t.after(() => find_node(root, "scripts-content").props.onUnmounted());
  for (const [kind, node_name] of [["img", "image"], ["video", "video"], ["audio", "audio"]]) {
    returned = { kind, url: "https://cdn.example/file" };
    await find_node(root, "script-debug-run-button").props.onClick();
    assert.deepEqual(find_node(root, "script-debug-tabs").props.items.map(item => [item.id, item.label]),
      [["output", "输出"], ["context", "上下文"], ["logs", "日志"], ["preview", "预览"]]);
    const media = find_node(root, "script-debug-media-" + node_name);
    assert.ok(media, kind);
    if (kind === "img") assert.equal(media.props.src.value, endpoint + "?media=1");
    else {
      assert.equal(media.type, kind);
      assert.equal(media.props.src.value, endpoint + "?media=1");
      assert.equal(media.props.controls, true);
      assert.equal(media.props.preload, "metadata");
      assert.equal(media.props.autoplay, undefined);
    }
    assert.equal(find_node(root, "script-feed-preview"), undefined);
  }
  returned = { kind: "rss", title: "RSS", link: "https://example.com/", items: [] };
  await find_node(root, "script-debug-run-button").props.onClick();
  assert.deepEqual(find_node(root, "script-debug-tabs").props.items.map(item => item.id), ["output", "context", "logs", "xml", "feed"]);
  assert.equal(find_node(root, "script-debug-media-preview"), undefined);
  assert.equal(child_texts(find_node(root, "script-feed-channel-title")).join(""), "RSS");
});

test("草稿路由编译失败保留输入，迟到的元数据不会覆盖新草稿或重新打开的表单", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const original = routes_handler;
  t.after(() => { routes_handler = original; });
  const pending = [];
  routes_handler = () => new Promise(resolve => pending.push(resolve));
  const root = build_page();
  t.after(() => find_node(root, "scripts-content").props.onUnmounted());
  const edit = value => find_node(root, "script-code-textarea").props.onInput({ target: { value } });
  edit("旧草稿");
  t.mock.timers.tick(400);
  edit("新草稿");
  t.mock.timers.tick(400);
  pending[1](Response.json({ routes: [{ path: "/new", example: "/new" }] }));
  await new Promise(setImmediate);
  pending[0](Response.json({ routes: [{ path: "/old", example: "/old" }] }));
  await new Promise(setImmediate);
  assert.equal(find_node(root, "script-debug-url").props.value.value, "/new");
  edit("无效草稿");
  t.mock.timers.tick(400);
  pending[2](Response.json({ error: "编译失败" }, { status: 400 }));
  await new Promise(setImmediate);
  assert.deepEqual(child_texts(find_node(root, "script-debug-routes-error")), ["编译失败"]);
  assert.equal(find_node(root, "script-debug-url").props.value.value, "/new");
  edit("关闭前草稿");
  t.mock.timers.tick(400);
  find_node(root, "script-form-close-button").props.onClick();
  find_node(root, "script-create-button").props.onClick();
  pending[3](Response.json({ routes: [{ path: "/late", example: "/late" }] }));
  await new Promise(setImmediate);
  assert.equal(find_node(root, "script-debug-url").props.value.value, "/solidot");
});

test("路由输出只读编辑器随响应更新正文、格式和高亮模式", async t => {
  const original = fetch_handler;
  t.after(() => { fetch_handler = original; });
  let response_output = '{"title":"feed","items":[]}';
  fetch_handler = async () => Response.json({ ok: true, status: 200,
    rss_debug: { phase: "ok", elapsed_ms: 1, output: response_output } });
  const root = build_page();
  t.after(() => find_node(root, "scripts-content").props.onUnmounted());
  find_node(root, "script-code-textarea").props.onInput({ target: { value: "草稿" } });
  find_node(root, "script-debug-url").props.onInput({ target: { value: "/debug/sample/a" } });
  const run = find_node(root, "script-debug-run-button");
  await run.props.onClick();
  const output = find_node(root, "script-debug-output-content");
  assert.equal(output.type, "code-editor");
  assert.equal(output.props.mode.value, "application/json");
  assert.match(output.props.value.value, /\n  "title": "feed"/);
  response_output = JSON.stringify({ body: '<div><h1>HTML 正文</h1></div>', content_type: "text/html" });
  await run.props.onClick();
  assert.equal(output.props.mode.value, "text/html");
  assert.match(output.props.value.value, /\n  <h1>HTML 正文<\/h1>/);
  assert.doesNotMatch(output.props.value.value, /content_type/);
  response_output = JSON.stringify({ body: '<feed><entry>Atom</entry></feed>', content_type: "application/atom+xml" });
  await run.props.onClick();
  assert.equal(output.props.mode.value, "application/xml");
  assert.match(output.props.value.value, /\n  <entry>Atom<\/entry>/);
});

test("三栏工作区的 AI 对话实时更新代码和 Debug，手动编辑会停止 AI 且不接受旧通道更新", async t => {
  const old_fetch = fetch_handler, old_socket = window.WebSocket, old_location = window.location;
  t.after(() => { fetch_handler = old_fetch; window.WebSocket = old_socket; window.location = old_location; });
  const requests = [], sockets = [];
  window.location = { href: "http://localhost:8787/admin/scripts" };
  window.WebSocket = class {
    constructor() { this.readyState = 0; this.sent = []; sockets.push(this); }
    send(text) { this.sent.push(JSON.parse(text)); }
    close() { this.readyState = 3; this.onclose?.(); }
  };
  fetch_handler = async (url, options) => {
    requests.push({ url, options });
    return Response.json({ configured: true, has_api_key: true, base_url: "https://models.example/v1", model: "test" });
  };
  const root = build_page(); t.after(() => find_node(root, "scripts-content").props.onUnmounted());
  assert.ok(find_node(root, "script-code-pane")); assert.ok(find_node(root, "script-agent-pane")); assert.ok(find_node(root, "script-debug-pane"));
  await find_node(root, "script-agent-pane").props.onMounted();
  const code = find_node(root, "script-code-textarea");
  code.props.onInput({ target: { value: "original" } });
  find_node(root, "script-version-input").props.onInput({ target: { value: "1.0.0" } });
  find_node(root, "script-debug-url").props.onInput({ target: { value: "/sample/real" } });
  find_node(root, "xiaoxun-dialogue-input").props.onInput({ target: { value: "修改并调试" } });
  find_node(root, "xiaoxun-dialogue-send").props.onClick();
  assert.equal(find_node(root, "script-save-button").props.disabled.value, true);
  assert.equal(code.props.disabled, undefined);
  assert.equal(code.props.readOnly.value, false);
  sockets[0].readyState = 1; sockets[0].onopen();
  const run = sockets[0].sent[0];
  assert.equal(run.request_url, "/debug/sample/real", "脚本助手使用固定前缀的完整调试地址");
  assert.equal(run.version, "1.0.0");
  const emit = value => sockets[0].onmessage({ data: JSON.stringify({ ...value, run_id: run.run_id }) });
  emit({ type: "draft", script: "AI new code", expected_revision: run.revision, revision: run.revision + 1 });
  assert.equal(code.props.value.value, "AI new code");
  emit({ type: "debug", revision: run.revision + 1, request_url: run.request_url, result: { ok: true, status: 200,
    rss_debug: { output: '{"title":"AI result"}', phase: "ok", elapsed_ms: 1 } } });
  assert.match(find_node(root, "script-debug-output-content").props.value.value, /AI result/);
  code.props.onInput({ target: { value: "manual code" } });
  assert.equal(sockets[0].sent.at(-1).type, "cancel");
  emit({ type: "draft", script: "stale AI code", expected_revision: run.revision + 2, revision: run.revision + 3 });
  assert.equal(code.props.value.value, "manual code");
  assert.equal(requests.some(request => request.options?.method === "POST" || request.options?.method === "PATCH"), false, "AI 没有保存脚本");
});

test("调试期间可继续编辑，迟到结果不覆盖新草稿；关闭表单取消等待并清空调试", async t => {
  const original = fetch_handler;
  t.after(() => { fetch_handler = original; });
  let finish, signal;
  fetch_handler = (_url, options) => {
    signal = options.signal;
    return new Promise(resolve => { finish = resolve; });
  };
  const root = build_page();
  t.after(() => find_node(root, "scripts-content").props.onUnmounted());
  find_node(root, "script-code-textarea").props.onInput({ target: { value: "旧代码" } });
  find_node(root, "script-debug-url").props.onInput({ target: { value: "/debug/sample/a" } });
  const run = find_node(root, "script-debug-run-button");
  let pending = run.props.onClick();
  assert.equal(run.props.disabled.value, true);
  assert.equal(find_node(root, "script-code-textarea").props.readOnly.value, false);
  find_node(root, "script-code-textarea").props.onInput({ target: { value: "新代码" } });
  finish(Response.json({ ok: true, status: 200, rss_debug: { output: "旧输出", phase: "ok", elapsed_ms: 1 } }));
  await pending;
  assert.equal(find_node(root, "script-debug-output-content"), undefined);
  pending = run.props.onClick();
  find_node(root, "script-form-close-button").props.onClick();
  assert.equal(signal.aborted, true);
  find_node(root, "script-create-button").props.onClick();
  finish(Response.json({ ok: false, status: 502, rss_debug: { error_text: "迟到错误" } }));
  await pending;
  assert.equal(find_node(root, "script-debug-url").props.value.value, "/solidot");
  assert.equal(find_node(root, "script-debug-stack-content"), undefined);
});

test("新增、编辑和重新打开脚本时实时调试默认关闭，运行后修改代码和地址也不会自动调试", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const original = fetch_handler;
  t.after(() => { fetch_handler = original; });
  let calls = 0;
  fetch_handler = async () => {
    calls++;
    return Response.json({ status: 200, rss_debug: { output: "结果" } });
  };
  refarr_seeds = [[normalize_fixture(script_fixture)]];
  const model = ScriptViewModel();
  t.after(() => model.methods.destroy());
  assert.equal(model.state.live_debug.value, false);
  for (const editing of [false, true, false]) {
    if (editing) model.methods.edit_script(script_fixture.id);
    else model.methods.create_script();
    assert.equal(model.state.live_debug.value, false);
    const pending = model.methods.debug_script();
    model.methods.set_draft("script", "修改后的草稿");
    model.methods.set_debug_url("/sample/changed");
    await pending;
    t.mock.timers.tick(2000);
    await new Promise(setImmediate);
    assert.equal(calls, 1, "修改进行中调试的输入不补跑");
    await model.methods.debug_script();
    model.methods.set_draft("script", "再次修改草稿");
    model.methods.set_debug_url("/sample/changed-again");
    t.mock.timers.tick(2000);
    await new Promise(setImmediate);
    assert.equal(calls, 2, "手动运行完成后也不自动调试");
    model.methods.set_live_debug(true);
    model.methods.close_form();
    calls = 0;
  }
});

test("实时调试合并连续编辑，执行期间仅补跑最后一份草稿，关闭后清理定时器", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const original = fetch_handler;
  t.after(() => { fetch_handler = original; });
  const calls = [];
  let finish;
  fetch_handler = (_url, options) => {
    calls.push(JSON.parse(options.body));
    return new Promise(resolve => { finish = resolve; });
  };
  refarr_seeds = [];
  const model = ScriptViewModel();
  t.after(() => model.methods.destroy());
  model.methods.create_script();
  model.methods.set_live_debug(true);
  const edit = value => model.methods.set_draft("script", value);
  edit("初始草稿");
  model.methods.set_debug_url("/debug/sample/a");
  t.mock.timers.tick(1000);
  assert.equal(calls.length, 0, "首次调试须点击运行");
  const pending = model.methods.debug_script();
  edit("中途草稿");
  t.mock.timers.tick(800);
  edit("最后草稿");
  t.mock.timers.tick(800);
  assert.equal(calls.length, 1, "执行期间没有并行运行");
  finish(Response.json({ ok: true, status: 200, rss_debug: { output: "过期输出" } }));
  await pending;
  t.mock.timers.tick(799);
  assert.equal(calls.length, 1);
  t.mock.timers.tick(1);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].script, "最后草稿");
  model.methods.close_form();
  finish(Response.json({ ok: true, status: 200, rss_debug: { output: "已关闭输出" } }));
  await new Promise(resolve => queueMicrotask(resolve));
  t.mock.timers.tick(5000);
  assert.equal(calls.length, 2);
});

test("草稿调试展示错误详情，并保留代码与链接供修改重试", async t => {
  const original = fetch_handler;
  t.after(() => { fetch_handler = original; });
  fetch_handler = async () => Response.json({ ok: false, status: 503, rss_debug: {
    phase: "invoke", error_text: "没有在线设备\n at handler:12", lines: [], elapsed_ms: 2, invoked: true,
  } });
  const root = build_page();
  t.after(() => find_node(root, "scripts-content").props.onUnmounted());
  find_node(root, "script-code-textarea").props.onInput({ target: { value: "草稿" } });
  find_node(root, "script-debug-url").props.onInput({ target: { value: "/debug/sample/a" } });
  await find_node(root, "script-debug-run-button").props.onClick();
  assert.match(child_texts(find_node(root, "script-debug-stack-content")).join(""), /没有在线设备\n at handler:12/);
  assert.equal(find_node(root, "script-code-textarea").props.value.value, "草稿");
  assert.equal(find_node(root, "script-debug-url").props.value.value, "/sample/a");
});

function walk(node, result = []) {
  if (!node || typeof node !== "object") return result;
  result.push(node);
  if (Array.isArray(node)) {
    for (const item of node) walk(item, result);
    return result;
  }
  for (const child of node.children || []) walk(child, result);
  return result;
}

test("Cookie 权限仅点击确认后授权并继续，取消不授权，修改代码不能确认旧版本", async t => {
  const original = fetch_handler;
  t.after(() => { fetch_handler = original; });
  const calls = [];
  const info = { script_id: "", script_hash: "source-hash", permissions: { cookies: [{ id: "session", names: ["SUB"], origin: "https://example.com", path_prefix: "/", purpose: "测试" }] }, visibility: { routes: [] }, source: "共享 Cookie 库", audience: "订阅者" };
  fetch_handler = async (url, options) => {
    const body = JSON.parse(options.body);
    calls.push({ url, body });
    if (url.endsWith("/cookie-grants")) return Response.json({ cookie_grant_id: "grant-id" });
    if (!body.cookie_grant_id) return Response.json({ error: "需要确认", cookie_permissions: info }, { status: 409 });
    return Response.json({ ok: true, status: 200, rss_debug: { output: "{}", cookie_accesses: [{ permission: "session", names: ["SUB"] }] } });
  };
  const root = build_page();
  t.after(() => find_node(root, "scripts-content").props.onUnmounted());
  const edit = value => find_node(root, "script-code-textarea").props.onInput({ target: { value } });
  edit("需要 Cookie 的源码");
  const run = () => find_node(root, "script-debug-run-button").props.onClick();
  await run();
  assert.equal(find_node(root, "script-cookie-consent").props.open.value, true);
  assert.match(child_texts(find_node(root, "script-cookie-permission-names")).join(""), /SUB/);
  assert.equal(calls.length, 1);
  find_node(root, "script-cookie-cancel").props.onClick();
  assert.equal(find_node(root, "script-cookie-consent").props.open.value, false);
  assert.equal(calls.length, 1);
  await run();
  edit("修改后的源码");
  await find_node(root, "script-cookie-confirm").props.onClick();
  assert.match(child_texts(find_node(root, "script-cookie-error")).join(""), /脚本或版本号已变化/);
  assert.equal(calls.length, 2);
  find_node(root, "script-cookie-cancel").props.onClick();
  await run();
  await find_node(root, "script-cookie-confirm").props.onClick();
  assert.equal(calls[3].url, "/admin/api/scripts/cookie-grants");
  assert.equal(calls[3].body.confirmed, true);
  assert.equal(calls[3].body.script, "修改后的源码");
  assert.equal(calls[4].body.cookie_grant_id, "grant-id");
  assert.match(child_texts(find_node(root, "script-debug-cookies-content")).join(""), /session/);
});

function node_names(root) {
  return walk(root)
    .filter((node) => node && node.props)
    .map((node) => String(node.props.attributes?.n || ""))
    .filter((name) => name !== "");
}

function card_names(root) {
  return walk(root)
    .filter(node => node.props?.attributes?.n === "script-card")
    .map(node => child_texts(find_node(node, "script-route-name")).join(""));
}

function find_node(root, semantic_name) {
  return walk(root).find((node) => node?.props?.attributes?.n === semantic_name);
}

/** 取节点的文本子节点：Timeless 允许直接挂 ref，真实渲染时才求值。 */
function child_texts(node) {
  return (node.children || []).map((child) => (child && child.__is_ref ? child.value : child));
}

test("脚本搜索区右侧刷新列表，加载时禁用按钮并保留筛选条件", async () => {
  const root = build_page([], false);
  const form = find_node(root, "script-filter-form");
  const refresh = find_node(form, "script-list-refresh");
  assert.equal(form.children.at(-1), refresh);
  assert.deepEqual(child_texts(refresh), ["刷新"]);
  const query = find_node(root, "script-filter-query-input");
  const status = find_node(root, "script-filter-status-select");
  await query.props.onInput({ target: { value: "刷新测试" } });
  await status.props.onChange({ target: { value: "enabled" } });
  let finish, calls = 0;
  fetch_handler = async url => {
    assert.match(url, /^\/admin\/api\/scripts\?limit=20&offset=0/); calls++;
    return new Promise(resolve => { finish = resolve; });
  };
  const pending = refresh.props.onClick();
  assert.equal(refresh.props.disabled.value, true);
  finish(Response.json({ scripts: [{ ...script_fixture, id: "refreshed", name: "刷新测试", enabled: true }] }));
  await pending;
  assert.equal(calls, 1);
  assert.equal(refresh.props.disabled.value, false);
  assert.equal(query.props.value.value, "刷新测试");
  assert.equal(status.props.value.value, "enabled");
  assert.deepEqual(card_names(root), ["刷新测试"]);
});

test("脚本关键词与状态筛选组合生效，包含附加路由且保持返回顺序", async t => {
  const original = fetch_handler;
  t.after(() => { fetch_handler = original; });
  const scripts = [
    { ...script_fixture, id: "new", name: "最新模块", enabled: false, created_at: 3 },
    { ...script_fixture, id: "middle", name: "中间模块", created_at: 2, routes: [
      { path: "/main", name: "中间模块" },
      { path: "/extra", name: "附加路由", url: "EXAMPLE.com", description: "附加描述" },
    ] },
    { ...script_fixture, id: "old", name: "最早模块", created_at: 1 },
  ];
  fetch_handler = async () => Response.json({ scripts });
  const root = build_page(scripts, false);
  const names = () => card_names(root);
  const query = find_node(root, "script-filter-query-input");
  const status = find_node(root, "script-filter-status-select");
  const search = value => query.props.onInput({ target: { value } });
  const select = value => status.props.onChange({ target: { value } });
  assert.deepEqual(names(), ["最新模块", "中间模块", "最早模块"]);
  for (const keyword of [" 中间模块 ", "附加路由", "/extra", " example.COM ", "附加描述", "middle"]) {
    await search(keyword);
    assert.deepEqual(names(), ["中间模块"], keyword);
  }
  await select("disabled");
  assert.deepEqual(names(), []);
  assert.deepEqual(child_texts(find_node(root, "script-list-empty")), ["没有匹配的脚本。"]);
  await search("");
  assert.deepEqual(names(), ["最新模块"]);
  await select("enabled");
  assert.deepEqual(names(), ["中间模块", "最早模块"]);
  assert.deepEqual(child_texts(find_node(root, "scripts-pagination-summary")), ["共 2 条 · 显示 1–2"]);
  assert.equal(root.props.header, undefined);
  assert.ok(root.children.includes(find_node(root, "script-page-tabs")));
  assert.ok(root.props.actions.includes(find_node(root, "script-create-button")));
  assert.equal(find_node(find_node(root, "script-page-tabs"), "script-create-button"), undefined);
  assert.equal(find_node(root, "script-list-heading-group"), undefined);
  assert.equal(find_node(root, "script-list-status"), undefined);
  await select("all");
  assert.deepEqual(names(), ["最新模块", "中间模块", "最早模块"]);
  assert.deepEqual(child_texts(find_node(root, "scripts-pagination-summary")), ["共 3 条 · 显示 1–3"]);
});

test("stub 能复现「computed 缺 map」导致的空白页故障", () => {
  // 防回归自检：若上面列表中的 computed(ref) 少传 map，这里保证构建期就报错，
  // 而不是页面静默空白。
  assert.throws(() => window.Timeless.computed(window.Timeless.ref(1)), /缺少 map 函数/);
  assert.throws(() => window.Timeless.combine({ a: window.Timeless.ref(1) }), /缺少 map 函数/);
});

async function script_frame_previews() {
  const source = readFileSync(new URL("../pages/scripts.frame", import.meta.url), "utf8")
    .replace("'./script.js'", JSON.stringify(new URL("../pages/script.js", import.meta.url).href))
    .replace("'./script.model.js'", JSON.stringify(new URL("../pages/script.model.js", import.meta.url).href))
    .replace("'./script.preview.model.js'", JSON.stringify(new URL("../pages/script.preview.model.js", import.meta.url).href))
    .replace("import { render_page } from 'admin-preview-page';", "const render_page = Page => Page();");
  return (await import("data:text/javascript," + encodeURIComponent(source)))._Preview;
}

test("脚本 Frame mock 列表支持搜索、状态和类型筛选，空状态不读取真实接口", async t => {
  const original = fetch_handler;
  fetch_handler = () => assert.fail("mock 预览不能调用真实接口");
  t.after(() => { fetch_handler = original; });
  const previews = await script_frame_previews();
  for (const path of ["/scripts/1", "/scripts/2"]) {
    const root = previews.find(item => item.path === path).render();
    const content = find_node(root, "scripts-content");
    try {
      content.props.onMounted();
      await new Promise(setImmediate);
      if (path === "/scripts/2") {
        assert.deepEqual(card_names(root), []);
        assert.ok(find_node(root, "script-list-empty"));
        continue;
      }
      assert.deepEqual(card_names(root), ["Solidot 科技资讯", "会员文章订阅", "设计周刊"]);
      assert.deepEqual(child_texts(find_node(root, "scripts-pagination-summary")), ["共 3 条 · 显示 1–3"]);
      const query = find_node(root, "script-filter-query-input");
      await query.props.onInput({ target: { value: "会员" } });
      assert.deepEqual(card_names(root), ["会员文章订阅"]);
      await query.props.onInput({ target: { value: "" } });
      await find_node(root, "script-filter-status-select").props.onChange({ target: { value: "draft" } });
      assert.deepEqual(card_names(root), ["设计周刊"]);
      await find_node(root, "script-type-tabs").props.onChange("hot");
      assert.deepEqual(card_names(root), ["今日热榜"]);
    } finally { content.props.onUnmounted(); }
  }
});

test("Cookie 授权以权限卡片和路由访问范围展示，并响应空状态和权限变化", t => {
  refarr_seeds = [];
  const model = ScriptViewModel();
  const root = ScriptPage({ store: model });
  t.after(() => find_node(root, "scripts-content").props.onUnmounted());
  const text = name => child_texts(find_node(root, name)).join("");
  assert.equal(text("script-cookie-permissions-empty"), "未申请 Cookie 权限");
  assert.equal(text("script-cookie-routes-empty"), "未声明输出路由");
  assert.equal(text("script-cookie-subscribers"), "订阅者：未声明订阅者范围");

  const permissions = { cookies: [
    { id: "session", names: ["SID", "CSRF_TOKEN"], origin: "https://example.com", path_prefix: "/articles", purpose: "读取会员文章" },
    { id: "profile", names: ["USER"], origin: "https://accounts.example.com", path_prefix: "/profile", purpose: "读取用户资料" },
  ] };
  model.state.cookie_consent.as({ open: true, busy: false, error: "", info: {
    permissions, visibility: { subscribers: "持有效访问 token 的订阅者", routes: [
      { path: "/public", public: true }, { path: "/private", public: false },
    ] },
  } });
  const cards = walk(root).filter(node => node?.props?.attributes?.n === "script-cookie-permission");
  assert.equal(cards.length, 2);
  for (const [index, card] of cards.entries()) {
    assert.equal(find_node(card, "script-cookie-permission-id"), undefined);
    for (const [name, value] of Object.entries({
      names: permissions.cookies[index].names.join("、"),
      origin: permissions.cookies[index].origin, path: permissions.cookies[index].path_prefix, purpose: permissions.cookies[index].purpose,
    })) assert.deepEqual(child_texts(find_node(card, "script-cookie-permission-" + name)), [value]);
  }
  assert.equal(find_node(root, "script-cookie-permissions-empty"), undefined);
  assert.equal(find_node(root, "script-cookie-routes-empty"), undefined);
  assert.equal(text("script-cookie-subscribers"), "订阅者：持有效访问 token 的订阅者");
  const routes = walk(root).filter(node => node?.props?.attributes?.n === "script-cookie-route");
  assert.deepEqual(routes.map(route => child_texts(find_node(route, "script-cookie-route-path"))[0]), ["/public", "/private"]);
  assert.deepEqual(routes.map(route => child_texts(find_node(route, "script-cookie-route-access"))[0]), ["公开访问（无需 token）", "持有效访问 token 的订阅者可访问"]);
  for (const section of ["script-cookie-permissions", "script-cookie-visibility"]) {
    assert.ok(walk(find_node(root, section)).every(node => node?.props?.as !== "pre"));
  }
  model.state.cookie_consent.as({ open: false, busy: false, error: "", info: null });
  assert.equal(find_node(root, "script-cookie-permission"), undefined);
  assert.equal(find_node(root, "script-cookie-route"), undefined);
  assert.ok(find_node(root, "script-cookie-permissions-empty"));
});

test("Cookie 权限 Frame 展示 mock 权限，取消和确认均可重新打开且不影响其他预览", async t => {
  const original = fetch_handler;
  fetch_handler = () => assert.fail("权限预览不能调用真实接口");
  t.after(() => { fetch_handler = original; });
  const previews = await script_frame_previews();
  const preview = previews.find(item => item.path === "/scripts/components/cookie-consent/1");
  assert.ok(preview);
  const root = preview.render();
  try {
    await new Promise(setImmediate);
    const dialog = () => find_node(root, "script-cookie-consent");
    assert.equal(dialog().props.open.value, true);
    assert.match(child_texts(find_node(root, "script-cookie-source")).join(""), /预览数据/);
    assert.match(child_texts(find_node(root, "script-cookie-permission-names")).join(""), /SID/);
    assert.match(child_texts(find_node(root, "script-cookie-route-path")).join(""), /members/);
    assert.deepEqual(child_texts(find_node(root, "script-cookie-route-access")), ["公开访问（无需 token）"]);
    assert.match(child_texts(find_node(root, "script-cookie-version")).join(""), /1\.2\.0/);
    assert.match(child_texts(find_node(root, "script-cookie-hash")).join(""), /[a-f0-9]{64}/);
    find_node(root, "script-cookie-cancel").props.onClick();
    assert.equal(dialog().props.open.value, false);
    const reopen = () => find_node(root, "preview-script-cookie-consent-open").props.onClick();
    await reopen();
    assert.equal(dialog().props.open.value, true);
    await find_node(root, "script-cookie-confirm").props.onClick();
    assert.equal(dialog().props.open.value, false);
    assert.equal(child_texts(find_node(root, "script-cookie-error")).join(""), "");
    await reopen();
    assert.equal(dialog().props.open.value, true);
    const other = preview.render();
    try {
      await new Promise(setImmediate);
      assert.equal(find_node(other, "script-cookie-consent").props.open.value, true);
      find_node(other, "script-cookie-cancel").props.onClick();
      assert.equal(dialog().props.open.value, true);
    } finally { other.props.onUnmounted(); }
  } finally { root.props.onUnmounted(); }
});

test("安装脚本 Frame 预览直接打开弹窗，关闭后可重新打开并清空输入", async t => {
  const original = fetch_handler;
  fetch_handler = () => assert.fail("安装预览不能调用真实接口");
  t.after(() => { fetch_handler = original; });
  const previews = await script_frame_previews();
  const preview = previews.find(item => item.path === "/scripts/components/install-script/1");
  assert.ok(preview);
  const root = preview.render();
  try {
    assert.equal(find_node(root, "script-install-dialog").props.title, "安装脚本");
    assert.equal(find_node(root, "script-form-dialog"), undefined);
    assert.equal(find_node(root, "script-install-input").props.value.value, "");
    await find_node(root, "script-install-parse").props.onClick();
    assert.match(child_texts(find_node(root, "script-install-error")).join(""), /请输入脚本/);
    find_node(root, "script-install-input").props.onInput({ target: { value: "https://example.com/script.js" } });
    find_node(root, "script-install-cancel").props.onClick();
    assert.equal(find_node(root, "script-install-dialog"), undefined);
    find_node(root, "preview-script-install-open").props.onClick();
    assert.ok(find_node(root, "script-install-dialog"));
    assert.equal(find_node(root, "script-install-input").props.value.value, "");
    assert.equal(child_texts(find_node(root, "script-install-error")).join(""), "");
  } finally { root.props.onUnmounted(); }
});

test("添加脚本 Frame 预览直接打开弹窗，关闭后可重新打开并清理 Model", async () => {
  const _Preview = await script_frame_previews();
  const preview = _Preview.find(item => item.path === "/scripts/components/create-script/1");
  assert.ok(preview);
  const root = preview.render();
  try {
    const dialog = find_node(root, "script-form-dialog");
    assert.equal(dialog.props.title.value, "新增脚本");
    assert.equal(find_node(dialog, "script-code-textarea").props.value.value, DEFAULT_RSS_SCRIPT);
    find_node(root, "script-form-close-button").props.onClick();
    assert.equal(find_node(root, "script-form-dialog"), undefined);
    find_node(root, "preview-script-create-open").props.onClick();
    assert.ok(find_node(root, "script-form-dialog"));
  } finally {
    root.props.onUnmounted();
  }
});

test("脚本表单默认隐藏，新增/编辑打开 Modal，关闭清空草稿", () => {
  const root = build_page({ ...script_fixture, id: "one" }, false);
  assert.equal(find_node(root, "script-form-dialog"), undefined);
  const create = find_node(root, "script-create-button");
  assert.deepEqual(child_texts(create), ["新增脚本"]);
  create.props.onClick();
  let dialog = find_node(root, "script-form-dialog");
  assert.equal(find_node(dialog, "script-cancel-button"), undefined);
  assert.equal(dialog.props.title.value, "新增脚本");
  assert.equal(find_node(dialog, "script-code-textarea").props.value.value, DEFAULT_RSS_SCRIPT);
  assert.equal(find_node(dialog, "script-debug-url").props.value.value, "/solidot");
  find_node(dialog, "script-code-textarea").props.onInput({ target: { value: "草稿" } });
  find_node(dialog, "script-form-close-button").props.onClick();
  assert.equal(dialog.props.open.value, false);
  assert.equal(find_node(root, "script-form-dialog"), undefined);
  create.props.onClick();
  assert.equal(find_node(root, "script-code-textarea").props.value.value, DEFAULT_RSS_SCRIPT);
  find_node(root, "script-form-close-button").props.onClick();
  find_node(root, "script-edit-button").props.onClick();
  dialog = find_node(root, "script-form-dialog");
  assert.equal(dialog.props.title.value, `编辑脚本：${script_fixture.name}`);
  assert.equal(find_node(dialog, "script-code-textarea").props.value.value, script_fixture.script);
});

test("编辑弹窗标题跟随当前脚本，缺失名称时显示 ID", () => {
  const root = build_page([
    { ...script_fixture, id: "one", name: "脚本一" },
    { ...script_fixture, id: "two", name: "脚本二" },
    { ...script_fixture, id: "unnamed", name: "" },
  ], false);
  for (const name of ["脚本一", "脚本二", "unnamed"]) {
    const buttons = walk(root).filter(node => node.props?.attributes?.n === "script-edit-button");
    buttons[["脚本一", "脚本二", "unnamed"].indexOf(name)].props.onClick();
    assert.equal(find_node(root, "script-form-dialog").props.title.value, `编辑脚本：${name}`);
    find_node(root, "script-form-close-button").props.onClick();
  }
});

test("Diff 按钮位于编辑表单底部左侧，无变更提示，关闭与 Escape 保留草稿", () => {
  const root = build_page({ ...script_fixture, id: "one" });
  assert.equal(find_node(root, "script-diff-button"), undefined);
  find_node(root, "script-edit-button").props.onClick();
  const form = find_node(root, "script-form-dialog");
  assert.equal(find_node(form.props.footer[0], "script-diff-button").children[0], "Diff变更");
  assert.equal(find_node(form, "script-diff-button").props.disabled.value, false);
  assert.equal(form.props.footer[1], find_node(form, "script-save-button"));
  assert.equal(form.props.footer[2], find_node(form, "script-draft-saved-at"));
  find_node(root, "script-diff-button").props.onClick();
  assert.ok(find_node(root, "script-diff-empty"));
  find_node(root, "script-diff-close-button").props.onClick();
  const input = find_node(root, "script-code-textarea");
  const changed = "// 新增说明\n" + script_fixture.script;
  input.props.onInput({ target: { value: changed } });
  find_node(root, "script-diff-button").props.onClick();
  const diff = find_node(root, "script-diff-code");
  assert.equal(diff.props.mode, "diff");
  assert.equal(diff.props.readOnly, true);
  assert.equal(applyPatch(script_fixture.script, diff.props.value.value), changed);
  find_node(root, "script-diff-dialog").props.onKeyDown({
    key: "Escape", preventDefault() {}, stopPropagation() {},
  });
  assert.equal(find_node(root, "script-diff-dialog"), undefined);
  assert.equal(input.props.value.value, changed);
  assert.equal(form.props.open.value, true);
  find_node(root, "script-diff-button").props.onClick();
  find_node(root, "script-form-close-button").props.onClick();
  assert.equal(find_node(root, "script-diff-dialog"), undefined);
});

test("左侧脚本区 Ctrl/Cmd+S 保存草稿，拦截浏览器保存且避免重复提交", async t => {
  const original = fetch_handler;
  t.after(() => { fetch_handler = original; });
  for (const modifier of ["ctrlKey", "metaKey"]) {
    const calls = [];
    let finish;
    fetch_handler = (url, options) => {
      calls.push({ url, method: options.method, body: JSON.parse(options.body) });
      return new Promise(resolve => { finish = resolve; });
    };
    const root = build_page({ ...script_fixture, id: "one" }, false);
    find_node(root, "script-edit-button").props.onClick();
    const pane = find_node(root, "script-code-pane");
    const changed = "// 草稿\n" + script_fixture.script;
    find_node(pane, "script-code-textarea").props.onInput({ target: { value: changed } });
    const event = { key: "s", [modifier]: true, defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; } };
    for (const overrides of [{ [modifier]: false }, { key: "Enter" }, { altKey: true }, { shiftKey: true }, { defaultPrevented: true }]) {
      await pane.props.onKeyDown({ ...event, ...overrides });
    }
    find_node(root, "script-diff-button").props.onClick();
    await pane.props.onKeyDown({ ...event });
    assert.equal(calls.length, 0);
    find_node(root, "script-diff-close-button").props.onClick();
    const pending = pane.props.onKeyDown(event);
    assert.equal(event.defaultPrevented, true);
    await pane.props.onKeyDown({ ...event, defaultPrevented: false });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "/admin/api/scripts/one");
    assert.equal(calls[0].method, "PATCH");
    assert.equal(calls[0].body.script, changed);
    assert.equal(calls[0].body.status, "draft");
    finish(Response.json({ script: { ...script_fixture, id: "one", script: changed, status: "draft" } }));
    await pending;
    assert.equal(find_node(root, "script-form-dialog").props.open.value, true);
    assert.equal(find_node(root, "script-code-textarea").props.value.value, changed);
  }
});

test("保存草稿成功显示 check 三秒，连续保存从最后一次成功重新计时，失败不显示成功", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const original = fetch_handler;
  t.after(() => { fetch_handler = original; });
  let fail = false;
  const script = { ...script_fixture, id: "one", status: "draft", updated_at: new Date(2026, 9, 17, 13, 4, 5).getTime() };
  fetch_handler = async (_, options = {}) => {
    if (!options.body) return Response.json({ scripts: [script] });
    if (fail) return Response.json({ error: "保存失败" }, { status: 500 });
    script.updated_at += 1000;
    return Response.json({ script });
  };
  const root = build_page(script, false);
  t.after(() => find_node(root, "scripts-content").props.onUnmounted());
  find_node(root, "script-edit-button").props.onClick();
  const save = () => find_node(root, "script-save-button").props.onClick();
  const icon = name => find_node(find_node(root, "script-save-button").props.icon, "admin-icon-" + name);
  const saved_time = () => child_texts(find_node(root, "script-draft-saved-at")).join("");
  assert.equal(saved_time(), "最近保存：2026-10-17 13:04:05");
  assert.ok(icon("save"));
  await save();
  assert.equal(saved_time(), "最近保存：2026-10-17 13:04:06");
  assert.ok(icon("check"));
  assert.equal(icon("save"), undefined);
  t.mock.timers.tick(2000);
  await save();
  t.mock.timers.tick(1000);
  assert.ok(icon("check"), "第一次保存的计时器不能提前恢复图标");
  t.mock.timers.tick(1999);
  assert.ok(icon("check"));
  t.mock.timers.tick(1);
  assert.ok(icon("save"));
  assert.equal(icon("check"), undefined);

  await save();
  assert.ok(icon("check"));
  const last_saved_time = saved_time();
  fail = true;
  await save();
  assert.equal(saved_time(), last_saved_time);
  assert.ok(icon("save"));
  assert.equal(icon("check"), undefined);
  assert.deepEqual(child_texts(find_node(root, "script-form-error")), ["保存失败"]);
});

test("关闭脚本编辑器或销毁模型清理保存反馈，旧计时器不影响重新打开后的保存", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const original = fetch_handler;
  t.after(() => { fetch_handler = original; });
  const script = { ...script_fixture, id: "one", status: "draft" };
  fetch_handler = async (_, options = {}) => Response.json(options.body ? { script } : { scripts: [script] });
  refarr_seeds = [[normalize_fixture(script)]];
  const model = ScriptViewModel();
  t.after(() => model.methods.destroy());
  model.methods.edit_script(script.id);
  await model.methods.save_script();
  assert.equal(model.state.draft_saved.value, true);
  t.mock.timers.tick(1000);
  model.methods.close_form();
  assert.equal(model.state.draft_saved.value, false);
  model.methods.edit_script(script.id);
  await model.methods.save_script();
  t.mock.timers.tick(2000);
  assert.equal(model.state.draft_saved.value, true);
  model.methods.destroy();
  assert.equal(model.state.draft_saved.value, false);
  t.mock.timers.tick(3000);
  assert.equal(model.state.draft_saved.value, false);
});

test("Diff 始终以正式源码为基准，包含已保存草稿与未保存编辑，支持空源码及换行", async () => {
  const { ScriptViewModel } = await import("../pages/script.model.js");
  for (const [saved, draft] of [
    ["", "新增\n"], ["删除\n", ""], ["const a = 1;\n", "const a = 2;\n"],
    ["无末尾换行", "无末尾换行\n"], ["甲\r\n乙\r\n", "甲\r\n丙\r\n"],
  ]) {
    const saved_draft = saved + "// 已保存的草稿";
    refarr_seeds = [[normalize_fixture({ ...script_fixture, id: "one", status: "draft", script: saved_draft, published_script: saved }),
      normalize_fixture({ ...script_fixture, id: "two", script: "另一个脚本" })], []];
    const model = ScriptViewModel();
    try {
      model.methods.edit_script("one");
      model.methods.open_diff();
      assert.equal(applyPatch(saved, model.state.diff_text.value), saved_draft);
      model.methods.close_diff();
      model.methods.set_draft("script", draft);
      model.methods.open_diff();
      assert.equal(applyPatch(saved, model.state.diff_text.value), draft);
      model.methods.edit_script("two");
      assert.equal(model.state.diff_open.value, false);
      model.methods.open_diff();
      assert.equal(model.state.diff_text.value, "");
      model.methods.reset_draft();
      model.methods.open_diff();
      assert.equal(model.state.diff_open.value, false);
      assert.equal(model.state.diff_text.value, "");
    } finally { model.methods.destroy(); }
  }
});

test("没有正式源码时禁用 Diff，即使有历史正式版本号也不能用草稿代替", () => {
  for (const published_version of ["", "1.0.0"]) {
    const script = { ...script_fixture, id: "draft-only", status: "draft", published_version };
    const root = build_page(script, false);
    find_node(root, "script-edit-button").props.onClick();
    const button = find_node(root, "script-diff-button");
    assert.equal(button.props.disabled.value, true);
    button.props.onClick();
    assert.equal(find_node(root, "script-diff-dialog"), undefined);
  }
});

test("Modal 保存期间编辑器只读而不禁用，鼠标保存不抢焦点，失败保留弹窗和错误", async (t) => {
  const original = fetch_handler;
  t.after(() => { fetch_handler = original; });
  let finish;
  fetch_handler = () => new Promise(resolve => { finish = resolve; });
  const root = build_page({ ...script_fixture, id: "one" });
  find_node(root, "script-edit-button").props.onClick();
  const dialog = find_node(root, "script-form-dialog");
  const input = find_node(dialog, "script-code-textarea");
  const save_button = find_node(dialog, "script-save-button");
  let prevented = false;
  save_button.props.onMouseDown({ button: 0, preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  const pending = save_button.props.onClick();
  assert.equal(input.props.disabled, undefined);
  assert.equal(input.props.readOnly.value, true);
  find_node(dialog, "script-form-close-button").props.onClick();
  find_node(root, "script-create-button").props.onClick();
  assert.equal(dialog.props.open.value, true);
  assert.equal(dialog.props.title.value, `编辑脚本：${script_fixture.name}`);
  assert.equal(input.props.value.value, script_fixture.script);
  finish(Response.json({ error: "保存失败" }, { status: 500 }));
  await pending;
  assert.equal(dialog.props.open.value, true);
  assert.equal(input.props.disabled, undefined);
  assert.equal(input.props.readOnly.value, false);
  assert.deepEqual(child_texts(find_node(root, "script-form-error")), ["保存失败"]);
});

test("卡片显示来源网站并隐藏描述，缺失或危险网站不生成链接", () => {
  const description = "需要能匹配 stock.xueqiu.com 的有效 .xueqiu.com Cookie。";
  const root = build_page({ ...script_fixture, url: "xueqiu.com", description }, false);
  assert.deepEqual(child_texts(find_node(root, "script-card-website-link")), ["xueqiu.com"]);
  assert.equal(find_node(root, "script-card-website-link").props.href, "https://xueqiu.com/");
  assert.equal(find_node(root, "script-card-description"), undefined);
  const identity = find_node(root, "script-card-identity");
  assert.deepEqual(identity.children.map(node => node.props.attributes?.n || node.type),
    ["script-card-metadata", "script-card-updated"]);
  assert.equal(find_node(identity, "script-card-title"), undefined);
  assert.ok(find_node(root, "admin-icon-globe"));
  assert.ok(find_node(root, "admin-icon-users"));
  assert.equal(find_node(root, "script-card-website").props.attributes["aria-label"], "来源网站");
  assert.deepEqual(child_texts(find_node(root, "script-card-maintainers-value")), ["tester"]);
  const group = find_node(root, "script-route-group");
  assert.deepEqual(group.children.map(node => node.props.attributes.n),
    ["script-route-name", "script-route-address", "script-card-example", "script-route-parameters"]);
  assert.equal(walk(root).filter(node => node.props?.attributes?.n === "script-route-group").length, 1);
  assert.deepEqual(find_node(group, "script-route-parameters").props.items,
    [{ key: "account", label: "account", value: "公众号账号" }]);
  assert.equal(find_node(find_node(root, "script-card-metadata"), "script-card-updated"), undefined);
  for (const url of ["", "javascript:alert(1)", "https://user:secret@example.com/"]) {
    const root = build_page({ ...script_fixture, url }, false);
    assert.equal(find_node(root, "script-card-website-link"), undefined);
    assert.ok(find_node(root, "script-card-website"));
  }
});

test("脚本模型与视图不再暴露 Mock 状态或测试运行入口", async () => {
  const { ScriptViewModel } = await import("../pages/script.model.js");
  const model = ScriptViewModel();
  for (const name of ["draft_mock_ctx", "mock_drawer_open", "testing", "test_result"]) assert.equal(name in model.state, false);
  for (const name of ["open_mock_drawer", "close_mock_drawer", "test_script"]) assert.equal(name in model.methods, false);
  model.methods.destroy();
  const names = node_names(build_page());
  assert.equal(names.some(name => name.includes("mock") || name === "script-test-result"), false);
});

test("消息页按钮在原页面打开共享脚本编辑器，加载关联脚本并使用原保存流程", async () => {
  refarr_seeds = [];
  const requests = [];
  let script = { ...script_fixture, id: "message-script", status: "published", version: "1.0.0" };
  fetch_handler = async (url, options = {}) => {
    requests.push({ url, method: options.method, body: options.body });
    if (options.method === "PATCH") {
      script = { ...script, ...JSON.parse(options.body) };
      return Response.json({ script });
    }
    return Response.json({ scripts: [script] });
  };
  const { messages_model: model } = await import("../pages/messages.model.js");
  const { MessagesPage } = await import("../pages/messages.js");
  model.state.rows.as([{ id: 1, route: script.id, error_text: "boom", created_at: 1 }]);
  const page = MessagesPage();
  try {
    const button = find_node(page, "admin-message-edit-script");
    assert.equal(button.type, "button");
    assert.equal(button.props.href, undefined);
    assert.equal(button.props.disabled.value, false);
    assert.equal(find_node(page, "script-form-dialog"), undefined);
    const opening = button.props.onClick();
    assert.equal(button.props.disabled.value, true);
    await model.methods.edit_script(script.id);
    await opening;
    assert.equal(requests.length, 1);
    assert.match(requests[0].url, /^\/admin\/api\/scripts(?:\?|$)/);
    assert.equal(model.editor.state.editing_id.value, script.id);
    assert.equal(model.editor.state.draft_script.value, script.script);
    assert.equal(find_node(page, "script-form-dialog").props.title.value, `编辑脚本：${script.name}`);
    for (const name of ["script-code-textarea", "script-save-button", "script-debug-url", "script-cookie-consent"])
      assert.ok(find_node(page, name), name);
    model.editor.methods.set_draft("script", "export const route = { path: '/updated' };");
    await model.editor.methods.save_script();
    assert.equal(requests[1].url, "/admin/api/scripts/message-script");
    assert.equal(requests[1].method, "PATCH");
    assert.match(JSON.parse(requests[1].body).script, /updated/);
    assert.equal(model.editor.state.form_open.value, true);
    assert.ok(find_node(page, "script-form-dialog"));
    assert.equal(model.state.rows.value.length, 1);
  } finally { model.editor.methods.destroy(); }
});

test("消息编辑脚本处理无关联、已删除和加载失败，失败后可重新打开", async () => {
  refarr_seeds = [];
  const { AdminMessagesModel } = await import("../pages/messages.model.js");
  const model = AdminMessagesModel();
  try {
    await model.methods.edit_script("");
    assert.match(model.state.error.value, /没有关联/);
    fetch_handler = async () => Response.json({ scripts: [] });
    await model.methods.edit_script("deleted");
    assert.match(model.state.error.value, /已删除或不存在/);
    assert.equal(model.editor.state.form_open.value, false);
    fetch_handler = async () => Response.json({ error: "脚本加载失败" }, { status: 500 });
    await model.methods.edit_script("message-script");
    assert.equal(model.state.error.value, "脚本加载失败");
    assert.equal(model.state.opening_script.value, false);
    fetch_handler = async () => Response.json({ scripts: [{ ...script_fixture, id: "message-script" }] });
    await model.methods.edit_script("message-script");
    assert.equal(model.state.error.value, "");
    assert.equal(model.editor.state.form_open.value, true);
    model.editor.methods.close_form();
    assert.equal(model.editor.state.form_open.value, false);
  } finally { model.editor.methods.destroy(); }
});

test("脚本管理页在空草稿与有脚本时都能构建", () => {
  assert.equal(typeof ScriptPage, "function");
  const root = build_page();
  assert.ok(root);
  const names = node_names(root);
  for (const expected of [
    "admin-shell",
    "scripts-content",
    "script-form-dialog",
    "script-code-input",
    "script-save-button",
    "script-list",
    // 卡片中的执行日志入口；日志弹窗默认关闭。
    "script-card",
    "script-card-routes",
    "script-card-route",
    "script-logs-toggle-button",
  ]) {
    assert.ok(names.includes(expected), "缺少节点 " + expected);
  }
  assert.equal(find_node(root, "script-logs-dialog"), undefined);
  assert.equal(find_node(root, "script-logs-panel"), undefined);
});

test("日志弹窗按 id 渲染摘要、params、错误全文与 ctx.log 行，卡片不展开日志", async t => {
  const original = fetch_handler;
  t.after(() => { fetch_handler = original; });
  fetch_handler = async () => Response.json({ logs: [log_fixture], has_more: false });
  const root = build_page({ ...script_fixture, id: "logs-script" }, false);
  await find_node(root, "script-logs-toggle-button").props.onClick();
  const dialog = find_node(root, "script-logs-dialog");
  assert.ok(dialog);
  assert.match(dialog.props.description.value, /微信公众号文章.*\/wxmp\/:account\?/);
  assert.ok(find_node(dialog, "script-logs-list"));
  assert.equal(find_node(find_node(root, "script-card"), "script-logs-panel"), undefined);
  assert.equal(node_names(dialog).filter(name => name === "script-log-entry").length, 1);
  assert.match(
    child_texts(find_node(root, "script-log-meta")).join(""),
    /真实请求 · error\/runtime · 12ms · 调用设备 · GET \/rss\/wxmp\/wow36kr/,
  );
  assert.match(child_texts(find_node(root, "script-log-params")).join(""), /wow36kr/);
  assert.match(
    child_texts(find_node(root, "script-log-error")).join(""),
    /at handler \(script\.js:8:3\)/,
  );
  assert.match(
    child_texts(find_node(root, "script-log-line")).join(""),
    /^\[log\] "params"/,
  );
});

test("执行日志按钮打开弹窗，关闭按钮、遮罩和 Escape 关闭后可重新打开", async t => {
  const original = fetch_handler;
  t.after(() => { fetch_handler = original; });
  const calls = [];
  fetch_handler = async url => {
    calls.push(url);
    return Response.json({ logs: [], has_more: false });
  };
  const root = build_page({ ...script_fixture, id: "logs-script" }, false);
  for (const close of [
    () => find_node(root, "script-logs-close-button").props.onClick(),
    () => find_node(root, "script-logs-dialog").props.onClose(),
    () => find_node(root, "script-logs-dialog").props.onKeyDown({ key: "Escape", preventDefault() {}, stopPropagation() {} }),
  ]) {
    const button = find_node(root, "script-logs-toggle-button");
    assert.deepEqual(child_texts(button), ["执行日志"]);
    assert.equal(button.props.attributes["aria-haspopup"], "dialog");
    assert.equal(button.props.attributes["aria-expanded"].value, false);
    await button.props.onClick();
    assert.equal(button.props.attributes["aria-expanded"].value, true);
    assert.ok(find_node(root, "script-logs-empty"));
    close();
    assert.equal(find_node(root, "script-logs-dialog"), undefined);
    assert.equal(button.props.attributes["aria-expanded"].value, false);
  }
  assert.equal(calls.length, 3);
  assert.ok(calls.every(url => url.includes("logs-script")));
});

test("日志弹窗关闭重开或切换脚本后，迟到的最新页和历史页不会覆盖当前日志", async t => {
  const original = fetch_handler;
  t.after(() => { fetch_handler = original; });
  refarr_seeds = [];
  const model = ScriptViewModel();
  t.after(() => model.methods.destroy());
  const requests = [];
  fetch_handler = url => new Promise(resolve => requests.push({ url, resolve }));
  const first = model.methods.toggle_script_logs("one");
  model.methods.close_script_logs();
  assert.equal(model.state.script_logs_loading.value, false);
  const reopened = model.methods.toggle_script_logs("one");
  assert.equal(requests.length, 2);
  requests[0].resolve(Response.json({ logs: [{ ...log_fixture, id: 10 }], has_more: false }));
  await first;
  assert.equal(model.state.script_logs_loading.value, true);
  assert.equal(model.state.script_logs.value.length, 0);
  requests[1].resolve(Response.json({ logs: [{ ...log_fixture, id: 20 }], has_more: true }));
  await reopened;
  const older = model.methods.load_older_script_logs();
  assert.match(requests[2].url, /before_id=20/);
  model.methods.close_script_logs();
  const switched = model.methods.toggle_script_logs("two");
  requests[2].resolve(Response.json({ logs: [{ ...log_fixture, id: 19 }], has_more: false }));
  await older;
  assert.equal(model.state.script_logs_loading.value, true);
  assert.equal(model.state.script_logs.value.length, 0);
  requests[3].resolve(Response.json({ logs: [{ ...log_fixture, id: 30 }], has_more: false }));
  await switched;
  assert.deepEqual(model.state.script_logs.value.map(log => log.id), [30]);
});

test("Hot/RSS 卡片保留路径和管理操作，主路由及附加路由移除复制和预览按钮", () => {
  for (const kind of ["hot", "rss"]) {
    const root = build_page({ ...script_fixture, kind, routes: [
      { ...script_fixture, route_index: 0 },
      { path: "/extra/:account", name: "附加路由", route_index: 1 },
    ] }, false);
    if (kind === "hot") find_node(root, "script-type-tabs").props.onChange("hot");
    const card = find_node(root, "script-card");
    const paths = walk(card).filter(node => node.props?.attributes?.n === "script-card-route").flatMap(child_texts);
    assert.deepEqual(paths, ["/wxmp/:account?", "/extra/:account"]);
    for (const name of ["copy-button", "copy-rss-button", "copy-atom-button", "preview-button",
      "additional-route-copy", "additional-route-copy-rss", "additional-route-copy-atom", "additional-route-preview"])
      assert.equal(find_node(card, "script-" + name), undefined, kind + ": " + name);
    assert.equal(walk(card).filter(node => node.props?.attributes?.n === "script-route-group").length, 2);
    assert.equal(walk(card).filter(node => node.props?.attributes?.n === "script-card-updated").length, 1);
    assert.ok(find_node(find_node(card, "script-card-identity"), "script-card-updated"));
    assert.deepEqual(child_texts(find_node(card, "script-edit-button")), ["编辑"]);
    assert.equal(find_node(card, "script-draft-status"), undefined);
    assert.ok(find_node(card, "script-logs-toggle-button"));
    assert.equal(find_node(root, "script-preview-dialog"), undefined);
  }
});

for (const editing of [false, true]) {
  test(`${editing ? "编辑" : "新增"}脚本移除 Mock 路由序号和实时调试控件`, () => {
    const root = build_page();
    if (editing) find_node(root, "script-edit-button").props.onClick();
    const form = find_node(root, "script-form");
    assert.equal(find_node(form, "script-api-input"), undefined);
    assert.equal(find_node(form, "script-enabled-input"), undefined);
    assert.equal(find_node(form, "script-mock-ctx-textarea"), undefined);
    assert.equal(find_node(form, "script-template-button"), undefined);
    assert.equal(find_node(form, "script-code-field").props.label, undefined);
    const dialog = find_node(root, "script-form-dialog");
    assert.equal(dialog.props.description, undefined);
    for (const name of ["script-code-hint", "script-source-hint", "script-test-button", "script-mock-open-button", "script-debug-hint", "script-debug-empty"])
      assert.equal(find_node(dialog, name), undefined, name);
    assert.equal(find_node(dialog, "script-test-route-index"), undefined);
    assert.equal(find_node(dialog, "script-test-route-index-field"), undefined);
    assert.ok(find_node(form, "script-agent-pane"));
    assert.ok(find_node(form, "script-debug-pane"));
    for (const name of ["script-debug-actions", "script-live-debug", "script-live-debug-help", "script-draft-debug"])
      assert.equal(find_node(dialog, name), undefined, name);
    assert.equal(find_node(form, "script-debug-url-field"), undefined);
    assert.equal(walk(form).filter(node => node.props?.attributes?.n === "script-debug-route-row").length, 1);
    assert.equal(find_node(root, "tooltip-host"), undefined);
  });
}



test("卡片和表单没有 Debug 开关，新建默认关闭，编辑保留已有配置", async (t) => {
  const original = fetch_handler;
  t.after(() => { fetch_handler = original; });
  const calls = [];
  fetch_handler = async (url, options) => {
    const body = JSON.parse(options.body);
    calls.push({ url, body });
    return Response.json({ script: { ...script_fixture, debug: body.debug } });
  };
  for (const editing of [false, true]) {
    const root = build_page({ ...script_fixture, id: "script-debug-config", debug: true });
    if (editing) find_node(root, "script-edit-button").props.onClick();
    assert.equal(find_node(root, "script-debug"), undefined);
    assert.equal(find_node(root, "script-draft-debug"), undefined);
    await find_node(root, "script-save-button").props.onClick();
    assert.equal(calls.at(-1).body.debug, editing);
  }
});

test("脚本卡片和编辑器均不显示 Switch", () => {
  const root = build_page(script_fixture, false);
  const release = find_node(root, "script-card-release");
  assert.equal(find_node(release, "script-enabled"), undefined);
  assert.equal(walk(find_node(root, "script-card")).some(node => node.type === "switch"), false);
  assert.equal(find_node(root, "script-toggle-button"), undefined);
  find_node(root, "script-create-button").props.onClick();
  assert.equal(walk(find_node(root, "script-form-dialog")).some(node => node.type === "switch"), false);
});

test("路由参数使用 TableField，以 key/value 列对齐并保持每条路由独立", () => {
  const parameters = { id: "短键", long_parameter_name: "长键和较长的说明" };
  const root = build_page({ ...script_fixture, parameters }, false);
  const table = find_node(root, "script-route-parameters");
  assert.equal(table.type, "field-table");
  assert.deepEqual(table.props.items, [
    { key: "id", label: "id", value: "短键" },
    { key: "long_parameter_name", label: "long_parameter_name", value: "长键和较长的说明" },
  ]);
});

for (const editing of [false, true]) {
  test(`${editing ? "编辑" : "新增"}脚本保存草稿后保持弹窗和内容，连续保存更新同一脚本`, async (t) => {
    const original_fetch_handler = fetch_handler;
    t.after(() => { fetch_handler = original_fetch_handler; });
    const requests = [];
    const scripts = [{ ...script_fixture, id: "existing-script" }];
    fetch_handler = async (url, options) => {
      if (!options.body) return Response.json({ scripts });
      requests.push({ url, method: options.method, body: JSON.parse(options.body) });
      const id = options.method === "PATCH" ? url.split("/").at(-1) : "saved-script";
      const script = { ...script_fixture, ...requests.at(-1).body, id };
      const index = scripts.findIndex(item => item.id === id);
      if (index < 0) scripts.unshift(script); else scripts[index] = script;
      return Response.json({ script });
    };
    const root = build_page({ ...script_fixture, id: "existing-script" });
    if (editing) find_node(root, "script-edit-button").props.onClick();
    const script_input = find_node(root, "script-code-textarea");
    script_input.props.onInput({ target: { value: script_fixture.script } });
    const save_button = find_node(root, "script-save-button");
    const dialog = find_node(root, "script-form-dialog");
    await save_button.props.onClick();

    assert.equal(requests[0].method, editing ? "PATCH" : "POST");
    assert.equal(requests[0].body.enabled, true);
    assert.equal(requests[0].body.status, "draft");
    assert.equal(script_input.props.value.value, script_fixture.script);
    assert.equal(dialog.props.open.value, true);
    assert.equal(dialog.props.title.value, `编辑脚本：${script_fixture.name}`);
    assert.match(child_texts(find_node(root, "script-form-status")).join(""), /已保存/);
    assert.deepEqual(child_texts(find_node(root, "scripts-pagination-summary")), [editing ? "共 1 条 · 显示 1–1" : "共 2 条 · 显示 1–2"]);
    assert.equal(save_button.props.disabled.value, undefined);

    const changed = "export const route = { path: '/next' };";
    find_node(root, "script-code-textarea").props.onInput({ target: { value: changed } });
    await find_node(root, "script-save-button").props.onClick();
    assert.equal(requests[1].url, "/admin/api/scripts/" + (editing ? "existing-script" : "saved-script"));
    assert.equal(requests[1].method, "PATCH");
    assert.equal(requests[1].body.script, changed);
    assert.equal(find_node(root, "script-form-dialog").props.open.value, true);
    assert.equal(find_node(root, "script-code-textarea").props.value.value, changed);

    find_node(root, "script-form-close-button").props.onClick();
    assert.equal(find_node(root, "script-form-dialog"), undefined);
    find_node(root, "script-create-button").props.onClick();
    find_node(root, "script-code-textarea").props.onInput({ target: { value: changed } });
    await save_button.props.onClick();
    assert.equal(requests[2].url, "/admin/api/scripts");
    assert.equal(requests[2].method, "POST");
    assert.equal(requests[2].body.enabled, true);
  });
}

test("脚本保存失败保留脚本草稿", async (t) => {
  const original_fetch_handler = fetch_handler;
  t.after(() => { fetch_handler = original_fetch_handler; });
  fetch_handler = async () => new Response(JSON.stringify({ error: "保存失败" }), { status: 500 });
  const root = build_page();
  const script_input = find_node(root, "script-code-textarea");
  script_input.props.onInput({ target: { value: script_fixture.script } });
  const save_button = find_node(root, "script-save-button");
  await save_button.props.onClick();

  assert.equal(script_input.props.value.value, script_fixture.script);
  assert.equal(save_button.props.disabled.value, undefined);
  assert.equal(child_texts(find_node(root, "script-form-status")).join(""), "");
});

test("发布按钮提交正式状态，列表退回草稿失败保留正式状态，重试后可按草稿筛选", async t => {
  const original = fetch_handler;
  t.after(() => { fetch_handler = original; });
  const requests = [];
  let fail = false, saved_script;
  fetch_handler = async (url, options) => {
    if (!options.body) return Response.json({ scripts: saved_script ? [saved_script] : [] });
    const body = JSON.parse(options.body);
    requests.push({ url, body });
    if (!fail) saved_script = { ...script_fixture, id: "saved-script", status: body.status, version: body.version || "1.0.0" };
    return fail ? Response.json({ error: "状态更新失败" }, { status: 500 })
      : Response.json({ script: { ...script_fixture, id: "saved-script", status: body.status, version: body.version || "1.0.0" } });
  };
  const root = build_page({ ...script_fixture, id: "original" });
  find_node(root, "script-version-input").props.onInput({ target: { value: "1.0.0" } });
  await find_node(root, "script-publish-button").props.onClick();
  assert.equal(requests[0].body.status, "published");
  assert.equal(requests[0].body.version, "1.0.0");
  await find_node(root, "script-filter-query-input").props.onInput({ target: { value: "saved-script" } });
  assert.deepEqual(child_texts(find_node(root, "script-status")), ["1.0.0"]);
  assert.deepEqual(child_texts(find_node(root, "script-status-button")), ["退回草稿"]);
  assert.equal(find_node(root, "script-status-button").props.onClick, undefined);
  assert.equal(requests.length, 1, "未确认时不提交退回请求");
  assert.match(find_node(root, "script-status-confirmation").props.title, /所有正式路由将停止服务/);
  fail = true;
  await find_node(root, "script-status-confirmation").props.onConfirm();
  assert.equal(requests.at(-1).body.status, "draft");
  assert.deepEqual(child_texts(find_node(root, "script-status")), ["1.0.0"]);
  assert.equal(find_node(root, "script-status-button").props.disabled.value, undefined);
  fail = false;
  await find_node(root, "script-status-confirmation").props.onConfirm();
  assert.deepEqual(child_texts(find_node(root, "script-status")), ["草稿"]);
  assert.equal(find_node(root, "script-status-button"), undefined);
  await find_node(root, "script-filter-status-select").props.onChange({ target: { value: "published" } });
  assert.equal(find_node(root, "script-card"), undefined);
  await find_node(root, "script-filter-status-select").props.onChange({ target: { value: "draft" } });
  assert.ok(find_node(root, "script-card"));
});

test("已有草稿时退回需确认覆盖，取消不提交，失败保留草稿，确认后用正式源码替换草稿", async t => {
  const original_fetch = fetch_handler, original_confirm = window.confirm;
  t.after(() => { fetch_handler = original_fetch; window.confirm = original_confirm; });
  let script = { ...script_fixture, id: "overwrite-draft", status: "published", version: "1.0.0",
    draft: { script: "// 未发布草稿", version: "1.0.1", kind: "rss", enabled: true, debug: false } };
  const requests = [];
  let finish;
  window.confirm = () => { assert.fail("退回草稿不应调用原生确认框"); };
  fetch_handler = (url, options = {}) => {
    if (!options.body) return Promise.resolve(Response.json({ scripts: [script] }));
    requests.push({ url, body: JSON.parse(options.body) });
    return new Promise(resolve => { finish = resolve; });
  };
  const root = build_page(script, false);
  t.after(() => find_node(root, "scripts-content").props.onUnmounted());
  const withdraw = find_node(root, "script-status-button");
  const confirmation = find_node(root, "script-status-confirmation");
  assert.equal(withdraw.props.onClick, undefined);
  assert.equal(requests.length, 0);
  assert.match(confirmation.props.title, /覆盖草稿/);
  assert.match(confirmation.props.title, /未发布的修改将丢失/);
  assert.match(confirmation.props.title, /停止服务/);
  assert.ok(find_node(root, "script-draft-status"));
  assert.deepEqual(child_texts(find_node(root, "script-status")), ["1.0.0"]);

  const failed = confirmation.props.onConfirm();
  await confirmation.props.onConfirm();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].body.overwrite_draft, true);
  assert.equal(requests[0].body.status, "draft");
  assert.equal(requests[0].body.script, undefined, "通过状态操作退回正式源码");
  finish(Response.json({ error: "保存失败" }, { status: 500 }));
  await failed;
  assert.ok(find_node(root, "script-draft-status"));
  assert.equal(withdraw.props.disabled.value, undefined);

  const saved = confirmation.props.onConfirm();
  script = { ...script, status: "draft" };
  delete script.draft;
  finish(Response.json({ script }));
  await saved;
  assert.equal(find_node(root, "script-draft-status"), undefined);
  assert.equal(find_node(root, "script-status-button"), undefined);
  find_node(root, "script-edit-button").props.onClick();
  assert.equal(find_node(root, "script-code-textarea").props.value.value, script_fixture.script);
});

test("发布必填版本，正式标签只展示版本并保留哈希提示，草稿不显示版本；发布失败保留草稿", async t => {
  const original = fetch_handler;
  t.after(() => { fetch_handler = original; });
  const calls = [];
  let fail = false;
  fetch_handler = async (url, options) => {
    const body = JSON.parse(options.body);
    calls.push({ url, body });
    return fail ? Response.json({ error: "版本号必须高于上次正式版本 1.0.0" }, { status: 409 })
      : Response.json({ script: { ...script_fixture, id: "versioned", status: body.status,
        version: body.version, published_version: body.version, script_hash: "abc123" } });
  };
  const root = build_page({ ...script_fixture, id: "versioned", status: "draft", version: "1.0.0", script_hash: "abc123" }, false);
  t.after(() => find_node(root, "scripts-content").props.onUnmounted());
  assert.equal(find_node(root, "script-card-version"), undefined);
  assert.deepEqual(child_texts(find_node(root, "script-status")), ["草稿"]);
  assert.deepEqual(find_node(root, "script-card-release").children.map(node => node.props.attributes.n),
    ["script-status"]);
  assert.equal(find_node(root, "script-status-button"), undefined);
  find_node(root, "script-edit-button").props.onClick();
  assert.equal(calls.length, 0);
  let input = find_node(root, "script-version-input");
  assert.equal(input.props.value.value, "1.0.0");
  input.props.onInput({ target: { value: "" } });
  await find_node(root, "script-publish-button").props.onClick();
  assert.equal(calls.length, 0);
  assert.match(child_texts(find_node(root, "script-form-error")).join(""), /必须指定版本号/);
  input.props.onInput({ target: { value: "1.0.1" } });
  fail = true;
  await find_node(root, "script-publish-button").props.onClick();
  assert.equal(input.props.value.value, "1.0.1");
  assert.equal(find_node(root, "script-form-dialog").props.open.value, true);
  fail = false;
  await find_node(root, "script-publish-button").props.onClick();
  assert.equal(calls.at(-1).body.version, "1.0.1");
  assert.equal(find_node(root, "script-form-dialog"), undefined);
  assert.deepEqual(child_texts(find_node(root, "script-status")), ["1.0.1"]);
  assert.equal(find_node(root, "script-status").props.attributes.title, "源码 SHA-256：abc123");
  find_node(root, "script-create-button").props.onClick();
  assert.equal(find_node(root, "script-version-input").props.value.value, "");
});

test("填写版本号不触发实时调试或 Cookie 确认，点击发布才确认新版本并继续发布", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const original = fetch_handler;
  t.after(() => { fetch_handler = original; });
  const calls = [];
  fetch_handler = async (url, options) => {
    const body = JSON.parse(options.body);
    calls.push({ url, body });
    if (url.endsWith("/cookie-grants")) {
      return Response.json({ cookie_grant_id: body.version ? "publish-grant" : "debug-grant" });
    }
    if (url.endsWith("/debug") && body.cookie_grant_id === "debug-grant") {
      return Response.json({ ok: true, status: 200, rss_debug: { output: "{}" } });
    }
    if (url === "/admin/api/scripts" && body.cookie_grant_id === "publish-grant") {
      return Response.json({ script: { ...script_fixture, id: "published", status: "published", version: body.version } });
    }
    return Response.json({ error: "需要确认", cookie_permissions: {
      version: body.version, script_id: "", script_hash: "same-hash", permissions: { cookies: [] }, visibility: {},
    } }, { status: 409 });
  };
  const root = build_page();
  t.after(() => find_node(root, "scripts-content").props.onUnmounted());
  await find_node(root, "script-debug-run-button").props.onClick();
  await find_node(root, "script-cookie-confirm").props.onClick();
  assert.equal(calls.length, 3);
  assert.equal(calls[0].body.version, "");
  assert.equal(find_node(root, "script-cookie-consent").props.open.value, false);

  // 修改调试地址和版本号后保持手动调试，不自动发出请求。
  find_node(root, "script-debug-url").props.onInput({ target: { value: "/solidot?limit=5" } });
  const input = find_node(root, "script-version-input");
  for (const value of ["1", "1.0", "1.0.0"]) {
    input.props.onInput({ target: { value } });
    t.mock.timers.tick(1000);
    await new Promise(setImmediate);
    assert.equal(calls.length, 3, "填写版本号不发送调试或授权请求");
    assert.equal(find_node(root, "script-cookie-consent").props.open.value, false);
  }

  await find_node(root, "script-publish-button").props.onClick();
  assert.equal(calls[3].url, "/admin/api/scripts");
  assert.equal(calls[3].body.version, "1.0.0");
  assert.equal(calls[3].body.cookie_grant_id, "", "发布不能复用空版本的调试授权");
  assert.equal(find_node(root, "script-cookie-consent").props.open.value, true);
  await find_node(root, "script-cookie-confirm").props.onClick();
  assert.equal(calls[4].url, "/admin/api/scripts/cookie-grants");
  assert.equal(calls[4].body.version, "1.0.0");
  assert.equal(calls[5].url, "/admin/api/scripts");
  assert.equal(calls[5].body.cookie_grant_id, "publish-grant");
  assert.equal(find_node(root, "script-form-dialog"), undefined);
});

test("填写版本号取消进行中的调试，迟到的 Cookie 确认不弹窗也不补跑", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const original = fetch_handler;
  t.after(() => { fetch_handler = original; });
  const calls = [];
  let finish, signal;
  fetch_handler = (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    signal = options.signal;
    return new Promise(resolve => { finish = resolve; });
  };
  const root = build_page();
  t.after(() => find_node(root, "scripts-content").props.onUnmounted());
  const pending = find_node(root, "script-debug-run-button").props.onClick();
  find_node(root, "script-version-input").props.onInput({ target: { value: "1.0.0" } });
  assert.equal(signal.aborted, true);
  finish(Response.json({ error: "需要确认", cookie_permissions: { version: "" } }, { status: 409 }));
  await pending;
  t.mock.timers.tick(1000);
  await new Promise(setImmediate);
  assert.equal(calls.length, 1);
  assert.equal(find_node(root, "script-cookie-consent").props.open.value, false);
  assert.equal(find_node(root, "script-debug-run-button").props.disabled.value, undefined);
});

test("主动调试仍检查当前版本的 Cookie 授权，版本变化后不能提交旧确认", async t => {
  const original = fetch_handler;
  t.after(() => { fetch_handler = original; });
  const calls = [];
  fetch_handler = async (url, options) => {
    const body = JSON.parse(options.body);
    calls.push({ url, body });
    return Response.json({ error: "需要确认", cookie_permissions: {
      version: body.version, script_id: "", script_hash: "same-hash", permissions: { cookies: [] }, visibility: {},
    } }, { status: 409 });
  };
  const root = build_page();
  t.after(() => find_node(root, "scripts-content").props.onUnmounted());
  const input = find_node(root, "script-version-input");
  input.props.onInput({ target: { value: "1.0.0" } });
  await find_node(root, "script-debug-run-button").props.onClick();
  assert.equal(calls[0].body.version, "1.0.0");
  assert.deepEqual(child_texts(find_node(root, "script-cookie-version")), ["版本：1.0.0"]);
  input.props.onInput({ target: { value: "1.0.1" } });
  await find_node(root, "script-cookie-confirm").props.onClick();
  assert.equal(calls.length, 1, "版本变化后不提交旧确认");
  assert.match(child_texts(find_node(root, "script-cookie-error")).join(""), /版本号已变化/);
});

test("卡片区分旧授权 ID 和有效授权，重新确认脚本权限不打开编辑器或发布新版本", async t => {
  const original = fetch_handler;
  t.after(() => { fetch_handler = original; });
  const calls = [];
  const script = { ...script_fixture, id: "cookie-script", version: "1.0.0", cookie_grant_id: "old-grant",
    cookie_authorization: { status: "required", message: "此脚本版本需要管理员确认 Cookie 权限" } };
  const info = { version: "1.0.0", script_id: script.id, script_hash: "source-hash",
    permissions: { cookies: [{ id: "session", names: ["SUB"], origin: "https://example.com", path_prefix: "/", purpose: "读取内容" }] },
    visibility: { routes: [], subscribers: "持有效访问 token 的订阅者" } };
  fetch_handler = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith("/cookie-permissions")) return Response.json({ error: "需要确认", cookie_permissions: info }, { status: 409 });
    if (url.endsWith("/cookie-grants")) return Response.json({ cookie_grant_id: "new-grant" });
    return Response.json({ scripts: [{ ...script, cookie_grant_id: "new-grant", cookie_authorization: { status: "active", message: "" } }] });
  };
  const root = build_page(script, false);
  assert.deepEqual(child_texts(find_node(root, "script-cookie-status")), ["Cookie 需要重新确认"]);
  assert.ok(find_node(root, "script-cookie-revoke"));
  assert.equal(find_node(root, "script-cookie-revoke").props.onClick, undefined);
  assert.match(find_node(root, "script-cookie-revoke-confirmation").props.title, /撤销脚本.*Cookie 授权.*无法使用这些 Cookie/);
  assert.equal(calls.length, 0, "未确认撤销时不提交请求");
  await find_node(root, "script-cookie-check").props.onClick();
  assert.equal(find_node(root, "script-form-dialog"), undefined);
  assert.deepEqual(child_texts(find_node(root, "script-cookie-version")), ["版本：1.0.0"]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/admin/api/scripts/cookie-script/cookie-permissions");
  await find_node(root, "script-cookie-confirm").props.onClick();
  assert.equal(JSON.parse(calls[1].options.body).version, "1.0.0");
  assert.equal(JSON.parse(calls[1].options.body).confirmed, true);
  assert.deepEqual(child_texts(find_node(root, "script-cookie-status")), ["Cookie 已授权"]);
  assert.equal(find_node(root, "script-cookie-check"), undefined);
  assert.equal(calls.some(call => call.options?.method === "PATCH"), false);
  await find_node(root, "script-cookie-revoke-confirmation").props.onConfirm();
  assert.equal(calls.filter(call => call.options?.method === "DELETE").length, 1);
  assert.deepEqual(child_texts(find_node(root, "script-cookie-status")), ["Cookie 需要重新确认"]);
});

test("多路由卡片展示附加图片地址，footer 不显示 Mock 路由序号", () => {
  const primary = { ...script_fixture, route_index: 0 };
  const proxy = { public: true, path: "/wxmpimgproxy", name: "公众号图片", example: "/wxmpimgproxy?url=x", parameters: { url: "图片原地址" }, route_index: 1 };
  const root = build_page({ ...script_fixture, routes: [primary, proxy] });
  assert.ok(walk(root).filter(node => node.props?.attributes?.n === "script-card-route")
    .some(node => child_texts(node).join("") === "/wxmpimgproxy"));
  assert.ok(walk(root).filter(node => node.props?.attributes?.n === "script-route-name")
    .some(node => child_texts(node).join("") === "公众号图片"));
  assert.equal(find_node(root, "script-additional-route-copy"), undefined);
  const groups = walk(root).filter(node => node.props?.attributes?.n === "script-route-group");
  assert.deepEqual(groups.map(group => find_node(group, "script-route-parameters").props.items.map(item => item.key)), [["account"], ["url"]]);
  assert.deepEqual(groups.map(group => child_texts(find_node(group, "script-card-example"))),
    [["示例 /wxmp/wow36kr"], ["示例 /wxmpimgproxy?url=x"]]);
  assert.equal(find_node(root, "script-test-route-index"), undefined);
});
