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
    class: atomic_classes([
      "display-flex align-items-center justify-content-space-between flex-wrap-nowrap flex-none height-56-pixels box-sizing-border-box padding-8-pixels-12-pixels border-bottom-1-pixels-solid-color-border gap-space-3 margin-block-end-space-3 color-color-text",
      custom_class
    ].filter(Boolean).join(" ")),
    attributes: {
      n: "page-header",
      ...attributes
    },
    style: {
      ...{
        "--height-56-pixels": "56px",
        "--padding-8-pixels-12-pixels": "8px 12px",
        "--border-bottom-1-pixels-solid-color-border": "1px solid var(--frui-color-border)"
      },
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
          "margin-0 font-size-font-size-lg line-height-1-5 font-weight-650 overflow-hidden text-overflow-ellipsis white-space-nowrap",
          titleProps.class
        ].filter(Boolean).join(" ")),
        attributes: {
          n: "page-header-title",
          role: "heading",
          "aria-level": heading === "h1" ? "1" : "2",
          ...title_attributes
        }
      }, as_children(title)),
    ]),
    actions === undefined ? null : View({
      ...actionsProps,
      class: atomic_classes([
        "display-flex align-items-center flex-wrap-nowrap white-space-nowrap gap-space-2 min-width-0 overflow-x-auto padding-block-4-pixels margin-block-negative-4-pixels",
        actionsProps.class
      ].filter(Boolean).join(" ")),
      attributes: {
        n: "page-header-actions"
      },
      style: {
        ...{
          "--padding-block-4-pixels": "4px",
          "--margin-block-negative-4-pixels": "-4px"
        },
        ...(actionsProps)?.style
      }
    }, as_children(actions)),
  ].filter(Boolean));
}

export {
  PageHeader
};
