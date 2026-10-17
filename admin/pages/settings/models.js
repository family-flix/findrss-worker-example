import { SettingsModel } from "./models.model.js";
import { SettingsSection } from "./section.js";

const { View, Button, Show, computed, AIPreferencesView } = window.FindRSSAdminUI;

function SettingsModelsPage({ view, history } = {}) {
  const model = SettingsModel();
  return SettingsSection({
    view, history, name: "settings-models-content", loading: model.state.loading, ...model.methods,
    class: "flex flex-col h-full min-h-0 overflow-hidden",
  }, [
    View(
      {
        as: "h2",
        class: "box-border flex-none m-0 text-sm",
        attributes: { n: "settings-model-heading" },
      },
      ["大模型"],
    ),
    View(
      {
        class: "box-border flex-none text-muted",
        attributes: { n: "settings-model-description" },
      },
      ["配置 XiaoxunAgent 使用的模型厂商、API Key 和模型参数。"],
    ),
    Show({
      when: model.state.loading,
      ok: () =>
        View(
          {
            class: "box-border text-muted",
            attributes: { n: "settings-loading", role: "status" },
          },
          ["正在加载大模型设置…"],
        ),
    }),
    Show({
      when: computed(model.state.error, Boolean),
      ok: () =>
        View(
          {
            class: "box-border grid gap-space-3",
            attributes: { n: "settings-load-failure" },
          },
          [
            View(
              {
                class: "box-border text-danger",
                attributes: { n: "settings-load-error", role: "alert" },
              },
              [model.state.error],
            ),
            Button(
              {
                class: "box-border justify-self-start",
                attributes: { n: "settings-retry-button" },
                onClick: model.methods.start,
              },
              ["重新加载"],
            ),
          ],
        ),
    }),
    Show({
      when: model.state.loaded,
      ok: () =>
        AIPreferencesView({
          store: model.store,
          style: {
            flex: "1",
            height: "auto",
          },
        }),
    }),
    View(
      {
        class: "box-border flex-none text-muted",
        attributes: { n: "settings-message", role: "status" },
      },
      [model.store.state.settings_message],
    ),
  ]);
}

export { SettingsModelsPage };
