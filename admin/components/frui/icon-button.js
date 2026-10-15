import {
  atomic_classes
} from "./atomic.js";
const {
  View,
  For,
  computed
} = Timeless;
import {
  Button,
  button_size
} from "./button.js";
import {
  source_value
} from "./shared.js";

function IconButton({
  icon,
  label,
  size = "medium",
  as = "button",
  class: custom_class,
  attributes = {},
  ...rest
}) {
  const resolved_size = button_size(size);
  const props = {
    ...rest,
    class: atomic_classes(custom_class && typeof custom_class.subscribe === "function" ?
      computed(custom_class, value => [
        "display-inline-flex flex-none align-items-center justify-content-center width-button-height height-button-height min-height-button-height gap-0 padding-0 background-transparent color-color-muted hover-background-color-surface-hover hover-color-color-text where-summary-list-style-none where-summary-webkit-details-marker-display-none disabled-color-color-muted",
        value
      ].filter(Boolean).join(" ")) :
      ["display-inline-flex flex-none align-items-center justify-content-center width-button-height height-button-height min-height-button-height gap-0 padding-0 background-transparent color-color-muted hover-background-color-surface-hover hover-color-color-text where-summary-list-style-none where-summary-webkit-details-marker-display-none disabled-color-color-muted",
        custom_class
      ].filter(Boolean).join(" ")),
    attributes: {
      n: "icon-button",
      "aria-label": label,
      ...attributes
    },
  };
  const glyph_size = resolved_size === "small" ? 16 : resolved_size === "large" ? 24 : 20;
  const glyph = icon && typeof icon.subscribe === "function" ?
    For({
      each: computed(icon, name => [{
        name
      }]),
      key: "name",
      render: item => Timeless.Icon({
        name: source_value(item).name,
        size: glyph_size
      })
    }) :
    Timeless.Icon({
      name: icon,
      size: glyph_size
    });
  // details 的触发节点必须是直接子级 summary，不能包在普通 button 里。
  if (as === "summary") {
    return View({
      ...props,
      as,
      class: atomic_classes(computed(props.class, value =>
        `box-sizing-border-box font-inherit display-inline-flex align-items-center justify-content-center gap-space-2 min-height-control-height border-0 border-radius-radius-control padding-0-space-3 background-color-surface-raised color-color-text font-family-font-family font-size-button-font-size line-height-1-4 cursor-pointer transition-background-motion-fast-transform-motion-fast hover-background-color-surface-hover active-transform-translatey-1-pixels disabled-cursor-not-allowed disabled-opacity-6 focus-visible-outline-2-pixels-solid-color-focus focus-visible-outline-offset-2-pixels where-a-text-decoration-none where-a-aria-disabled-true-pointer-events-none where-a-aria-disabled-true-opacity-6 background-transparent  ${{"medium":"frui-button-height-control-height-md min-height-button-height padding-0-space-3 font-size-button-font-size","small":"frui-button-height-control-height-sm min-height-button-height padding-0-space-2 font-size-font-size-sm","large":"frui-button-height-control-height-lg min-height-button-height padding-0-space-4 font-size-font-size-lg"}[resolved_size] || ""}   ${value}`
        )),
      style: {
        ...{
          "--active-transform-translatey-1-pixels": "translateY(1px)",
          "--focus-visible-outline-2-pixels-solid-color-focus": "2px solid var(--frui-color-focus)",
          "--focus-visible-outline-offset-2-pixels": "2px"
        },
        ...(props)?.style
      }
    }, [glyph]);
  }
  return Button({
    ...props,
    size: resolved_size,
    variant: "ghost",
    icon: glyph
  });
}

export {
  IconButton
};
