import {
  atomic_classes
} from "./atomic.js";
const {
  View
} = Timeless;

function SettingsPanelSider({
  class: custom_class,
  attributes = {}
} = {}, children = []) {
  return View({
    as: "nav",
    class: atomic_classes([
      "display-flex flex-direction-column gap-space-1 min-width-0 min-height-0 overflow-y-auto overscroll-behavior-contain border-inline-end-1-pixels-solid-color-border padding-space-1 padding-inline-end-space-2",
      custom_class
    ].filter(Boolean).join(" ")),
    attributes: {
      n: "settings-panel-sider",
      ...attributes
    },
    style: {
      ...{
        "--border-inline-end-1-pixels-solid-color-border": "1px solid var(--frui-color-border)"
      }
    }
  }, children);
}

export {
  SettingsPanelSider
};
