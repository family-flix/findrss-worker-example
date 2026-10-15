import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
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
    fetch: (url, options) => (url === "/admin/api/scripts/routes" ? routes_handler : fetch_handler)(url, options),
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
    For({ each, render }) {
      const node = create_element("view", {}, []);
      Object.defineProperty(node, "children", { get() {
        const items = each && each.__is_ref ? each.value : each;
        return (items || []).map((item) => render(item));
      } });
      return node;
    },
    Show({ when, ok, fail }) {
      const node = create_element("show", {}, []);
      Object.defineProperty(node, "children", { get() {
        const value = when && when.__is_ref ? when.value : when;
        return value ? [ok()] : fail ? [fail()] : [];
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
  // 空 id 让日志区默认处于展开态（script_logs_route 初值为空串），
  // 这样静态 stub 也能覆盖面板内的节点。
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
window.FindRSSAdminUI.Dialog = (props, children) => create_element("dialog", props, [...children, ...(props.footer || [])]);
window.FindRSSAdminUI.Tabs = (props) => create_element("tabs", props, props.items.flatMap(item => item.content));
window.FindRSSAdminUI.CopyButton = (props) => create_element("button", props, []);
window.FindRSSAdminUI.Switch = (props) => create_element("switch", props, []);
window.FindRSSAdminUI.TableField = (props) => create_element("field-table", props, []);
window.FindRSSAdminUI.Tooltip = (props, children) => create_element("tooltip", props, children);
window.FindRSSAdminUI.TooltipHost = () => create_element("tooltip-host", {}, []);
window.FindRSSAdminUI.Icon = (name) => create_element("svg", { attributes: { n: "admin-icon-" + name } }, []);
window.FindRSSAdminUI.Img = (props) => create_element("img", props, []);
window.FindRSSAdminUI.Field = (props, children) => create_element("view", props, children);
window.FindRSSAdminUI.PageHeader = (props) => create_element("view", props, [create_element("h1", { attributes: props.title_attributes }, [props.title])]);

const { ScriptPage } = await import("../pages/script.js");
const { normalize_script: normalize_fixture } = await import("../pages/script.model.js");

/** 每次构建都重置 refarr 预置数据（ViewModel 是每次调用新建的）。 */
function build_page(script = script_fixture, open = true) {
  refarr_seeds = [(Array.isArray(script) ? script : [script]).map(normalize_fixture), [log_fixture]];
  const root = ScriptPage();
  if (open) find_node(root, "script-create-button").props.onClick();
  return root;
}

test("多位维护者显示昵称、头像和安全链接，保留旧字符串并屏蔽非法 URL", () => {
  const root = build_page({ ...script_fixture, platform: "zhihu", maintainers: [
    { nickname: "甲", url: "https://example.com/author", avatar: "https://example.com/avatar.png" },
    { nickname: "乙", url: "javascript:alert(1)", avatar: "data:image/svg+xml,bad" }, "旧维护者",
  ] }, false);
  assert.equal(find_node(root, "script-maintainer-link").props.href, "https://example.com/author");
  assert.equal(find_node(root, "script-maintainer-avatar").props.src, "https://example.com/avatar.png");
  assert.deepEqual(child_texts(find_node(root, "script-maintainer-nickname")), ["乙"]);
  assert.ok(child_texts(find_node(root, "script-card-maintainers-value")).includes("旧维护者"));
  assert.deepEqual(child_texts(find_node(root, "script-card-platform")), ["知乎"]);
});

test("RSS/Hot Tabs 按 RSS 优先排序，各自筛选列表与计数，新增沿用当前类型", () => {
  const root = build_page([
    { ...script_fixture, id: "rss-one", name: "RSS 一", kind: "rss", script_type: "hot" },
    { ...script_fixture, id: "rss-two", name: "RSS 二", kind: "rss", enabled: false },
    { ...script_fixture, id: "hot-one", name: "热榜一", kind: "hot", script_type: "rss" },
  ], false);
  const tabs = find_node(root, "script-type-tabs");
  assert.deepEqual(tabs.props.items.map(({ id, label }) => [id, label]), [["rss", "RSS"], ["hot", "Hot"]]);
  assert.equal(root.props.title, "脚本管理");
  const titles = () => walk(root).filter(node => node.props?.attributes?.n === "script-card-title").flatMap(child_texts);
  assert.deepEqual(titles(), ["RSS 一", "RSS 二"]);
  find_node(root, "script-filter-query-input").props.onInput({ target: { value: "RSS 一" } });
  assert.deepEqual(titles(), ["RSS 一"]);
  assert.equal(child_texts(find_node(root, "script-type-count")).join(""), "1 / 2");
  tabs.props.onChange("hot");
  assert.deepEqual(titles(), ["热榜一"]);
  assert.equal(find_node(root, "script-filter-query-input").props.value.value, "");
  assert.equal(find_node(root, "script-copy-rss-button"), undefined);
  assert.equal(find_node(root, "script-preview-button"), undefined);
  assert.equal(find_node(root, "script-copy-button"), undefined);
  find_node(root, "script-create-button").props.onClick();
  assert.equal(find_node(root, "script-code-textarea").props.value.value, DEFAULT_HOT_SCRIPT);
  assert.equal(find_node(root, "script-debug-url").props.value.value, "/baidu/hot");
  find_node(root, "script-cancel-button").props.onClick();
  tabs.props.onChange("rss");
  assert.deepEqual(titles(), ["RSS 一", "RSS 二"]);
  assert.equal(find_node(root, "script-copy-rss-button"), undefined);
  find_node(root, "script-filter-status-select").props.onChange({ target: { value: "disabled" } });
  assert.deepEqual(titles(), ["RSS 二"]);
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
    [["output", "输出"], ["context", "上下文"], ["logs", "日志"]]);
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

for (const editing of [false, true]) {
  test(`${editing ? "编辑" : "新增"}起点多路由逐行调试，草稿重新编译保留各自输入并同步路由增删`, async t => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const old_fetch = fetch_handler, old_routes = routes_handler;
    t.after(() => { fetch_handler = old_fetch; routes_handler = old_routes; });
    let routes = [
      { path: "/qidian/book/:book_id", name: "章节列表", example: "/qidian/book/1036526469" },
      { path: "/qidian/chapter/:book_id/:chapter_id", name: "正文", example: "/qidian/chapter/1036526469/745825165" },
    ];
    const source = readFileSync(new URL("../../examples/scripts/rss/qidian_chapters.js", import.meta.url), "utf8");
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
    find_node(root, editing ? "script-edit-button" : "script-create-button").props.onClick();
    const code = find_node(root, "script-code-textarea");
    if (!editing) code.props.onInput({ target: { value: source } });
    t.mock.timers.tick(400);
    await new Promise(setImmediate);
    assert.equal(rows().length, 2);
    assert.deepEqual(rows().map(row => find_node(row, "script-debug-url").props.value.value),
      routes.map(route => route.example));
    assert.equal(find_node(root, "script-debug-url-field"), undefined);
    for (const row of rows()) assert.deepEqual(row.children.map(node => node.props.attributes.n),
      ["script-debug-url", "script-debug-run-button"]);
    const input = find_node(rows()[1], "script-debug-url");
    input.props.onInput({ target: { value: "/qidian/chapter/123/456?full=1" } });
    await find_node(rows()[0], "script-debug-run-button").props.onClick();
    await find_node(rows()[1], "script-debug-run-button").props.onClick();
    assert.deepEqual(requests.map(body => body.request_url), [
      "/debug/qidian/book/1036526469", "/debug/qidian/chapter/123/456?full=1",
    ]);
    assert.ok(requests.every(body => body.script === source && body.route === (editing ? "qidian" : "")));
    find_node(root, "script-live-debug").props.onChange(true);
    t.mock.timers.tick(800);
    await new Promise(setImmediate);
    assert.equal(requests.length, 3);
    assert.equal(requests[2].request_url, "/debug/qidian/chapter/123/456?full=1", "实时调试跟随当前路由");
    find_node(root, "script-live-debug").props.onChange(false);
    routes = [routes[1], { path: "/qidian/latest", name: "最新", example: "/qidian/latest" }];
    code.props.onInput({ target: { value: source } });
    t.mock.timers.tick(400);
    await new Promise(setImmediate);
    assert.equal(rows().length, 2);
    assert.deepEqual(rows().map(row => find_node(row, "script-debug-url").props.value.value),
      ["/qidian/chapter/123/456?full=1", "/qidian/latest"]);
    input.props.onInput({ target: { value: "" } });
    code.props.onInput({ target: { value: source } });
    t.mock.timers.tick(400);
    await new Promise(setImmediate);
    assert.equal(find_node(rows()[0], "script-debug-url").props.value.value, "");
    assert.equal(find_node(rows()[0], "script-debug-run-button").props.disabled.value, true);
  });
}

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
  assert.equal(code.props.disabled.value, false);
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
  find_node(root, "script-live-debug").props.onChange(false);
  find_node(root, "script-code-textarea").props.onInput({ target: { value: "旧代码" } });
  find_node(root, "script-debug-url").props.onInput({ target: { value: "/debug/sample/a" } });
  const run = find_node(root, "script-debug-run-button");
  let pending = run.props.onClick();
  assert.equal(run.props.disabled.value, true);
  assert.equal(find_node(root, "script-code-textarea").props.disabled.value, false);
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
  const root = build_page();
  const edit = value => find_node(root, "script-code-textarea").props.onInput({ target: { value } });
  edit("初始草稿");
  find_node(root, "script-debug-url").props.onInput({ target: { value: "/debug/sample/a" } });
  t.mock.timers.tick(1000);
  assert.equal(calls.length, 0, "首次调试须点击运行");
  const pending = find_node(root, "script-debug-run-button").props.onClick();
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
  find_node(root, "script-form-close-button").props.onClick();
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
  assert.match(child_texts(find_node(root, "script-cookie-permissions")).join(""), /SUB/);
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

function find_node(root, semantic_name) {
  return walk(root).find((node) => node?.props?.attributes?.n === semantic_name);
}

/** 取节点的文本子节点：Timeless 允许直接挂 ref，真实渲染时才求值。 */
function child_texts(node) {
  return (node.children || []).map((child) => (child && child.__is_ref ? child.value : child));
}

test("脚本关键词与状态筛选组合生效，包含附加路由且保持返回顺序", () => {
  const root = build_page([
    { ...script_fixture, id: "new", name: "最新模块", enabled: false, created_at: 3 },
    { ...script_fixture, id: "middle", name: "中间模块", created_at: 2, routes: [
      { path: "/main", name: "中间模块" },
      { path: "/extra", name: "附加路由", url: "EXAMPLE.com", description: "附加描述" },
    ] },
    { ...script_fixture, id: "old", name: "最早模块", created_at: 1 },
  ], false);
  const titles = () => walk(root).filter(node => node.props?.attributes?.n === "script-card-title")
    .map(node => child_texts(node).join(""));
  const query = find_node(root, "script-filter-query-input");
  const status = find_node(root, "script-filter-status-select");
  const search = value => query.props.onInput({ target: { value } });
  const select = value => status.props.onChange({ target: { value } });
  assert.deepEqual(titles(), ["最新模块", "中间模块", "最早模块"]);
  for (const keyword of [" 中间模块 ", "附加路由", "/extra", " example.COM ", "附加描述", "middle"]) {
    search(keyword);
    assert.deepEqual(titles(), ["中间模块"], keyword);
  }
  select("disabled");
  assert.deepEqual(titles(), []);
  assert.deepEqual(child_texts(find_node(root, "script-list-empty")), ["没有匹配的脚本。"]);
  search("");
  assert.deepEqual(titles(), ["最新模块"]);
  select("enabled");
  assert.deepEqual(titles(), ["中间模块", "最早模块"]);
  assert.equal(root.props.count.value, "2 / 3");
  assert.equal(find_node(root, "script-list-heading-group"), undefined);
  assert.equal(find_node(root, "script-list-status"), undefined);
  select("all");
  assert.deepEqual(titles(), ["最新模块", "中间模块", "最早模块"]);
  assert.equal(root.props.count.value, "3");
});

test("stub 能复现「computed 缺 map」导致的空白页故障", () => {
  // 防回归自检：若上面列表中的 computed(ref) 少传 map，这里保证构建期就报错，
  // 而不是页面静默空白。
  assert.throws(() => window.Timeless.computed(window.Timeless.ref(1)), /缺少 map 函数/);
  assert.throws(() => window.Timeless.combine({ a: window.Timeless.ref(1) }), /缺少 map 函数/);
});

test("脚本表单默认隐藏，新增/编辑打开 Modal，取消清空草稿", () => {
  const root = build_page({ ...script_fixture, id: "one" }, false);
  assert.equal(find_node(root, "script-form-dialog"), undefined);
  const create = find_node(root, "script-create-button");
  assert.deepEqual(child_texts(create), ["新增脚本"]);
  create.props.onClick();
  let dialog = find_node(root, "script-form-dialog");
  assert.equal(dialog.props.title.value, "新增脚本");
  assert.equal(find_node(dialog, "script-code-textarea").props.value.value, DEFAULT_RSS_SCRIPT);
  assert.equal(find_node(dialog, "script-debug-url").props.value.value, "/solidot");
  find_node(dialog, "script-code-textarea").props.onInput({ target: { value: "草稿" } });
  find_node(dialog, "script-cancel-button").props.onClick();
  assert.equal(dialog.props.open.value, false);
  assert.equal(find_node(root, "script-form-dialog"), undefined);
  create.props.onClick();
  assert.equal(find_node(root, "script-code-textarea").props.value.value, DEFAULT_RSS_SCRIPT);
  find_node(root, "script-form-close-button").props.onClick();
  find_node(root, "script-edit-button").props.onClick();
  dialog = find_node(root, "script-form-dialog");
  assert.equal(dialog.props.title.value, "编辑脚本");
  assert.equal(find_node(dialog, "script-code-textarea").props.value.value, script_fixture.script);
});

test("Modal 保存期间不可取消或替换草稿；失败保留弹窗和错误", async (t) => {
  const original = fetch_handler;
  t.after(() => { fetch_handler = original; });
  let finish;
  fetch_handler = () => new Promise(resolve => { finish = resolve; });
  const root = build_page({ ...script_fixture, id: "one" });
  find_node(root, "script-edit-button").props.onClick();
  const dialog = find_node(root, "script-form-dialog");
  const input = find_node(dialog, "script-code-textarea");
  const pending = find_node(dialog, "script-save-button").props.onClick();
  assert.equal(input.props.disabled.value, true);
  find_node(dialog, "script-cancel-button").props.onClick();
  find_node(root, "script-create-button").props.onClick();
  assert.equal(dialog.props.open.value, true);
  assert.equal(dialog.props.title.value, "编辑脚本");
  assert.equal(input.props.value.value, script_fixture.script);
  finish(Response.json({ error: "保存失败" }, { status: 500 }));
  await pending;
  assert.equal(dialog.props.open.value, true);
  assert.equal(input.props.disabled.value, false);
  assert.deepEqual(child_texts(find_node(root, "script-form-error")), ["保存失败"]);
});

test("卡片显示来源网站与 Cookie 说明，缺失或危险网站不生成链接", () => {
  const description = "需要能匹配 stock.xueqiu.com 的有效 .xueqiu.com Cookie。";
  const root = build_page({ ...script_fixture, url: "xueqiu.com", description }, false);
  assert.deepEqual(child_texts(find_node(root, "script-card-website-link")), ["xueqiu.com"]);
  assert.equal(find_node(root, "script-card-website-link").props.href, "https://xueqiu.com/");
  assert.deepEqual(child_texts(find_node(root, "script-card-description")), [description]);
  const identity = find_node(root, "script-card-identity");
  assert.deepEqual(identity.children.map(node => node.props.attributes?.n || node.type),
    ["script-card-title", "show", "script-card-updated"]);
  assert.ok(find_node(identity, "script-card-description"));
  assert.ok(find_node(root, "admin-icon-globe"));
  assert.ok(find_node(root, "admin-icon-users"));
  assert.equal(find_node(root, "script-card-website").props.attributes["aria-label"], "来源网站");
  assert.deepEqual(child_texts(find_node(root, "script-card-maintainers-value")), ["tester"]);
  const group = find_node(root, "script-route-group");
  assert.deepEqual(group.children.map(node => node.props.attributes.n),
    ["script-route-address", "script-card-example", "script-route-parameters"]);
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
    assert.equal(requests[0].url, "/admin/api/scripts");
    assert.equal(model.editor.state.editing_id.value, script.id);
    assert.equal(model.editor.state.draft_script.value, script.script);
    assert.equal(find_node(page, "script-form-dialog").props.title.value, "编辑脚本");
    for (const name of ["script-code-textarea", "script-save-button", "script-debug-url", "script-cookie-consent"])
      assert.ok(find_node(page, name), name);
    model.editor.methods.set_draft("script", "export const route = { path: '/updated' };");
    await model.editor.methods.save_script();
    assert.equal(requests[1].url, "/admin/api/scripts/message-script");
    assert.equal(requests[1].method, "PATCH");
    assert.match(JSON.parse(requests[1].body).script, /updated/);
    assert.equal(model.editor.state.form_open.value, false);
    assert.equal(find_node(page, "script-form-dialog"), undefined);
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
    // 卡片与执行日志区（logs_route 初值为空串，与空 id 的夹具命中）
    "script-card",
    "script-card-routes",
    "script-card-route",
    "script-logs-toggle-button",
    "script-logs-panel",
    "script-logs-list",
    "script-log-entry",
    "script-log-meta",
    "script-log-params",
    "script-log-error",
    "script-log-lines",
  ]) {
    assert.ok(names.includes(expected), "缺少节点 " + expected);
  }
  // For 按 id 渲染，同一条日志不会因为面板重渲染而重复出现。
  assert.equal(names.filter((name) => name === "script-log-entry").length, 1);
});

test("日志条目按 id 渲染摘要、params、错误全文与 ctx.log 行", () => {
  const root = build_page();
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

test("执行日志切换按钮文案随展开态变化", () => {
  const root = build_page();
  assert.deepEqual(child_texts(find_node(root, "script-logs-toggle-button")), ["收起执行日志"]);
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
    assert.ok(find_node(card, "script-edit-button"));
    assert.ok(find_node(card, "script-logs-toggle-button"));
    assert.equal(find_node(root, "script-preview-dialog"), undefined);
  }
});

for (const editing of [false, true]) {
  test(`${editing ? "编辑" : "新增"}脚本移除 Mock 路由序号，footer 保留实时调试及说明`, () => {
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
    const actions = find_node(dialog, "script-debug-actions");
    assert.equal(find_node(form, "script-debug-actions"), undefined);
    assert.equal(dialog.props.footer[2], actions);
    assert.equal(dialog.props.footer[3].props.attributes.n, "script-draft-debug");
    assert.deepEqual(actions.children.map(node => node.props.attributes.n),
      ["script-live-debug", "script-live-debug-help"]);
    assert.equal(find_node(form, "script-debug-url-field"), undefined);
    assert.equal(walk(form).filter(node => node.props?.attributes?.n === "script-debug-route-row").length, 1);
    assert.match(find_node(actions, "script-live-debug-help").props.content, /^首次运行后/);
    assert.equal(find_node(actions, "script-live-debug-help").props.side, "top");
  });
}



test("卡片没有 Debug 开关，表单 Debug 随独立配置保存", async (t) => {
  const original = fetch_handler;
  t.after(() => { fetch_handler = original; });
  const calls = [];
  fetch_handler = async (url, options) => {
    const body = JSON.parse(options.body);
    calls.push({ url, body });
    return Response.json({ script: { ...script_fixture, debug: body.debug } });
  };
  const root = build_page();
  assert.equal(find_node(root, "script-debug"), undefined);
  const draft = find_node(root, "script-draft-debug");
  draft.props.onChange(true);
  find_node(root, "script-code-textarea").props.onInput({ target: { value: "export const route = {};" } });
  await find_node(root, "script-save-button").props.onClick();
  assert.equal(calls.at(-1).body.debug, true);
  assert.equal(draft.props.checked.value, false);
});

test("卡片右上角无文案 Switch 修改启用状态，阻止重复提交，失败回滚且可重试", async (t) => {
  const original = fetch_handler;
  t.after(() => { fetch_handler = original; });
  const calls = [];
  let finish;
  fetch_handler = (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    return new Promise(resolve => { finish = resolve; });
  };
  const root = build_page(script_fixture, false);
  const release = find_node(root, "script-card-release");
  const toggle = find_node(release, "script-enabled");
  assert.equal(toggle.type, "switch");
  assert.equal(toggle.props.label, undefined);
  assert.match(toggle.props.attributes["aria-label"], /启用状态/);
  assert.equal(find_node(root, "script-toggle-button"), undefined);
  assert.equal(toggle.props.checked.value, true);
  const disable = toggle.props.onChange(false);
  assert.equal(toggle.props.checked.value, false);
  assert.equal(toggle.props.disabled.value, true);
  await toggle.props.onChange(true);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].body, { enabled: false });
  finish(Response.json({ error: "保存失败" }, { status: 500 }));
  await disable;
  assert.equal(toggle.props.checked.value, true);
  assert.equal(toggle.props.disabled.value, false);
  const retry = toggle.props.onChange(false);
  finish(Response.json({ script: { ...script_fixture, enabled: false } }));
  await retry;
  assert.equal(toggle.props.checked.value, false);
  assert.equal(toggle.props.disabled.value, false);
  assert.equal(calls.length, 2);
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
  test(`${editing ? "编辑" : "新增"}脚本保存成功后清空表单，下一次保存创建新脚本`, async (t) => {
    const original_fetch_handler = fetch_handler;
    t.after(() => { fetch_handler = original_fetch_handler; });
    const requests = [];
    fetch_handler = async (url, options) => {
      requests.push({ url, method: options.method, body: JSON.parse(options.body) });
      const id = editing && requests.length === 1 ? "existing-script" : "saved-script";
      return new Response(JSON.stringify({ script: { ...script_fixture, id, status: requests.at(-1).body.status } }));
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
    assert.equal(script_input.props.value.value, "");
    assert.equal(dialog.props.open.value, false);
    assert.equal(dialog.props.title.value, "新增脚本");
    assert.match(child_texts(find_node(root, "script-form-status")).join(""), /已保存/);
    assert.equal(root.props.count.value, String(editing ? 1 : 2));
    assert.equal(save_button.props.disabled.value, undefined);

    find_node(root, "script-create-button").props.onClick();
    script_input.props.onInput({ target: { value: "export const route = { path: '/next' };" } });
    await save_button.props.onClick();
    assert.equal(requests[1].url, "/admin/api/scripts");
    assert.equal(requests[1].method, "POST");
    assert.equal(requests[1].body.enabled, true);
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
  let fail = false;
  fetch_handler = async (url, options) => {
    const body = JSON.parse(options.body);
    requests.push({ url, body });
    return fail ? Response.json({ error: "状态更新失败" }, { status: 500 })
      : Response.json({ script: { ...script_fixture, id: "saved-script", status: body.status, version: body.version || "1.0.0" } });
  };
  const root = build_page({ ...script_fixture, id: "original" });
  find_node(root, "script-version-input").props.onInput({ target: { value: "1.0.0" } });
  await find_node(root, "script-publish-button").props.onClick();
  assert.equal(requests[0].body.status, "published");
  assert.equal(requests[0].body.version, "1.0.0");
  find_node(root, "script-filter-query-input").props.onInput({ target: { value: "saved-script" } });
  assert.deepEqual(child_texts(find_node(root, "script-status")), ["正式"]);
  assert.deepEqual(child_texts(find_node(root, "script-status-button")), ["退回草稿"]);
  fail = true;
  await find_node(root, "script-status-button").props.onClick();
  assert.equal(requests.at(-1).body.status, "draft");
  assert.deepEqual(child_texts(find_node(root, "script-status")), ["正式"]);
  assert.equal(find_node(root, "script-status-button").props.disabled.value, undefined);
  fail = false;
  await find_node(root, "script-status-button").props.onClick();
  assert.deepEqual(child_texts(find_node(root, "script-status")), ["草稿"]);
  find_node(root, "script-filter-status-select").props.onChange({ target: { value: "published" } });
  assert.equal(find_node(root, "script-card"), undefined);
  find_node(root, "script-filter-status-select").props.onChange({ target: { value: "draft" } });
  assert.ok(find_node(root, "script-card"));
});

test("发布必填版本，列表展示版本和哈希；列表发布打开编辑器填写版本，失败保留草稿", async t => {
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
  assert.deepEqual(child_texts(find_node(root, "script-card-version")), ["版本 1.0.0"]);
  assert.deepEqual(find_node(root, "script-card-release").children.map(node => node.props.attributes.n),
    ["script-status", "script-card-version", "script-enabled"]);
  assert.equal(find_node(find_node(root, "script-card-metadata"), "script-card-version"), undefined);
  assert.equal(find_node(root, "script-card-version").props.attributes.title, "源码 SHA-256：abc123");
  await find_node(root, "script-status-button").props.onClick();
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
  assert.deepEqual(child_texts(find_node(root, "script-card-version")), ["版本 1.0.1"]);
  find_node(root, "script-create-button").props.onClick();
  assert.equal(find_node(root, "script-version-input").props.value.value, "");
});

test("只修改版本号也使旧 Cookie 确认失效，调试与脚本助手携带版本号", async t => {
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

test("卡片区分旧授权 ID 和有效授权，重新确认公开范围不打开编辑器或发布新版本", async t => {
  const original = fetch_handler;
  t.after(() => { fetch_handler = original; });
  const calls = [];
  const script = { ...script_fixture, id: "cookie-script", version: "1.0.0", cookie_grant_id: "old-grant",
    cookie_authorization: { status: "required", message: "此脚本版本需要管理员确认 Cookie 权限" } };
  const info = { version: "1.0.0", script_id: script.id, script_hash: "source-hash",
    permissions: { cookies: [{ id: "session", names: ["SUB"], origin: "https://example.com", path_prefix: "/", purpose: "读取内容" }] },
    visibility: { routes: [], public_sources: ["/wxmp/wow36kr"] } };
  fetch_handler = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith("/cookie-permissions")) return Response.json({ error: "需要确认", cookie_permissions: info }, { status: 409 });
    if (url.endsWith("/cookie-grants")) return Response.json({ cookie_grant_id: "new-grant" });
    return Response.json({ scripts: [{ ...script, cookie_grant_id: "new-grant", cookie_authorization: { status: "active", message: "" } }] });
  };
  const root = build_page(script, false);
  assert.deepEqual(child_texts(find_node(root, "script-cookie-status")), ["Cookie 需要重新确认"]);
  assert.ok(find_node(root, "script-cookie-revoke"));
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
  await find_node(root, "script-cookie-revoke").props.onClick();
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
