import assert from "node:assert/strict";
import test from "node:test";

// 用户管理页的 Timeless stub：只实现 Model/View 用到的构造器与 ref 语义。
// /users 曾整页空白，原因是 index.html 引用的 users.js 没被 旧后台构建脚本拷进
// dist（模块 404，UsersPage 永远是 undefined）；同一文件里还
// 漏了 request_json，即使模块加载成功也会一请求就 ReferenceError。这里两个都盖住。
function create_element(type, props, children) {
  return { type, props: props || {}, children: Array.isArray(children) ? children : [] };
}

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
    assign(next_value) {
      this.value = next_value;
    },
  };
}

/** fetch 调用记录：request_json 若未定义，loadUsers 会在发请求前抛错，这里就抓得到。 */
const fetch_calls = [];

globalThis.document = { querySelector: () => null };
globalThis.window = {
  localStorage: { getItem: () => null, setItem() {} },
  FindRSSAdminAuth: {
    fetch: async (url, init) => {
      fetch_calls.push({ url: String(url), init });
      return new Response(
        JSON.stringify({
          total_count: 1,
          users: [{ id: "u1", name: "Alice", email: null, created_at: 1700000000000 }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    },
    beforeReady: async () => true,
  },

  FindRSSAdminShell: {
    Page(options, children) {
      return create_element("shell", { ...options, attributes: { n: "admin-shell" } }, children);
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
    Select(props, children) {
      return create_element("select", props, children);
    },
    View(props, children) {
      return create_element("view", props, children);
    },
    For({ each, render }) {
      const items = each && each.__is_ref ? each.value : each;
      return create_element("view", {}, (items || []).map((item) => render(item)));
    },
    Show({ when, ok, fail }) {
      const value = when && when.__is_ref ? when.value : when;
      if (value) return ok();
      return fail ? fail() : create_element("view", { class: "is-hidden" }, []);
    },
    combine(refs, map) {
      if (typeof map !== "function") {
        throw new TypeError("combine(refs, map) 缺少 map 函数");
      }
      return {
        __is_ref: true,
        get value() {
          return map(
            Object.fromEntries(Object.entries(refs).map(([key, source]) => [key, source.value])),
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
    ref,
    refarr: ref,
    refobj: ref,
  },
};

window.FindRSSAdminUI = window.Timeless;
window.FindRSSAdminUI.Card = (props, children) => create_element("view", props, children);
window.FindRSSAdminUI.Icon = (name) => create_element("svg", { attributes: { n: "admin-icon-" + name } }, []);
window.FindRSSAdminUI.Field = (props, children) => create_element("view", props, children);
window.FindRSSAdminUI.PageHeader = (props) => create_element("view", props, [create_element("h1", { attributes: props.title_attributes }, [props.title])]);

const { UsersPage } = await import("../pages/users.js");

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

function find_node(root, semantic_name) {
  return walk(root).find((node) => node?.props?.attributes?.n === semantic_name);
}

test("users 模块导出页面函数 并能构建页面", () => {
  assert.equal(typeof UsersPage, "function");
  const root = UsersPage();
  assert.ok(find_node(root, "users-management"), "缺少 users-management 根节点");
  assert.ok(find_node(root, "users-search-input"), "缺少搜索框");
  assert.equal(root.props.title, "用户管理");
  assert.equal(root.props.count.value, "0");
  assert.equal(find_node(root, "users-panel-title"), undefined);
  assert.equal(find_node(root, "users-count"), undefined);
});

test("onMounted 触发 loadUsers 并经由 request_json 发出请求", async () => {
  fetch_calls.length = 0;
  const root = UsersPage();
  const mounted = find_node(root, "users-management").props.onMounted;
  assert.equal(typeof mounted, "function");
  mounted();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(fetch_calls.length, 1, "request_json 未定义时不会发出任何请求");
  assert.match(fetch_calls[0].url, /^\/admin\/api\/users\?limit=20&offset=0$/);
});

test("点击搜索按钮发出带 q 的请求（submit 事件不会触发，必须走 onClick）", async () => {
  fetch_calls.length = 0;
  const root = UsersPage();
  find_node(root, "users-search-input").props.onInput({ target: { value: "alice" } });
  const submit = find_node(root, "users-search-button").props.onClick;
  assert.equal(typeof submit, "function", "搜索按钮缺少 onClick：点击不会触发任何动作");
  submit({ preventDefault() {} });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(fetch_calls.length, 1);
  assert.match(fetch_calls[0].url, /^\/admin\/api\/users\?limit=20&offset=0&q=alice$/);
});
