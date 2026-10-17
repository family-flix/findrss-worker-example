import { create_admin_routing, match_admin_route, navigation, routes_configure } from "../store.js";
import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFileSync } from "node:fs";

test("真实 Timeless 路由支持后台菜单反复切换、查询参数和前进后退", () => {
  const timers = new Map();
  let timer_id = 0;
  const context = vm.createContext({ console,
    setTimeout(callback) { timers.set(++timer_id, callback); return timer_id; },
    clearTimeout(id) { timers.delete(id); },
    setInterval: () => 0, clearInterval() {},
  });
  context.window = context;
  context.document = { readyState: "loading", addEventListener() {} };
  vm.runInContext(readFileSync(new URL("../../public/assets/timeless/0.34.2/timeless.umd.min.js", import.meta.url), "utf8"), context);
  context.Timeless.DOM = {};
  const components = {};
  function register(routes) {
    for (const route of Object.values(routes)) {
      components[route.page] = () => ({});
      if (route.children) register(route.children);
    }
  }
  register(routes_configure);
  const store = create_admin_routing(context.Timeless.kit, components);
  const { history, navigator, root_view } = store;
  // Complete presence transitions without a DOM or wall-clock animation delays.
  for (const method of ["push", "replace", "back", "forward"]) {
    const original = history[method].bind(history);
    history[method] = (...args) => {
      const result = original(...args);
      while (timers.size) {
        const pending = [...timers.values()];
        timers.clear();
        for (const callback of pending) callback();
      }
      return result;
    };
  }
  const pages = navigation;
  for (const route of Object.values(routes_configure.admin.children)) {
    assert.equal(typeof store.views["root.admin." + Object.entries(routes_configure.admin.children).find(([, value]) => value === route)[0]], "function");
    for (const alias of route.options.aliases || []) assert.equal(match_admin_route(store.route_table, alias).pathname, route.pathname);
  }


  history.push("root.admin.overview");
  const admin_view = root_view.curView;
  const overview_view = history.views["root.admin.overview"];
  for (let round = 0; round < 2; round += 1) {
    for (const page of pages) {
      history.push(page.route_name);
      const target = match_admin_route(store.route_table, page.href);
      assert.equal(navigator.href, target.pathname);
      assert.equal(root_view.curView, admin_view);
      assert.equal(admin_view.parent, root_view);
      assert.equal(history.views[page.route_name].parent, admin_view);
      assert.equal(navigator.name, target.name);
    }
  }
  history.push("root.admin.overview");
  assert.equal(history.views["/admin/overview"], overview_view);
  history.push("root.admin.devices", { search: "phone" });
  assert.equal(navigator.href, "/admin/devices?search=phone");
  history.back();
  assert.equal(navigator.href, "/admin/overview");
  history.forward();
  assert.equal(navigator.href, "/admin/devices?search=phone");
  history.replace("root.admin.overview");
  assert.equal(history.views["/admin/overview"], overview_view);
  assert.equal(navigator.href, "/admin/overview");

  const settings_routes = Object.values(routes_configure.admin.children.settings.children);
  for (const route of settings_routes) {
    const matched = match_admin_route(store.route_table, route.pathname);
    assert.equal(matched.pathname, route.pathname);
    assert.equal(typeof store.views[matched.name], "function");
    history.push(matched.name, { section: "test" });
    const settings_view = history.views["root.admin.settings"];
    assert.equal(history.views[matched.name].parent, settings_view);
    assert.equal(settings_view.parent, admin_view);
    assert.equal(settings_view.curView.name, matched.name);
  }
  assert.equal(match_admin_route(store.route_table, "/admin/settings").name, "root.admin.settings.device_tokens");
  assert.equal(match_admin_route(store.route_table, "/admin/settings/").name, "root.admin.settings.device_tokens");
  assert.equal(store.route_table.defaultRouteName, "root.admin.overview");
  assert.equal(match_admin_route(store.route_table, "/admin/settings/missing"), null);

  const settings_view = history.views["root.admin.settings"];
  history.push("root.admin.settings.models", { section: "test" });
  const models_view = history.views["root.admin.settings.models"];
  let hides = 0, activations = 0;
  models_view.onBeforeHide(() => { hides += 1; });
  history.onRouteChange(event => { if (event.view === models_view) activations += 1; });
  history.push("root.admin.settings.cookies");
  assert.equal(hides, 1);
  assert.equal(history.views["root.admin.settings"], settings_view);
  history.back();
  assert.equal(navigator.href, "/admin/settings/models?section=test");
  assert.equal(history.views["root.admin.settings.models"], models_view);
  assert.equal(activations, 1);
  history.forward();
  assert.equal(navigator.href, "/admin/settings/cookies");
  history.push("root.admin.settings.models", { section: "test" });
  history.push("root.admin.overview");
  assert.equal(hides, 3);
  history.push("root.admin.settings.models", { section: "test" });
  assert.equal(activations, 3);
  assert.equal(history.views["root.admin.settings"], settings_view);
  assert.equal(history.views["root.admin.settings.models"], models_view);
});
