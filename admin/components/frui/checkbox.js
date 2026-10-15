import {
  atomic_classes
} from "./atomic.js";
const {
  View,
  Show,
  computed
} = Timeless;
import {
  ChoiceViewModel
} from "./choice.js";
import {
  as_children,
  next_uid
} from "./shared.js";

function Checkbox(props = {}, children = []) {
  const {
    checked,
    defaultChecked,
    disabled,
    value,
    name,
    label,
    onChange,
    onClick,
    class: custom_class,
    rootClass,
    attributes = {},
    rootAttributes = {},
    onUnmounted,
    ...rest
  } = props;
  const model = ChoiceViewModel({
    checked,
    defaultChecked,
    disabled,
    value,
    onChange
  });
  const semantic_name = attributes.n || "checkbox",
    label_id = next_uid("frui-checkbox-label");
  const content = label === undefined ? children : as_children(label);

  function toggle(event) {
    if (model.methods.toggle()) onClick?.(event);
  }
  return View({
    class: atomic_classes([
      "display-inline-flex align-items-center gap-space-2 color-color-text font-font-size-1-4-font-family cursor-pointer user-select-none aria-disabled-true-cursor-not-allowed aria-disabled-true-opacity-6",
      "", rootClass
    ].filter(Boolean).join(" ")),
    attributes: {
      n: `${semantic_name}-field`,
      "aria-disabled": computed(model.state.disabled, state => String(state)),
      ...rootAttributes
    },
    onUnmounted() {
      model.destroy();
      onUnmounted?.();
    },
  }, [
    View({
      ...rest,
      as: "button",
      class: atomic_classes([
        "not-disabled-focus-visible-border-color-control-focus-color-color-focus focus-visible-outline-none focus-visible-box-shadow-0-0-0-3-pixels-color-mix-in-srgb-control-focus-color-color-focus-24-percent-transparent media-forced-colors-active-focus-visible-outline-2-pixels-solid-highlight media-forced-colors-active-focus-visible-outline-offset-2-pixels box-sizing-border-box flex-none width-18-pixels height-18-pixels margin-0 appearance-none border-1-pixels-solid-color-border background-color-surface-raised cursor-inherit transition-background-motion-fast-border-color-motion-fast not-disabled-hover-border-color-color-border-strong checked-border-color-color-primary checked-background-color-primary",
        "display-inline-flex align-items-center justify-content-center border-radius-5-pixels padding-0 color-color-on-primary disabled-opacity-1 not-disabled-hover-background-color-surface-hover aria-checked-true-border-color-color-primary aria-checked-true-background-color-primary",
        custom_class
      ].filter(Boolean).join(" ")),
      attributes: {
        ...(content.length ? {
          "aria-labelledby": label_id
        } : {}),
        ...attributes,
        n: semantic_name,
        type: "button",
        role: "checkbox",
        disabled: computed(model.state.disabled, state => state || undefined),
        "aria-checked": computed(model.state.checked, state => String(state)),
        "aria-disabled": computed(model.state.disabled, state => String(state)),
      },
      onClick: toggle,
      style: {
        ...{
          "--focus-visible-box-shadow-0-0-0-3-pixels-color-mix-in-srgb-control-focus-color-color-focus-24-percent-transparent": "0 0 0 3px color-mix(in srgb,var(--frui-control-focus-color, var(--frui-color-focus)) 24%,transparent)",
          "--media-forced-colors-active-focus-visible-outline-2-pixels-solid-highlight": "2px solid Highlight",
          "--media-forced-colors-active-focus-visible-outline-offset-2-pixels": "2px",
          "--width-18-pixels": "18px",
          "--height-18-pixels": "18px",
          "--border-1-pixels-solid-color-border": "1px solid var(--frui-color-border)",
          "--border-radius-5-pixels": "5px"
        },
        ...(rest)?.style
      }
    }, [View({
      class: atomic_classes(computed(model.state.checked, value => "display-inline-flex visibility-hidden pointer-events-none " +
        (value ? "visibility-visible" : ""))),
      attributes: {
        n: `${semantic_name}-mark`,
        "aria-hidden": "true"
      }
    }, [Timeless.Icon({
      name: "check",
      size: 12
    })])]),
    ...(content.length ? [View({
      class: "overflow-wrap-anywhere",
      attributes: {
        n: `${semantic_name}-label`,
        id: label_id
      },
      onClick: toggle
    }, content)] : []),
    ...(name ? [Show({
      when: model.state.checked,
      ok() {
        return View({
          as: "input",
          attributes: {
            n: `${semantic_name}-form-value`,
            type: "hidden",
            name,
            value: value ?? "on",
            disabled: computed(model.state.disabled, state => state || undefined),
          }
        });
      }
    })] : []),
  ]);
}

export {
  Checkbox,
  ChoiceViewModel
};
