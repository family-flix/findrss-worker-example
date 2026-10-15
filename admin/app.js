import { create_admin_store, initialize_admin_auth, match_admin_route, navigation } from "./store.js";

if (!Timeless || !Timeless.DOM || !Timeless.kit || !Timeless.ui?.KeepAliveSubViews) {
  throw new Error("FindRSS 管理 SPA 无法启动：Timeless 路由或 KeepAlive 运行时未加载");
}

function ActiveRouteView({ history: history$, root_view: root_view$, views }) {
  return ui.KeepAliveSubViews({
    app: { navigation },
    client: {},
    history: history$,
    hlsPlayer: {},
    storage: {},
    view: root_view$,
    views,
    placeholder() {
      return Timeless.View(
        { class: "box-border max-640-width max-640-padding", style: {
          "width": "min(1240px, calc(100% - 48px))",
          "margin": "0 auto",
          "padding": "24px 0 48px",
          "--max-640-width": "calc(100% - 28px)",
          "--max-640-padding": "26px 0 40px"
        }, attributes: { n: "admin-route-loading" } },
        ["正在打开管理页面…"],
      );
    },
    ErrorFallback(error, page_name) {
      return Timeless.View(
        { class: "box-border block rounded-card bg-danger-bg text-danger whitespace-pre-wrap", style: {
          "margin": "0 0 18px",
          "padding": "14px 16px"
        }, attributes: { n: "admin-route-error", role: "alert" } },
        ["页面加载失败（" + String(page_name || "unknown") + "）：" + String(error?.message || error)],
      );
    },
  });
}

function connect_browser_history({ navigator: navigator$, history: history$ }) {
  const unlisten_push = navigator$.onPushState(({ from, to, path }) => {
    window.history.pushState({ from, to }, "", path);
  });
  const unlisten_replace = navigator$.onReplaceState(({ from, path }) => {
    window.history.replaceState({ from }, "", path);
  });
  const unlisten_navigation = navigator$.onPopState(({ type }) => {
    if (type === "back") history$.back();
    if (type === "forward") history$.forward();
  });
  const on_pop_state = (event) => {
    navigator$.handlePopState({
      type: event.type,
      href: window.location.href,
      pathname: window.location.pathname,
    });
  };
  window.addEventListener("popstate", on_pop_state);
  const unlisten_route = history$.onRouteChange((event) => {
    if (event.view?.title) document.title = event.view.title + " · FindRSS";
    if (event.ignore) return;
    if (event.reason === "push") navigator$.pushState(String(event.href));
    if (event.reason === "replace") navigator$.replaceState(String(event.href));
  });
  return () => {
    if (typeof unlisten_push === "function") unlisten_push();
    if (typeof unlisten_replace === "function") unlisten_replace();
    if (typeof unlisten_navigation === "function") unlisten_navigation();
    if (typeof unlisten_route === "function") unlisten_route();
    window.removeEventListener("popstate", on_pop_state);
  };
}

async function bootstrap() {
  const root_node = document.getElementById("admin-spa-root");
  if (!root_node) return;
  try {
    const auth = initialize_admin_auth();
    if (!(await auth.beforeReady())) return;
    const store = await create_admin_store();
    const { navigator: navigator$, history: history$, route_table } = store;
    const disconnect_history = connect_browser_history(store);
    navigator$.prepare(window.location);
    const route = match_admin_route(route_table, navigator$.pathname);
    if (route && route.pathname !== navigator$.pathname) window.history.replaceState(null, "", route.pathname + window.location.search + window.location.hash);
    history$.push(route ? route.name : route_table.defaultRouteName, navigator$.query, { ignore: true });
    Timeless.DOM.render(
      Timeless.View(
        { class: "box-border relative w-full h-full min-h-0", style: {
          "--route-enter": "admin-route-view-in 180ms cubic-bezier(.2,.8,.2,1) both",
          "--route-exit": "admin-route-view-out 130ms ease-in both"
        }, attributes: { n: "admin-spa-view" }, onUnmounted: disconnect_history },
        [ActiveRouteView(store)],
      ),
      root_node,
    );
    window.FindRSSAdminSpa = Object.freeze({ history: history$, navigator: navigator$ });
    window.addEventListener("pagehide", disconnect_history, { once: true });
  } catch (error) {
    root_node.textContent = error instanceof Error ? error.message : String(error);
    root_node.setAttribute("data-auth-error", "true");
    root_node.className = "rounded-card bg-danger-bg text-danger";
    root_node.style.padding = "16px";
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bootstrap, { once: true });
} else {
  bootstrap();
}
