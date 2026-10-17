import { OauthModel } from "./oauth.model.js";
import { SettingsAboutModel } from "./settings/about.model.js";
import { Checkbox } from "../components/frui/checkbox.js";

const { View, Img, Button, Show, computed } = window.FindRSSAdminUI;

export function OauthView({ model = OauthModel({ ui: window.FindRSSAdminUI }) } = {}) {
  const { state, methods } = model;
  const brand = SettingsAboutModel().state;
  return View({ as: "main", class: "box-border grid min-w-0 gap-space-5", style: {
    width: "min(520px, calc(100% - var(--frui-space-4) * 2))", margin: "0 auto", padding: "var(--frui-space-6) 0",
  }, attributes: { n: "admin-oauth-page", "aria-busy": computed(state.loading, String) },
    onMounted: methods.start, onUnmounted: methods.leave,
  }, [
    View({ as: "header", class: "flex items-center gap-space-3", attributes: { n: "oauth-brand" } }, [
      Img({ src: brand.logo, class: "flex-none", style: { width: "48px", height: "48px" },
        attributes: { n: "oauth-logo", alt: "FindRSS Logo", width: 48, height: 48 } }),
      View({ class: "grid gap-space-1" }, [
        View({ class: "font-size-font-size-lg" }, [brand.name]),
        View({ class: "text-muted text-sm", attributes: { n: "oauth-version" } }, ["v" + brand.version]),
      ]),
    ]),
    View({ as: "h1", class: "m-0 font-size-font-size-lg" }, ["授权访问 FindRSS"]),
    Show({ when: state.loading, ok: () => View({ attributes: { role: "status" } }, ["正在加载授权申请…"]) }),
    Show({ when: computed(state.authorization, Boolean), ok: () => View({ class: "grid min-w-0 gap-space-3 rounded-card bg-surface-raised padding-space-3",
      attributes: { n: "mcp-consent" } }, [
        View({ as: "h2", class: "m-0 text-sm" }, [computed(state.authorization, request => `${request?.client_name || "客户端"} 申请访问 FindRSS`)]),
        View({ class: "text-muted break-anywhere", attributes: { n: "mcp-consent-client" } }, [computed(state.authorization, request => "客户端 ID：" + (request?.client_id || ""))]),
        View({ class: "text-muted break-anywhere", attributes: { n: "mcp-consent-callback" } }, [computed(state.authorization, request => "授权后返回：" + (request?.redirect_uri || ""))]),
        View({ class: "text-muted" }, ["确认申请的权限，仅同意你希望开放的功能。客户端名称由申请方提供。"]),
        View({ as: "fieldset", class: "m-0 p-0 border-0 grid gap-space-2" }, [
          View({ as: "legend" }, ["申请的权限"]),
          Show({ when: computed(state.authorization, request => request?.scopes.includes("discovery:create")), ok: () =>
            Checkbox({ checked: state.subscriptions, disabled: state.busy, onChange: methods.set_subscriptions,
              attributes: { n: "mcp-token-subscriptions" } }, ["添加订阅源（写入发现目录）"]) }),
          Show({ when: computed(state.authorization, request => request?.scopes.includes("scripts:create")), ok: () =>
            Checkbox({ checked: state.scripts, disabled: state.busy, onChange: methods.set_scripts,
              attributes: { n: "mcp-token-scripts" } }, ["添加脚本（编译并发布脚本）"]) }),
        ]),
        View({ class: "text-muted" }, ["授权有效期 90 天，可在「设置 → MCP 授权」中随时撤销。"]),
        View({ class: "flex items-center gap-space-2" }, [
          Button({ variant: "primary", disabled: state.busy, onClick: () => methods.decide(true), attributes: { n: "mcp-consent-approve" } }, ["同意授权"]),
          Button({ disabled: state.busy, onClick: () => methods.decide(false), attributes: { n: "mcp-consent-deny" } }, ["拒绝授权"]),
        ]),
      ]) }),
    Show({ when: computed(state.error, Boolean), ok: () => View({ class: "grid gap-space-3" }, [
      View({ class: "text-danger break-anywhere", attributes: { role: "alert", n: "oauth-error" } }, [state.error]),
      Show({ when: computed(state.authorization, request => !request), ok: () => Button({ disabled: state.loading,
        class: "justify-self-start", onClick: methods.start, attributes: { n: "oauth-retry" } }, ["重新加载授权申请"]) }),
    ]) }),
    View({ class: "text-muted", attributes: { role: "status" } }, [state.message]),
  ]);
}
