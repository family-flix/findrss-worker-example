import { WebhookSettingsModel } from "../../components/webhook_settings.model.js";
import { SettingsSection } from "./section.js";

const { View, Button, Input, Textarea, Show, computed } = window.FindRSSAdminUI;

function WebhookSettingsView({ state, methods }) {
  return View({ class: "grid min-w-0 gap-space-3", attributes: { n: "settings-webhook" } }, [
    View({ as: "h2", class: "m-0 text-sm", attributes: { n: "settings-webhook-heading" } }, ["Webhook 消息推送"]),
    View({ class: "text-muted", attributes: { n: "settings-webhook-description" } }, [
      "新错误消息同时通过 POST JSON 推送到此地址，URL 留空关闭。Token 使用 Authorization: Bearer 发送，留空保留已保存的 Token。",
    ]),
    Show({ when: state.loading, ok: () => View({ attributes: { n: "settings-webhook-loading", role: "status" } }, ["正在加载 Webhook 设置…"]) }),
    Show({ when: state.loaded, ok: () => View({ class: "grid min-w-0 gap-space-3", attributes: { n: "settings-webhook-fields" } }, [
      Input({ label: "Webhook URL", type: "url", value: state.url, disabled: state.busy, maxLength: 4096,
        attributes: { n: "settings-webhook-url" }, onChange: methods.set_url, placeholder: "https://notify.example.com/api/notify/…" }),
      Input({ label: "Webhook Token", type: "password", value: state.token, disabled: state.busy, maxLength: 4096,
        autoComplete: "new-password", attributes: { n: "settings-webhook-token" }, onChange: methods.set_token,
        placeholder: computed(state.token_configured, configured => configured ? "已设置，留空保留" : "填写 Token（可选）") }),
      Textarea({ label: "JSON 消息模板", value: state.template, disabled: state.busy, maxLength: 8192, rows: 5,
        attributes: { n: "settings-webhook-template" }, onChange: methods.set_template,
        help: '例如 {"text":"{{message}}\\n{{error_text}}"}。变量：{{message}} 错误描述、{{error_text}} 错误详情、{{script_name}} 脚本名、{{path}} 脚本路径、{{pathname}} 请求路径、{{route}} 脚本 ID、{{source}} 来源、{{phase}} 阶段、{{created_at}} 时间戳。' }),
      Button({ class: "justify-self-start", disabled: state.busy, attributes: { n: "settings-webhook-save" }, onClick: methods.save }, [
        computed(state.busy, busy => busy ? "正在保存…" : "保存 Webhook 设置"),
      ]),
    ]) }),
    Show({ when: computed(state.error, Boolean), ok: () => View({ class: "grid gap-space-2", attributes: { n: "settings-webhook-failure" } }, [
      View({ class: "text-danger", attributes: { n: "settings-webhook-error", role: "alert" } }, [state.error]),
      Show({ when: computed(state.loaded, loaded => !loaded), ok: () => Button({ disabled: state.loading,
        attributes: { n: "settings-webhook-retry" }, onClick: methods.start }, ["重新加载 Webhook 设置"]) }),
    ]) }),
    View({ class: "text-muted", attributes: { n: "settings-webhook-message", role: "status" } }, [state.message]),
  ]);
}

function SettingsWebhookPage({ view, history } = {}) {
  const model = WebhookSettingsModel({ ui: window.FindRSSAdminUI });
  return SettingsSection({
    view, history, name: "settings-webhook-content", loading: model.state.loading, ...model.methods,
  }, [WebhookSettingsView(model)]);
}

export { SettingsWebhookPage };
