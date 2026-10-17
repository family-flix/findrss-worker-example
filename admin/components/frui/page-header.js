import {
  atomic_classes
} from "./atomic.js";
const {
  View
} = Timeless;
import {
  as_children
} from "./shared.js";

function PageHeader({
  title,
  actions,
  heading = "h1",
  title_attributes = {},
  class: custom_class,
  attributes = {},
  titleProps = {},
  actionsProps = {},
  ...rest
}) {
  return View({
    ...rest,
    as: rest.as || "header",
    class: atomic_classes([
      "display-flex align-items-center justify-content-space-between flex-wrap flex-none min-height-control-height-lg box-sizing-border-box p-0 border-bottom-0 gap-space-3 m-0 color-color-text",
      custom_class
    ].filter(Boolean).join(" ")),
    attributes: {
      n: "page-header",
      ...attributes
    },
    style: {
      ...(rest)?.style
    }
  }, [
    View({
      class: "flex-0-1-auto min-width-0",
      attributes: {
        n: "page-header-text"
      }
    }, [
      View({
        ...titleProps,
        as: heading,
        class: atomic_classes([
          "margin-0 font-size-font-size-lg line-height-1-5 font-weight-650 break-anywhere",
          titleProps.class
        ].filter(Boolean).join(" ")),
        attributes: {
          n: "page-header-title",
          role: "heading",
          "aria-level": heading === "h1" ? "1" : "2",
          ...titleProps.attributes,
          ...title_attributes
        }
      }, as_children(title)),
    ]),
    actions === undefined ? null : View({
      ...actionsProps,
      class: atomic_classes([
        "display-flex align-items-center flex-wrap gap-space-2 min-width-0 max-w-full p-0 m-0",
        actionsProps.class
      ].filter(Boolean).join(" ")),
      attributes: {
        n: "page-header-actions",
        ...actionsProps.attributes
      },
      style: {
        ...(actionsProps)?.style
      }
    }, as_children(actions)),
  ].filter(Boolean));
}

export {
  PageHeader
};
