import { navigation as pages } from "../store.js";

const FindRSSAdminShell = (function create_admin_shell() {
  const Timeless = window.FindRSSAdminUI;
  if (!Timeless) {
    throw new Error("FindRSS 管理 Shell 无法启动：Timeless 运行时未加载");
  }
  const { Icon, Img, Link, PageLayout, PageHeader, PageContent, Toaster, TooltipHost, notify, View, combine, computed, ref } = Timeless;

  function AdminShellViewModel(options) {
    const page_id = String(options.page_id || "overview");
    const current_page = pages.find((page) => page.id === page_id) || pages[0];
    return {
      state: { current_page, pages },
      methods: {
        logout() {
          return window.FindRSSAdminAuth.logout();
        },
      },
    };
  }

  function SidebarItemView(page, current_page, history, onClick) {
    const is_active = history
      ? computed(current_page, (current) => current === page.id)
      : current_page === page.id;

    const attributes = {
      n: (onClick ? "admin-shell-" : "admin-shell-nav-") + page.id,
      title: page.title,
      ...(onClick ? { type: "button", "aria-label": page.title } : {}),
      "aria-current": history ? computed(is_active, (active) => active ? "page" : undefined) : is_active ? "page" : undefined,
    };
    const children = [
      View(
        {
          class: "box-border grid place-items-center border-0 rounded-control text-inherit max-640-width max-640-height max-640-border max-640-border-radius max-640-font-size", style: {
            "width": "24px",
            "height": "24px",
            "font": "720 11px/1 ui-monospace, SFMono-Regular, Menlo, monospace",
            "opacity": ".9",
            "--max-640-width": "20px",
            "--max-640-height": "20px",
            "--max-640-border": "0",
            "--max-640-border-radius": "0",
            "--max-640-font-size": "11px"
          },
          attributes: { n: attributes.n + "-mark", "aria-hidden": "true" },
        },
        [Icon(page.icon)],
      ),
      View(
        {
          class: "box-border overflow-hidden text-ellipsis whitespace-nowrap",
          attributes: { n: attributes.n + "-label" },
        },
        [page.short_title],
      ),
      page.id === "messages" && window.FindRSSAdminMessages
        ? View({ class: computed(window.FindRSSAdminMessages.state.badge, value => "box-border " + (value ? "absolute bg-surface-raised text-on-primary rounded-card" : "hidden")), style: {
          top: "5px",
          right: "5px",
          padding: "1px 6px",
          "font-size": "11px"
        }, attributes: { n: "admin-messages-badge", "aria-label": "未读消息" } }, [window.FindRSSAdminMessages.state.badge])
        : null,
    ];
    const Item = onClick ? View : Link;
    return Item(
      {
        ...(onClick ? { as: "button" } : {}),
        href: page.href,
        class: history ? computed(is_active, active => "box-border " + ("relative flex-shrink-0 flex items-center justify-start flex-row rounded-card text-base text-left no-underline max-640-min-width max-640-min-height max-640-flex max-640-justify-content max-640-gap max-640-border-radius max-640-padding max-640-font-size max-640-text-align max-640-flex-direction motion-reduce-transition " + (active ? "bg-selected text-link border-color-border-soft border-0" : "bg-transparent text-muted"))) : "box-border " + ("relative flex-shrink-0 flex items-center justify-start flex-row rounded-card text-base text-left no-underline max-640-min-width max-640-min-height max-640-flex max-640-justify-content max-640-gap max-640-border-radius max-640-padding max-640-font-size max-640-text-align max-640-flex-direction motion-reduce-transition " + (is_active ? "bg-selected text-link border-color-border-soft border-0" : "bg-transparent text-muted")), style: {
          "min-height": "40px",
          "gap": "10px",
          "padding": "8px 10px",
          "font-weight": "650",
          ...(onClick ? { border: "0", "font-family": "inherit", "line-height": "inherit", cursor: "pointer" } : {}),
          "transition": "color .18s ease, background .18s ease",
          "--max-640-min-width": "50px",
          "--max-640-min-height": "50px",
          "--max-640-flex": "none",
          "--max-640-justify-content": "center",
          "--max-640-gap": "3px",
          "--max-640-border-radius": "var(--frui-radius-card)",
          "--max-640-padding": "5px 4px",
          "--max-640-font-size": "10px",
          "--max-640-text-align": "center",
          "--max-640-flex-direction": "column",
          "--motion-reduce-transition": "none"
        },
        attributes,
        onClick: onClick || ((event) => navigate(event, history, page.route_name)),
      },
      children,
    );
  }

  function navigate(event, history, route_name) {
    if (!history || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    history.push(route_name);
  }

  function LogoutView(model) {
    return SidebarItemView({ id: "logout", title: "退出登录", short_title: "退出登录", icon: "log-out" },
      undefined, undefined, model.methods.logout);
  }

  function SidebarView(current_page, history, model) {
    return View(
      {
        class: "box-border relative flex min-h-0 flex-col bg-surface box-shadow-none max-640-grid-row max-640-grid-column max-640-flex-direction max-640-gap max-640-padding max-640-border-top max-640-border-right max-640-overflow", style: {
          "z-index": "20",
          "gap": "18px",
          "padding": "18px 12px 14px",
          "border-right": "1px solid var(--frui-color-border-soft)",
          "--max-640-grid-row": "2",
          "--max-640-grid-column": "1",
          "--max-640-flex-direction": "row",
          "--max-640-gap": "6px",
          "--max-640-padding": "7px 8px calc(7px + env(safe-area-inset-bottom))",
          "--max-640-border-top": "1px solid var(--frui-color-border-soft)",
          "--max-640-border-right": "0",
          "--max-640-overflow": "hidden"
        },
        attributes: { n: "admin-shell-sidebar", "aria-label": "管理后台导航" },
      },
      [
        Link(
          {
            class: "box-border flex items-center justify-start bg-transparent text-text no-underline max-640-display", style: {
              "gap": "7px",
              "padding": "2px 2px 18px",
              "border-bottom": "1px solid var(--frui-color-border-soft)",
              "--max-640-display": "none"
            },
            href: "/admin/overview",
            attributes: { n: "admin-shell-brand", "aria-label": "返回运行概览" },
            onClick(event) { navigate(event, history, "root.admin.overview"); },
          },
          [
            Img({ src: "/brand/logo.svg", class: "box-border grid place-items-center rounded-card bg-transparent text-link box-shadow-none border-0", style: {
              "width": "32px",
              "height": "32px",
              "font": "760 13px/1 ui-monospace, SFMono-Regular, Menlo, monospace",
              "letter-spacing": "-.04em"
            }, attributes: { n: "admin-shell-brand-mark", src: "/brand/logo.svg", alt: "", "aria-hidden": "true", width: 32, height: 32 } }),
            View({ class: "box-border text-muted", style: {
              "font-size": "15px",
              "font-weight": "680",
              "letter-spacing": ".03em"
            }, attributes: { n: "admin-shell-brand-name" } }, ["FindRSS"]),
          ],
        ),
        View(
          { as: "nav", class: "box-border flex min-h-0 flex-col overflow-y-auto max-640-flex-direction max-640-gap max-640-overflow-x", style: {
            "flex": "1 1 auto",
            "gap": "6px",
            "--max-640-flex-direction": "row",
            "--max-640-gap": "4px",
            "--max-640-overflow-x": "auto"
          }, attributes: { n: "admin-shell-nav", "aria-label": "页面导航" } },
          pages.filter(page => page.id !== "messages").map((page) => SidebarItemView(page, current_page, history)),
        ),
        View({ class: "box-border grid flex-none max-640-display max-640-align-items max-640-gap max-640-padding max-640-border-top max-640-border-left", style: {
          "gap": "10px",
          "padding-top": "14px",
          "border-top": "1px solid var(--frui-color-border-soft)",
          "--max-640-display": "flex",
          "--max-640-align-items": "center",
          "--max-640-gap": "5px",
          "--max-640-padding": "0 0 0 5px",
          "--max-640-border-top": "0",
          "--max-640-border-left": "1px solid var(--frui-color-border-soft)"
        }, attributes: { n: "admin-shell-footer" } }, [
          SidebarItemView(pages.find(page => page.id === "messages"), current_page, history),
          LogoutView(model),
        ]),
      ],
    );
  }

  function AdminPageView(options, children) {
    const actions = Array.isArray(options.actions) ? options.actions : [];
    const content = Array.isArray(children) ? children : [children];
    return PageLayout({
      class: options.class,
      attributes: { n: "admin-shell-page" },
      header: options.header || PageHeader({
        titleProps: { class: "box-border flex items-center flex-wrap gap-space-2" },
        attributes: { n: "admin-shell-header" },
        title: [String(options.title || ""), ...(options.count === undefined ? [] : [
          View({ as: "span", class: "box-border flex-none rounded-pill bg-surface-raised text-muted text-sm tabular-nums", style: {
            padding: "var(--frui-space-1) var(--frui-space-2)",
            "font-weight": "500",
          }, attributes: { n: "admin-shell-count" } }, [options.count]),
        ])],
        title_attributes: { n: "admin-shell-title" },
        actions: actions.length ? actions : undefined,
      }),
    }, [PageContent({
      ...options.contentProps,
      attributes: { n: "admin-shell-page-body", ...options.contentProps?.attributes },
    }, content)]);
  }

  function ShellFrame(current_page, history, model, children, lifecycle = {}) {
    const content = Array.isArray(children) ? children : [children];
    return View(
      {
        class: "box-border grid w-full bg-canvas max-640-grid-template-columns max-640-grid-template-rows", style: {
          "grid-template-columns": "196px minmax(0, 1fr)",
          "height": "100dvh",
          "--max-640-grid-template-columns": "minmax(0, 1fr)",
          "--max-640-grid-template-rows": "minmax(0, 1fr) 66px"
        },
        attributes: {
          n: "admin-shell",
          "data-page": typeof current_page === "string" ? current_page : undefined,
        },
        onMounted() {
          window.FindRSSAdminMessages?.methods.start();
          const page = pages.find(page => page.id === (typeof current_page === "string" ? current_page : current_page.value));
          if (page) window.FindRSSAdminAgent?.set_pathname(history?.state?.href?.split("?")[0] || page.href);
        },
        onUnmounted: lifecycle.onUnmounted,
      },
      [
        Toaster(),
        TooltipHost(),
        SidebarView(current_page, history, model),
        View(
          { as: "main", class: "box-border overflow-auto relative min-w-0 w-auto h-full m-0 p-0 bg-canvas max-640-grid-row max-640-grid-column", style: {
            "--max-640-grid-row": "1",
            "--max-640-grid-column": "1"
          }, attributes: { n: "admin-shell-content", role: "main" } },
          content,
        ),
      ].filter(Boolean),
    );
  }

  function AdminShellView(options, children) {
    options = options || {};
    const model = AdminShellViewModel(options);
    return ShellFrame(
      model.state.current_page.id,
      null,
      model,
      [AdminPageView(options, children)],
    );
  }

  function AdminShellRoot(props) {
    const active_page_ = ref("overview");
    const history = props.history;
    const current_route_name = props.view.curView && props.view.curView.name;
    const route_page_id = String(current_route_name || "root.admin.overview").split(".")[2];
    if (pages.some((page) => page.id === route_page_id)) active_page_.as(route_page_id);
    const unlisten = history.onRouteChange((event) => {
      notify("");
      const next_page = pages.find(page => page.route_name === event.name || event.name?.startsWith(page.route_name + "."));
      if (next_page) window.FindRSSAdminAgent?.set_pathname(event.pathname || next_page.href);
      const page_id = String(event.name || "").split(".")[2];
      if (pages.some((page) => page.id === page_id)) active_page_.as(page_id);
    });
    const page_views = Timeless.ui.KeepAliveSubViews({
      app: props.app,
      client: props.client,
      history,
      hlsPlayer: props.hlsPlayer,
      storage: props.storage,
      view: props.view,
      views: props.views,
      placeholder() {
        return PageLayout({ attributes: { n: "admin-shell-page-loading", role: "status" } }, [
          PageContent({}, ["正在打开页面…"]),
        ]);
      },
    });
    return ShellFrame(active_page_, history, AdminShellViewModel({ page_id: "overview" }), [page_views], {
      onUnmounted() {
        if (typeof unlisten === "function") unlisten();
      },
    });
  }

  return Object.freeze({
    View: AdminShellView,
    Page: AdminPageView,
    Root: AdminShellRoot,
    pages,
  });
})();

window.FindRSSAdminShell = FindRSSAdminShell;
window.addEventListener?.("pagehide", () => window.FindRSSAdminMessages?.methods.stop());
