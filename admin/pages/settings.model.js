import { routes_configure } from "../store.js";

function SettingsModel({ ui = window.FindRSSAdminUI, view, history }) {
  const routes = Object.entries(routes_configure.admin.children.settings.children).map(([id, route]) => ({
    ...route, id, name: "root.admin.settings." + id,
  }));
  const active_route = ui.ref(view.curView?.name);
  const stop_route = history.onRouteChange(event => active_route.as(event.name));
  return {
    state: { routes, active_route },
    methods: {
      navigate(event, route_name) {
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        history.push(route_name);
      },
      destroy() { stop_route?.(); },
    },
  };
}

export { SettingsModel };
