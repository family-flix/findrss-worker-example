import assert from "node:assert/strict";
import test from "node:test";

function create_element(type, props, children) {
  return { type, props: props || {}, children: Array.isArray(children) ? children : [] };
}

let logout_calls = 0;
globalThis.window = {
  FindRSSAdminAuth: {
    logout() {
      logout_calls += 1;
    },
  },
  Timeless: {
    Link(props, children) {
      return create_element("a", props, children);
    },
    Button(props, children) {
      return create_element("button", props, children);
    },
    View(props, children) {
      return create_element(props?.as || "view", props, children);
    },
    Img(props) {
      return create_element("img", props, []);
    },
    combine(refs, map) {
      return { __is_ref: true, get value() { return map(Object.fromEntries(Object.entries(refs).map(([key, value]) => [key, value.value]))); } };
    },
    computed(source, map) {
      return { __is_ref: true, get value() { return map(source.value); } };
    },
    ref(value) {
      return { value, as(next_value) { this.value = next_value; } };
    },
    ui: {
      KeepAliveSubViews() {
        return create_element("view", { attributes: { n: "keep-alive-subviews" } }, []);
      },
    },
  },
};

window.FindRSSAdminUI = window.Timeless;
window.FindRSSAdminUI.Card = (props, children) => create_element("view", props, children);
window.FindRSSAdminUI.Icon = (name) => create_element("svg", { attributes: { n: "admin-icon-" + name } }, []);
window.FindRSSAdminUI.Field = (props, children) => create_element("view", props, children);
window.FindRSSAdminUI.Toaster = () => create_element("portal", { attributes: { n: "toaster" } }, []);
window.FindRSSAdminUI.TooltipHost = () => create_element("portal", { attributes: { n: "tooltip-host" } }, []);
window.FindRSSAdminUI.notify = () => {};
window.FindRSSAdminUI.PageLayout = (props, children) => create_element("section", props, [props.header, ...children].filter(Boolean));
window.FindRSSAdminUI.PageContent = (props, children) => create_element("view", props, children.filter(Boolean));
window.FindRSSAdminUI.PageHeader = (props) => create_element("view", props, [create_element("h1", { attributes: props.title_attributes }, Array.isArray(props.title) ? props.title : [props.title])]);

await import("../components/shell.js");

function walk(node, result = []) {
  if (!node || typeof node !== "object") return result;
  result.push(node);
  for (const child of node.children || []) walk(child, result);
  return result;
}

test("Shell 暴露可复用的后台子页面", () => {
  assert.deepEqual(
    window.FindRSSAdminShell.pages.map((page) => page.id),
    ["messages", "overview", "discovery", "scripts", "clips", "cookies", "tokens", "storage", "tasks", "network", "settings"],
  );
  assert.equal(window.FindRSSAdminShell.pages.find(page => page.id === "tokens").icon, "users");
});

test("Shell 渲染侧边栏、当前菜单和子页面内容", () => {
  const child = create_element("article", { attributes: { n: "test-child" } }, []);
  const root = window.FindRSSAdminShell.View(
    {
      page_id: "discovery",
      eyebrow: "Discovery Operations",
      title: "订阅源管理",
      description: "测试说明",
    },
    [child],
  );
  const nodes = walk(root);
  assert.equal(root.props.attributes.n, "admin-shell");
  assert.equal(root.props.attributes["data-page"], "discovery");
  assert.ok(nodes.some((node) => node.props?.attributes?.n === "admin-shell-sidebar"));
  assert.equal(nodes.filter(node => node.props?.attributes?.n === "toaster").length, 1);
  assert.equal(nodes.filter(node => node.props?.attributes?.n === "tooltip-host").length, 1);
  assert.ok(nodes.includes(child));

  const navigation = nodes.filter((node) =>
    String(node.props?.attributes?.n || "").startsWith("admin-shell-nav-") &&
    node.type === "a"
  );
  assert.equal(navigation.length, 11);
  const main_navigation = walk(root).find(node => node.props?.attributes?.n === "admin-shell-nav");
  assert.deepEqual(walk(main_navigation).filter(node => node.type === "a").map(node => node.props.attributes.n),
    ["overview", "discovery", "scripts", "clips", "cookies", "tokens", "storage", "tasks", "network"].map(id => "admin-shell-nav-" + id));
  assert.equal(
    navigation.filter((node) => node.props.attributes["aria-current"] === "page").length,
    1,
  );
  for (const id of ["devices", "users", "activity", "redemptions"]) {
    assert.equal(navigation.some(node => node.props.attributes.n === "admin-shell-nav-" + id), false);
  }
  for (const id of ["tokens", "storage", "settings"]) {
    assert.ok(navigation.some(node => node.props.attributes.n === "admin-shell-nav-" + id && node.props.href === "/admin/" + id));
  }
  assert.equal(
    navigation.find((node) => node.props.attributes["aria-current"] === "page")?.props.attributes.n,
    "admin-shell-nav-discovery",
  );
});

test("侧边栏底部依次显示消息、设置和退出登录，点击退出调用认证模块", () => {
  const root = window.FindRSSAdminShell.View({ page_id: "overview" }, []);
  const navigation = walk(root).find(node => node.props?.attributes?.n === "admin-shell-nav");
  assert.equal(walk(navigation).some(node => node.props?.attributes?.n === "admin-shell-nav-messages"), false);
  assert.equal(walk(navigation).some(node => node.props?.attributes?.n === "admin-shell-nav-settings"), false);
  const footer = walk(root).find(node => node.props?.attributes?.n === "admin-shell-footer");
  assert.equal(footer.children[0].props.attributes.n, "admin-shell-nav-messages");
  assert.equal(footer.children[1].props.attributes.n, "admin-shell-nav-settings");
  const logout = footer.children[2];
  assert.equal(logout.props.attributes.n, "admin-shell-logout");
  assert.equal(logout.type, "button");
  assert.equal(logout.props.attributes.type, "button");
  assert.ok(walk(logout).some(node => node.children?.includes("退出登录")));
  assert.ok(walk(logout).some(node => node.props?.attributes?.n === "admin-icon-log-out"));
  assert.equal(walk(root).some(node => String(node.props?.attributes?.n || "").startsWith("admin-shell-account")), false);
  const previous_calls = logout_calls;
  logout.props.onClick();
  assert.equal(logout_calls, previous_calls + 1);
});

test("页面数量在标题中响应更新，页面说明与外层 Card 不再渲染", () => {
  const count = window.Timeless.ref(0);
  const root = window.FindRSSAdminShell.Page({ title: "订阅源管理", count, description: "旧说明" }, []);
  const nodes = walk(root);
  const title = nodes.find(node => node.props?.attributes?.n === "admin-shell-title");
  const badge = nodes.find(node => node.props?.attributes?.n === "admin-shell-count");
  assert.ok(title.children.includes(badge));
  assert.equal(badge.children[0].value, 0);
  count.as(12);
  assert.equal(badge.children[0].value, 12);
  assert.equal(nodes.some(node => node.props?.attributes?.n === "admin-shell-description"), false);
  assert.equal(nodes.some(node => String(node.props?.class || "").includes("frui-card")), false);
  assert.equal(walk(window.FindRSSAdminShell.Page({ title: "运行概览" }, [])).some(node => node.props?.attributes?.n === "admin-shell-count"), false);
});

test("导航与 Logo 使用链接，普通点击走 SPA，修饰键点击保留原生导航", () => {
  const pushed_routes = [];
  const history = {
    onRouteChange() {
      return () => {};
    },
    push(route_name) {
      pushed_routes.push(route_name);
    },
  };
  const root = window.FindRSSAdminShell.Root({
    app: {},
    client: {},
    history,
    hlsPlayer: {},
    storage: {},
    view: { curView: { name: "root.admin.overview" } },
    views: {},
  });
  const nodes = walk(root);
  const tokens_link = nodes.find((node) =>
    node.type === "a" && node.props?.attributes?.n === "admin-shell-nav-tokens"
  );
  assert.ok(tokens_link);
  assert.equal(tokens_link.props.href, "/admin/tokens");
  let prevented = 0;
  tokens_link.props.onClick({ button: 0, preventDefault() { prevented += 1; } });
  assert.deepEqual(pushed_routes, ["root.admin.tokens"]);
  const brand = nodes.find((node) => node.props?.attributes?.n === "admin-shell-brand");
  assert.equal(brand.type, "a");
  assert.equal(brand.props.href, "/admin/overview");
  const brand_mark = nodes.find((node) => node.props?.attributes?.n === "admin-shell-brand-mark");
  assert.equal(brand_mark.type, "img");
  assert.equal(brand_mark.props.attributes.src, "/brand/logo.svg");
  assert.equal(brand_mark.props.attributes.alt, "");
  brand.props.onClick({ button: 0, preventDefault() { prevented += 1; } });
  assert.deepEqual(pushed_routes, ["root.admin.tokens", "root.admin.overview"]);
  for (const modifiers of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }, { defaultPrevented: true }]) {
    tokens_link.props.onClick({ button: 0, ...modifiers, preventDefault() { prevented += 1; } });
    brand.props.onClick({ button: 0, ...modifiers, preventDefault() { prevented += 1; } });
  }
  assert.equal(prevented, 2);
  assert.equal(pushed_routes.length, 2);
  const overview = nodes.find((node) => node.props?.attributes?.n === "admin-shell-nav-overview");
  assert.equal(overview.props.attributes["aria-current"].value, "page");
  assert.equal(tokens_link.props.attributes["aria-current"].value, undefined);
  assert.equal(nodes.filter((node) => node.type === "a" && node.props?.attributes?.n?.startsWith("admin-shell-nav-")).length, 11);
  assert.equal(nodes.filter((node) => node.type === "button" && (node.props?.attributes?.n === "admin-shell-brand" || node.props?.attributes?.n?.startsWith("admin-shell-nav-"))).length, 0);
  assert.ok(nodes.some((node) => node.props?.attributes?.n === "keep-alive-subviews"));
});

test("设置子路由保持后台设置菜单高亮，并更新助手的实际页面上下文", () => {
  let route_changed;
  const pathnames = [];
  window.FindRSSAdminAgent = { set_pathname(pathname) { pathnames.push(pathname); } };
  const root = window.FindRSSAdminShell.Root({
    app: {}, client: {}, hlsPlayer: {}, storage: {}, views: {},
    history: {
      state: { href: "/admin/settings/models?search=model" },
      onRouteChange(callback) { route_changed = callback; return () => { route_changed = null; }; },
    },
    view: { curView: { name: "root.admin.settings.models" } },
  });
  const nodes = walk(root);
  const settings = nodes.find(node => node.props?.attributes?.n === "admin-shell-nav-settings");
  const overview = nodes.find(node => node.props?.attributes?.n === "admin-shell-nav-overview");
  try {
    assert.equal(settings.props.attributes["aria-current"].value, "page");
    root.props.onMounted();
    assert.equal(pathnames.at(-1), "/admin/settings/models");
    route_changed({ name: "root.admin.settings.cookies", pathname: "/admin/settings/cookies" });
    assert.equal(settings.props.attributes["aria-current"].value, "page");
    assert.equal(pathnames.at(-1), "/admin/settings/cookies");
    route_changed({ name: "root.admin.overview", pathname: "/admin/overview" });
    assert.equal(settings.props.attributes["aria-current"].value, undefined);
    assert.equal(overview.props.attributes["aria-current"].value, "page");
    route_changed({ name: "root.admin.settings.webhook", pathname: "/admin/settings/webhook" });
    assert.equal(settings.props.attributes["aria-current"].value, "page");
    assert.equal(pathnames.at(-1), "/admin/settings/webhook");
  } finally {
    root.props.onUnmounted();
    delete window.FindRSSAdminAgent;
  }
  assert.equal(route_changed, null);
});
