import {
  atomic_classes
} from "./atomic.js";
const {
  View
} = Timeless;
import {
  as_children
} from "./shared.js";

function Card(props = {}, children = []) {
  const {
    media,
    title,
    description,
    extra,
    footer,
    class: custom_class,
    attributes = {},
    ...rest
  } = props;
  const header = title === undefined && description === undefined && extra === undefined ?
    null :
    View({
      class: "display-flex align-items-flex-start justify-content-space-between gap-space-3 padding-space-3-space-3-0",
      attributes: {
        n: "card-header"
      }
    }, [
      View({
        class: "display-grid gap-space-1 min-width-0",
        attributes: {
          n: "card-titles"
        }
      }, [
        title === undefined ? null : View({
          class: "font-size-font-size-lg font-weight-700",
          attributes: {
            n: "card-title"
          }
        }, as_children(title)),
        description === undefined ? null : View({
          class: "color-color-muted font-size-font-size-sm",
          attributes: {
            n: "card-description"
          }
        }, as_children(description)),
      ].filter(Boolean)),
      extra === undefined ? null : View({
        class: "flex-none",
        attributes: {
          n: "card-extra"
        }
      }, as_children(extra)),
    ].filter(Boolean));
  return View({
    ...rest,
    class: atomic_classes([
      "overflow-hidden border-0 border-radius-radius-card background-color-surface color-color-text box-shadow-shadow-card",
      custom_class
    ].filter(Boolean).join(" ")),
    attributes: {
      n: attributes.n || "card",
      ...attributes
    },
  }, [
    media === undefined ? null : View({
      class: "display-block width-100-percent",
      attributes: {
        n: "card-media"
      }
    }, as_children(media)),
    header,
    View({
      class: "padding-space-3",
      attributes: {
        n: "card-body"
      }
    }, children),
    footer === undefined ? null : View({
      class: "border-top-1-pixels-solid-color-border padding-space-2-space-3 color-color-muted font-size-font-size-sm",
      attributes: {
        n: "card-footer"
      },
      style: {
        ...{
          "--border-top-1-pixels-solid-color-border": "1px solid var(--frui-color-border)"
        }
      }
    }, as_children(footer)),
  ].filter(Boolean));
}

export {
  Card,
  Card as FRCard
};
