import { CookiePushSettingsModel } from "../../components/cookie_push_settings.model.js";
import { SettingsSection } from "./section.js";

const { View, Button, Input, Show, computed } = window.FindRSSAdminUI;

function CookiePushSettingsView({ state, methods }) {
  return View({ class: "grid min-w-0 gap-space-3", attributes: { n: "settings-cookie-decryption" } }, [
    View({ as: "h2", class: "m-0 text-sm", attributes: { n: "settings-cookie-heading" } }, ["Cookie 解密"]),
    View({ class: "text-muted", attributes: { n: "settings-cookie-description" } }, [
      "填写与 Cookie 推送端相同的 UUID 和密码，支持 AES-128-CBC 固定 IV 和 AES-256-CBC 兼容模式。",
    ]),
    Show({ when: state.loading, ok: () => View({ attributes: { n: "settings-cookie-loading", role: "status" } }, ["正在加载 Cookie 解密设置…"]) }),
    Show({ when: state.loaded, ok: () => View({ class: "grid min-w-0 gap-space-3", attributes: { n: "settings-cookie-fields" } }, [
      Input({ label: "Cookie 解密 UUID", value: state.uuid, disabled: state.busy, maxLength: 256,
        attributes: { n: "settings-cookie-uuid" }, onChange: methods.set_uuid }),
      Input({ label: "Cookie 解密密码", type: "text", value: state.password, disabled: state.busy, maxLength: 4096,
        autoComplete: "off", attributes: { n: "settings-cookie-password" }, onChange: methods.set_password,
        placeholder: computed(state.configured, configured => configured ? "已设置，留空保留" : "填写推送端密码"),
        help: "密码不会回显；更换 UUID 时需重新填写密码。" }),
      Button({ class: "justify-self-start", disabled: state.busy, attributes: { n: "settings-cookie-save" }, onClick: methods.save }, [
        computed(state.busy, busy => busy ? "正在保存…" : "保存 Cookie 解密设置"),
      ]),
    ]) }),
    Show({ when: computed(state.error, Boolean), ok: () => View({ class: "grid gap-space-2", attributes: { n: "settings-cookie-failure" } }, [
      View({ class: "text-danger", attributes: { n: "settings-cookie-error", role: "alert" } }, [state.error]),
      Show({ when: computed(state.loaded, loaded => !loaded), ok: () => Button({ disabled: state.loading,
        attributes: { n: "settings-cookie-retry" }, onClick: methods.start }, ["重新加载 Cookie 解密设置"]) }),
    ]) }),
    View({ class: "text-muted", attributes: { n: "settings-cookie-message", role: "status" } }, [state.message]),
  ]);
}

function SettingsCookiesPage({ view, history } = {}) {
  const model = CookiePushSettingsModel({ ui: window.FindRSSAdminUI });
  return SettingsSection({
    view, history, name: "settings-cookies-content", loading: model.state.loading, ...model.methods,
  }, [CookiePushSettingsView(model)]);
}

export { SettingsCookiesPage };
