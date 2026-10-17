import { DeviceTokensModel } from "../dashboard.model.js";
import { DeviceTokensView } from "../dashboard.js";
import { SettingsSection } from "./section.js";

function SettingsDeviceTokensPage({ view, history } = {}) {
  const model = DeviceTokensModel();
  return SettingsSection({
    view,
    history,
    name: "settings-device-tokens-content",
    loading: model.busy,
    start() {
      model.open.as(true);
      return model.refresh();
    },
    leave() {
      model.open.as(false);
      model.dispose();
    },
  }, [DeviceTokensView(model)]);
}

export { SettingsDeviceTokensPage };
