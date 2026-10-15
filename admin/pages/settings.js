import { SettingsModel } from "./settings.model.js";
import { DeviceTokensModel } from "./dashboard.model.js";
import { DeviceTokensView } from "./dashboard.js";

const { View, Button, Show, computed, AIPreferencesView } = window.FindRSSAdminUI;

function SettingsPage({ view } = {}) {
  const model = SettingsModel();
  const device_tokens = DeviceTokensModel(({ title, message }) => window.confirm(title + "\n\n" + message));
  const start = () => {
    device_tokens.open.as(true);
    return Promise.all([model.methods.start(), device_tokens.refresh()]);
  };
  const leave = () => {
    device_tokens.open.as(false);
    device_tokens.dispose();
    model.methods.leave();
  };
  let stop_show, stop_hide;
  const content = View({
    class: "box-border grid min-w-0 gap-space-4",
    attributes: { n: "settings-content", "aria-busy": computed(model.state.loading, String) },
    onMounted() {
      stop_show = view?.onShow(start);
      stop_hide = view?.onBeforeHide(leave);
      void start();
    },
    onUnmounted() { stop_show?.(); stop_hide?.(); leave(); model.methods.destroy(); },
  }, [
    DeviceTokensView(device_tokens),
    View({ as: "h2", class: "box-border m-0 text-sm", attributes: { n: "settings-model-heading" } }, ["大模型"]),
    View({ class: "box-border text-muted", attributes: { n: "settings-model-description" } }, ["配置 XiaoxunAgent 使用的模型厂商、API Key 和模型参数。"]),
    Show({ when: model.state.loading, ok: () => View({ class: "box-border text-muted", attributes: { n: "settings-loading", role: "status" } }, ["正在加载大模型设置…"]) }),
    Show({ when: computed(model.state.error, Boolean), ok: () => View({ class: "box-border grid gap-space-3", attributes: { n: "settings-load-failure" } }, [
      View({ class: "box-border text-danger", attributes: { n: "settings-load-error", role: "alert" } }, [model.state.error]),
      Button({ class: "box-border justify-self-start", attributes: { n: "settings-retry-button" }, onClick: model.methods.start }, ["重新加载"]),
    ]) }),
    Show({ when: model.state.loaded, ok: () => AIPreferencesView({ store: model.store, style: {
      height: "min(760px, 75dvh)",
      "min-height": "480px",
    } }) }),
    View({ class: "box-border text-muted", attributes: { n: "settings-message", role: "status" } }, [model.store.state.settings_message]),
  ]);
  return window.FindRSSAdminShell.Page({ page_id: "settings", title: "设置" }, [content]);
}

export { SettingsPage };
