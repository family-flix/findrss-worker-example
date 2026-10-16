// Node 测试也直接导入路由配置，此时尚未加载浏览器运行时。
if (globalThis.Timeless) {
  const { vm, kit, ui } = Timeless;
  Object.assign(globalThis, { vm, kit, ui });
}

export function initialize_admin_auth() {
  const original_fetch = window.fetch.bind(window);
  function safe_redirect_target() {
    const requested =
      new URLSearchParams(window.location.search).get("redirect") || "/admin/";
    try {
      const target = new URL(requested, window.location.origin);
      if (
        target.origin !== window.location.origin ||
        target.pathname.startsWith("/admin/login")
      ) {
        return "/admin/";
      }
      return target.pathname + target.search + target.hash;
    } catch {
      return "/admin/";
    }
  }

  function replace_login() {
    const redirect =
      window.location.pathname + window.location.search + window.location.hash;
    window.location.replace(
      "/admin/login.html?redirect=" + encodeURIComponent(redirect),
    );
  }

  async function session() {
    const response = await original_fetch("/admin/auth/session", {
      credentials: "same-origin",
      cache: "no-store",
    });
    if (!response.ok)
      throw new Error("登录状态检查失败：HTTP " + response.status);
    return response.json();
  }

  async function before_ready() {
    const state = await session();
    const requires_login = !["/admin/login", "/admin/login.html"].includes(window.location.pathname);
    if (requires_login && !state.logged_in) {
      replace_login();
      return false;
    }
    if (!requires_login && state.logged_in) {
      window.location.replace(safe_redirect_target());
      return false;
    }
    return true;
  }

  async function login(password) {
    const response = await original_fetch("/admin/auth/login", {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok)
      throw new Error(payload.error || "登录失败：HTTP " + response.status);
    window.location.replace(safe_redirect_target());
  }

  async function logout() {
    try {
      await original_fetch("/admin/auth/logout", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
      });
    } finally {
      window.location.replace("/admin/login.html");
    }
  }

  async function authenticated_fetch(input, init) {
    const response = await original_fetch(input, init);
    const input_url =
      typeof input === "string"
        ? input
        : input instanceof Request
          ? input.url
          : String(input);
    const url = new URL(input_url, window.location.href);
    if (
      response.status === 401 &&
      url.origin === window.location.origin &&
      url.pathname.startsWith("/admin/api")
    ) {
      replace_login();
    }
    return response;
  }

  document.addEventListener("click", (event) => {
    const target =
      event.target instanceof Element
        ? event.target.closest('[data-auth-action="logout"]')
        : null;
    if (!target) return;
    event.preventDefault();
    logout();
  });

  window.FindRSSAdminAuth = {
    beforeReady: before_ready,
    fetch: authenticated_fetch,
    login,
    logout,
  };
  return window.FindRSSAdminAuth;
}

const animation = Object.freeze({ in: "animate-slide-in", out: "animate-slide-out" });

// 页面、地址和导航信息在同一处声明；components/shell.js 只负责展示。
export const routes_configure = {
  admin: {
    title: "FindRSS 管理后台", pathname: "/admin/", page: "Layout",
    children: {
      messages: { title: "消息", pathname: "/admin/messages", page: "Messages", options: { short_title: "消息", icon: "inbox" } },
      overview: { title: "运行概览", pathname: "/admin/overview", page: "Overview", is_default: true, options: { short_title: "概览", icon: "house" } },
      discovery: { title: "订阅源管理", pathname: "/admin/discovery", page: "Discovery", options: { short_title: "订阅源", icon: "rss", aliases: ["/admin/discovery-admin.html"] } },
      scripts: { title: "脚本管理", pathname: "/admin/scripts", page: "Scripts", options: { short_title: "脚本", icon: "file-code", aliases: ["/admin/rss-scripts.html"] } },
      cookies: { title: "Cookie 管理", pathname: "/admin/cookies", page: "Cookies", options: { short_title: "Cookie", icon: "lock" } },
      tokens: { title: "Token", pathname: "/admin/tokens", page: "Tokens", options: { short_title: "Token", icon: "users" } },
      storage: { title: "存储", pathname: "/admin/storage", page: "Storage", options: { short_title: "存储", icon: "hard-drive" } },
      tasks: { title: "任务", pathname: "/admin/tasks", page: "Tasks", options: { short_title: "任务", icon: "activity" } },
      network: { title: "网络测试", pathname: "/admin/network", page: "NetworkTest", options: { short_title: "网络测试", icon: "activity" } },
      settings: { title: "设置", pathname: "/admin/settings", page: "Settings", options: { short_title: "设置", icon: "settings" } },
      devices: { title: "设备管理", pathname: "/admin/devices", page: "Devices", options: { short_title: "设备", icon: "server", hidden: true, aliases: ["/admin/devices.html"] } },
      loadtest: { title: "并发请求", pathname: "/admin/loadtest", page: "LoadTest", options: { short_title: "并发", icon: "activity", hidden: true } },
      users: { title: "用户管理", pathname: "/admin/users", page: "Users", options: { short_title: "用户", icon: "users", hidden: true } },
      activity: { title: "用户日志", pathname: "/admin/activity", page: "Activity", options: { short_title: "日志", icon: "scroll-text", hidden: true } },
      redemptions: { title: "兑换卡管理", pathname: "/admin/redemptions", page: "Redemptions", options: { short_title: "兑换卡", icon: "tag", hidden: true } },
    },
  },
};

export const navigation = Object.entries(routes_configure.admin.children).filter(([, route]) => !route.options.hidden).map(([id, route]) => ({
  id, title: route.title, short_title: route.options.short_title, icon: route.options.icon,
  href: route.pathname, route_name: "root.admin." + id,
}));

export function create_admin_routing(kit, components) {
  function bind(configure) {
    return Object.fromEntries(Object.entries(configure).map(([name, route]) => [name, {
      ...route,
      component: components[route.page],
      options: { ...route.options, animation },
      ...(route.children ? { children: bind(route.children) } : {}),
    }]));
  }
  const route_table = kit.buildRoutes(bind(routes_configure));
  const navigator = new kit.NavigatorCore();
  const root_view = new kit.RouteViewCore({ name: "root", pathname: "/", title: "ROOT", visible: true, parent: null, views: [] });
  root_view.isRoot = true;
  const history = new kit.HistoryCore({ view: root_view, router: navigator, routes: route_table.routes, views: { root: root_view } });
  return { navigation, route_table, navigator, root_view, history, views: route_table.views };
}

export async function create_admin_store() {
  await import("./components/shell.js");
  await import("./components/admin_agent.js");
  const dashboard = await import("./pages/dashboard.js");
  const components = {
    Layout: window.FindRSSAdminShell.Root,
    Overview: dashboard.OverviewPage,
    Tokens: dashboard.TokensPage,
    Devices: dashboard.DevicesPage,
    Messages: (await import("./pages/messages.js")).MessagesPage,
    LoadTest: (await import("./pages/loadtest.js")).LoadTestPage,
    NetworkTest: (await import("./pages/network.js")).NetworkTestPage,
    Users: (await import("./pages/users.js")).UsersPage,
    Activity: (await import("./pages/activity.js")).UserActivityPage,
    Discovery: (await import("./pages/discovery.js")).DiscoveryPage,
    Scripts: (await import("./pages/script.js")).ScriptPage,
    Cookies: (await import("./pages/cookies.js")).CookiesPage,
    Storage: (await import("./pages/storage.js")).StoragePage,
    Tasks: (await import("./pages/tasks.js")).TasksPage,
    Settings: (await import("./pages/settings.js")).SettingsPage,
    Redemptions: (await import("./pages/redemptions.js")).RedemptionCardsPage,
  };
  return create_admin_routing(kit, components);
}

export function match_admin_route(route_table, pathname) {
  const direct = route_table.routesWithPathname[pathname];
  if (direct) return direct;
  const alias = Object.entries(routes_configure.admin.children).find(([, route]) => route.options.aliases?.includes(pathname));
  return alias ? route_table.routesWithPathname[alias[1].pathname] : null;
}
