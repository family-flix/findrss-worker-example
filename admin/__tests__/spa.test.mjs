import { create_admin_routing, match_admin_route, navigation, routes_configure } from "../store.js";
import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFileSync } from "node:fs";

test("真实 Timeless 路由支持后台菜单反复切换、查询参数和前进后退", () => {
  const context = vm.createContext({ console, setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {} });
  context.window = context;
  context.document = { readyState: "loading", addEventListener() {} };
  vm.runInContext(readFileSync(new URL("../../public/assets/timeless/0.34.2/timeless.umd.min.js", import.meta.url), "utf8"), context);
  context.Timeless.DOM = {};
  const components = Object.fromEntries(["Layout", ...Object.values(routes_configure.admin.children).map(route => route.page)].map(name => [name, () => ({})]));
  const store = create_admin_routing(context.Timeless.kit, components);
  const { history, navigator, root_view } = store;
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
      assert.equal(navigator.href, page.href);
      assert.equal(root_view.curView, admin_view);
      assert.equal(admin_view.parent, root_view);
      assert.equal(history.views[page.route_name].parent, admin_view);
      assert.equal(navigator.name, page.route_name);
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
});
