const {
  View,
  Show,
  computed
} = Timeless;
import {
  Button
} from "../components/frui/button.js";

function SettingsActions({
  store,
  section,
  instant = false
}) {
  const vm$ = store;
  const save_label_ = computed(vm$.state.settings_busy, (busy) =>
    busy ? "正在保存…" : "保存设置",
  );
  return View({
      class: "position-sticky bottom-0 background-color-surface padding-block-space-3",
      attributes: {
        n: "settings-page-actions"
      },
    },
    [
      Show({
        when: computed(vm$.state.settings_error, Boolean),
        ok() {
          return View({
              class: "",
              attributes: {
                n: "settings-error",
                role: "alert"
              },
            },
            [vm$.state.settings_error],
          );
        },
      }),
      Show({
        when: !instant,
        ok() {
          return View({
              class: "display-flex justify-content-flex-end gap-space-2",
              attributes: {
                n: "settings-actions"
              },
            },
            [
              Button({
                  class: "",
                  attributes: {
                    n: "settings-reset-button"
                  },
                  onClick() {
                    vm$.methods.reset_settings(section);
                  },
                },
                ["恢复本页默认"],
              ),
              Button({
                  variant: "primary",
                  class: "",
                  attributes: {
                    n: "settings-save-button"
                  },
                  disabled: computed(
                    vm$.state.settings_busy,
                    (busy) => busy || undefined,
                  ),
                  onClick() {
                    return vm$.methods.save_settings();
                  },
                },
                [save_label_],
              ),
            ],
          );
        },
      }),
    ],
  );
}

export {
  SettingsActions
};
