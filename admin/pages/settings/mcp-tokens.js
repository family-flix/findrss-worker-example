import { format_datetime } from "../../../server/lib/datetime.js";
import { McpTokensModel } from "./mcp-tokens.model.js";
import { SettingsSection } from "./section.js";
import { source_value } from "../../components/frui/shared.js";

const { View, Button, Dialog, Show, For, computed, combine } = window.FindRSSAdminUI;
const time = value => format_datetime(value, { fallback: "尚未使用" });
const status_labels = { active: "有效", expired: "已过期", revoked: "已撤销" };

function SettingsMcpTokensPage({ view, history } = {}) {
  const { state, methods } = McpTokensModel({ ui: window.FindRSSAdminUI });
  const visible_tokens = combine({ tokens: state.tokens, page: state.page }, ({ tokens, page }) => tokens.slice((page - 1) * 20, page * 20));
  const error_view = () => Show({ when: computed(state.error, Boolean), ok: () =>
    View({ class: "text-danger", attributes: { n: "mcp-token-error", role: "alert" } }, [state.error]) });
  return SettingsSection({ view, history, name: "settings-mcp-tokens-content", loading: state.loading, ...methods }, [
    View({ as: "h2", class: "m-0 text-sm" }, ["MCP 授权"]),
    View({ class: "text-muted" }, ["在 MCP 客户端连接下方地址，登录后确认申请的权限。客户端会自动保存授权凭据，无需复制 Token。"]),
    Show({ when: state.loading, ok: () => View({ attributes: { role: "status" } }, ["正在加载 MCP 授权…"]) }),
    Show({ when: state.loaded, ok: () => View({ class: "grid min-w-0 gap-space-3" }, [
      View({ as: "code", class: "break-anywhere", attributes: { n: "mcp-resource" } }, [state.resource]),
      View({ class: "flex items-center justify-between gap-space-2" }, [
        View({ as: "h3", class: "m-0 text-sm" }, ["已有授权"]),
        Button({ disabled: state.busy, onClick: methods.start, attributes: { n: "mcp-token-refresh" } }, ["刷新"]),
      ]),
      Show({ when: computed(state.tokens, tokens => !tokens.length), ok: () => View({ class: "text-muted" }, ["尚无 MCP 授权。在客户端连接 MCP 地址，完成网页确认后会显示在这里。"]) }),
      For({ each: visible_tokens, render(token_ref) {
        return View({ class: "grid min-w-0 gap-space-2 rounded-card bg-surface-raised padding-space-3",
          attributes: { n: "mcp-token-row", "data-token-id": computed(token_ref, token => token.id) } }, [
          View({ class: "flex items-center justify-between gap-space-2" }, [
            View({ class: "break-anywhere" }, [computed(token_ref, token => token.name)]),
            View({ class: "text-muted" }, [computed(token_ref, token => status_labels[token.status] || token.status)]),
          ]),
          View({ as: "code", class: "text-muted break-anywhere" }, [computed(token_ref, token => token.token_hint)]),
          View({ class: "text-muted break-anywhere" }, [computed(token_ref, token => "权限：" + token.scopes.map(scope => scope === "scripts:create" ? "添加脚本" : "添加订阅源").join("、"))]),
          View({ class: "text-muted break-anywhere" }, [computed(token_ref, token => "MCP 地址：" + token.resource)]),
          View({ class: "text-muted" }, [computed(token_ref, token => "到期：" + time(token.expires_at) + " · 最近使用：" + time(token.last_used_at))]),
          Show({ when: computed(token_ref, token => token.status === "active"), ok: () => Button({ class: "justify-self-start", disabled: state.busy,
            attributes: { n: "mcp-token-revoke" }, onClick: () => methods.request_revoke(source_value(token_ref)) }, ["撤销授权"]) }),
        ]);
      } }),
      Show({ when: computed(state.tokens, tokens => tokens.length > 20), ok: () => View({ class: "flex items-center gap-space-2" }, [
        Button({ disabled: combine({ busy: state.busy, page: state.page }, ({ busy, page }) => busy || page <= 1),
          onClick: () => methods.set_page(state.page.value - 1), attributes: { n: "mcp-tokens-previous" } }, ["上一页"]),
        View({ class: "text-muted", attributes: { role: "status" } }, [combine({ tokens: state.tokens, page: state.page }, ({ tokens, page }) => `第 ${page} / ${Math.ceil(tokens.length / 20)} 页`)]),
        Button({ disabled: combine({ busy: state.busy, page: state.page, tokens: state.tokens }, ({ busy, page, tokens }) => busy || page * 20 >= tokens.length),
          onClick: () => methods.set_page(state.page.value + 1), attributes: { n: "mcp-tokens-next" } }, ["下一页"]),
      ]) }),
      View({ class: "text-muted" }, ["列表优先显示有效授权，最多显示 200 条。撤销后，客户端需要重新发起授权申请。"]),
    ]) }),
    error_view(),
    Show({ when: computed(state.loaded, loaded => !loaded), ok: () => Button({ disabled: state.loading,
      onClick: methods.start }, ["重新加载授权"]) }),
    View({ class: "text-muted", attributes: { role: "status" } }, [state.message]),
    Show({ when: computed(state.revoke_target, Boolean), ok: () => Dialog({ open: true,
      title: "撤销 MCP 授权", description: computed(state.revoke_target, token => `撤销“${token?.name || ""}”后，使用此授权的客户端将无法继续访问 MCP 或刷新凭据。`),
      onClose: methods.cancel_revoke, closable: false, maskClosable: false,
      attributes: { n: "mcp-token-revoke-dialog" },
      footer: [Button({ disabled: state.busy, onClick: methods.cancel_revoke }, ["取消"]),
        Button({ disabled: state.busy, onClick: methods.confirm_revoke, attributes: { n: "mcp-token-confirm-revoke" } }, ["撤销授权"])],
    }, [error_view()]) }),
  ]);
}

export { SettingsMcpTokensPage };
