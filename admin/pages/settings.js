import { SettingsModel } from "./settings.model.js";
import { SettingsPanelSider } from "../components/frui/settings-panel-sider.js";

const { View, Link, PageLayout, PageHeader, PageContent, computed } = window.FindRSSAdminUI;

function SettingsPage(props) {
  const model = SettingsModel(props);
  const { routes, active_route } = model.state;
  const subviews = Timeless.ui.KeepAliveSubViews(props);
  return PageLayout({
    class: "h-full min-h-0",
    attributes: { n: "settings-layout" },
    header: PageHeader({ title: "设置" }),
    onUnmounted: model.methods.destroy,
  }, [
    PageContent({
      class: "flex-1 max-640-grid-template-columns",
      style: {
        "grid-template-columns": "180px minmax(0, 1fr)",
        "grid-template-rows": "minmax(0, 1fr)",
        "--max-640-grid-template-columns": "112px minmax(0, 1fr)",
      },
    }, [
      SettingsPanelSider({ attributes: { n: "settings-navigation", "aria-label": "设置分类" } },
        routes.map(route => Link({
          href: route.pathname,
          class: computed(active_route, active => "box-border flex-shrink-0 rounded-control no-underline " +
            (active === route.name ? "bg-selected text-link" : "text-muted")),
          style: { padding: "var(--frui-space-2)" },
          attributes: {
            n: "settings-nav-" + route.id,
            "aria-current": computed(active_route, active => active === route.name ? "page" : undefined),
          },
          onClick(event) {
            model.methods.navigate(event, route.name);
          },
        }, [route.title]))),
      View({ class: "relative min-w-0 min-h-0", attributes: { n: "settings-subviews" } }, [subviews]),
    ]),
  ]);
}

export { SettingsPage };
