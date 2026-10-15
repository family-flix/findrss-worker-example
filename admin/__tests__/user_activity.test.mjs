import assert from "node:assert/strict";
import test from "node:test";

// 用户日志页的 Timeless stub。与 users.test.mjs 同构：/users 曾因 旧后台构建脚本漏拷 +
// 漏定义 request_json 整页空白，这里同样要盖住「模块注册」与「onMounted 真的发请求」。
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

/** fetch 调用记录：request_json 若未定义，load_users 会在发请求前抛错，这里就抓得到。 */
const fetch_calls = [];

function stub_response(url) {
  const payload = url.includes("/activity")
    ? { transactions: [{ amount: -1, balance_after: 9 }], next_cursor: "" }
    : { total_count: 1, users: [{ id: "u1", name: "Alice", email: null }] };
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

globalThis.document = { querySelector: () => null };
globalThis.window = {
  localStorage: { getItem: () => null, setItem() {} },
  FindRSSAdminAuth: {
    fetch: async (url, init) => {
      fetch_calls.push({ url: String(url), init });
      return stub_response(String(url));
    },
    beforeReady: async () => true,
  },

  FindRSSAdminShell: {
    Page(options, children) {
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
    View(props, children) {
      return create_element("view", props, children);
    },
    // 真实 Timeless 的 For 是响应式重渲染的，所以列表内容必须在访问时才求值，
    // 否则「先构建页面、后加载数据」的路径下永远看不到用户行。
    For({ each, render }) {
      const source = each && each.__is_ref ? each : { value: each };
      const node = create_element("view", {}, []);
      Object.defineProperty(node, "children", {
        get() {
          return (source.value || []).map((item) => render(item));
        },
      });
      return node;
    },
    // 同 For：Show 也要惰性求值，否则「先建树、后选中用户」时看不到详情区。
    Show({ when, ok, fail }) {
      const node = create_element("view", { class: "show" }, []);
      Object.defineProperty(node, "children", {
        get() {
          const value = when && when.__is_ref ? when.value : when;
          if (value) return [ok()];
          return fail ? [fail()] : [];
        },
      });
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

const { UserActivityPage } = await import("../pages/activity.js");

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

test("user_activity 模块导出页面函数 并能构建页面", () => {
  assert.equal(typeof UserActivityPage, "function");
  const root = UserActivityPage();
  assert.ok(find_node(root, "user-activity-management"), "缺少 user-activity-management 根节点");
  assert.ok(find_node(root, "user-activity-search-input"), "缺少搜索框");
  assert.ok(find_node(root, "user-activity-search-button"), "缺少搜索按钮");
  assert.ok(find_node(root, "user-activity-users"), "缺少用户列表节点");
});

test("onMounted 触发 load_users 并经由 request_json 发出请求", async () => {
  fetch_calls.length = 0;
  const root = UserActivityPage();
  const mounted = find_node(root, "user-activity-management").props.onMounted;
  assert.equal(typeof mounted, "function");
  mounted();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(fetch_calls.length, 1, "request_json 未定义时不会发出任何请求");
  assert.match(fetch_calls[0].url, /^\/admin\/api\/users\?limit=20&offset=0$/);
});

test("点击搜索按钮发出带 q 的请求（submit 事件不会触发，必须走 onClick）", async () => {
  fetch_calls.length = 0;
  const root = UserActivityPage();
  find_node(root, "user-activity-search-input").props.onInput({ target: { value: "alice" } });
  const submit = find_node(root, "user-activity-search-button").props.onClick;
  assert.equal(typeof submit, "function", "搜索按钮缺少 onClick：点击不会触发任何动作");
  submit({ preventDefault() {} });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(fetch_calls.length, 1);
  assert.match(fetch_calls[0].url, /^\/admin\/api\/users\?limit=20&offset=0&q=alice$/);
});

test("选中用户后展开两个列表并按 kind 拉取积分/操作记录", async () => {
  fetch_calls.length = 0;
  const root = UserActivityPage();
  const mounted = find_node(root, "user-activity-management").props.onMounted;
  mounted();
  await new Promise((resolve) => setTimeout(resolve, 20));
  const user_row = find_node(root, "user-activity-user");
  assert.ok(user_row, "缺少用户行节点");
  user_row.props.onClick();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.ok(find_node(root, "user-activity-credit-list"), "缺少积分流水列表节点");
  assert.ok(find_node(root, "user-activity-event-list"), "缺少操作记录列表节点");
  const activity_call = fetch_calls.find((call) => call.url.includes("/activity"));
  assert.ok(activity_call, "选中用户后未拉取日志");
  assert.match(activity_call.url, /^\/admin\/api\/users\/u1\/activity\?kind=credits&limit=50$/);
});

test("空列表要显示空态（loading 与 rows 必须同时被跟踪）", async () => {
  fetch_calls.length = 0;
  const root = UserActivityPage();
  find_node(root, "user-activity-management").props.onMounted();
  await new Promise((resolve) => setTimeout(resolve, 20));
  find_node(root, "user-activity-user").props.onClick();
  await new Promise((resolve) => setTimeout(resolve, 20));
  // stub 只回 transactions，events 因此是空数组：空态必须出现，而不是永远空白。
  find_node(root, "user-activity-tab-events").props.onClick();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.ok(find_node(root, "user-activity-event-empty"), "空列表没有任何提示");
});
