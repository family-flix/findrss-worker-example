import {
  atomic_classes
} from "./atomic.js";
const {
  View,
  For,
  computed
} = Timeless;
import {
  as_children
} from "./shared.js";

function TableField({
  items = [],
  class: custom_class,
  attributes = {},
  labelProps = {},
  ...rest
} = {}) {
  const name = attributes.n || "table-field";
  let revision = 0;
  // 后台 Timeless 尚无 Html 工厂，语义标签通过 View.as 表达。
  return View({
    as: "dl",
    ...rest,
    class: atomic_classes([
      "display-grid grid-template-columns-max-content-minmax-0-1fr gap-space-1-space-2 margin-0 min-width-0 font-size-font-size-sm",
      custom_class
    ].filter(Boolean).join(" ")),
    attributes: {
      n: name,
      ...attributes
    }
  }, [
    For({
      each: computed(items, function(rows) {
        revision += 1;
        return rows.map(function(item, index) {
          return ({
            ...item,
            key: item.key ?? index,
            field_key: `${revision}:${item.key ?? index}`
          });
        });
      }),
      key: "field_key",
      render(raw) {
        const item = (function() {
          if (raw?.__is_ref) {
            return raw.value;
          }
          return raw;
        })();
        return View({
          class: "display-contents",
          attributes: {
            n: `${name}-${item.key}`,
            ...item.attributes
          }
        }, [
          View({
            ...labelProps,
            as: "dt",
            class: atomic_classes(["margin-0 color-color-muted", labelProps.class].filter(Boolean).join(" ")),
            attributes: {
              n: `${name}-${item.key}-label`
            }
          }, as_children(item.label)),
          View({
            as: "dd",
            class: "margin-0 min-width-0 overflow-wrap-anywhere font-variant-numeric-tabular-nums",
            attributes: {
              n: `${name}-${item.key}-value`
            }
          }, as_children(item.value)),
        ]);
      }
    }),
  ]);
}

export {
  TableField
};
