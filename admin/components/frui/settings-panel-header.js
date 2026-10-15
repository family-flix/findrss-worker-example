import {
  atomic_classes
} from "./atomic.js";
import {
  PageHeader
} from "./page-header.js";

function SettingsPanelHeader(props) {
  return PageHeader({
    ...props,
    heading: props.heading || "h2",
    class: atomic_classes(["height-auto padding-0 border-bottom-0 margin-block-end-0", props.class].filter(Boolean).join(" ")),
    attributes: {
      n: "settings-panel-header",
      ...props.attributes
    }
  });
}

export {
  SettingsPanelHeader
};
