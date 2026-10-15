import {
  atomic_classes
} from "./atomic.js";
const {
  View,
  computed,
  ref
} = Timeless;
import {
  source_value,
  subscribe_source,
  dispose_all,
  as_children
} from "./shared.js";

function ChoiceViewModel(props = {}) {
  const checked_source = props.checked;
  const checked_ = ref(Boolean(source_value(checked_source, props.defaultChecked ?? false)));
  const disabled_ = ref(Boolean(source_value(props.disabled, false)));
  const unlistens = [
    subscribe_source(checked_source, (value) => checked_.as(Boolean(value))),
    subscribe_source(props.disabled, (value) => disabled_.as(Boolean(value))),
  ];

  function set_checked(value) {
    if (disabled_.value) return false;
    const next = Boolean(value);
    if (next === checked_.value) return false;
    checked_.as(next);
    if (checked_source && typeof checked_source.as === "function") checked_source.as(next);
    else if (checked_source && typeof checked_source.set === "function") checked_source.set(next);
    props.onChange?.(next, props.value);
    return true;
  }

  return {
    state: {
      checked: checked_,
      disabled: disabled_
    },
    methods: {
      set_checked,
      toggle: () => set_checked(!checked_.value)
    },
    destroy() {
      dispose_all(unlistens);
      checked_.destroy?.();
      disabled_.destroy?.();
    },
  };
}

function ChoiceView(kind, props = {}, children = []) {
  const {
    checked,
    defaultChecked,
    disabled,
    value,
    name,
    label,
    onChange,
    class: custom_class,
    rootClass,
    attributes = {},
    rootAttributes = {},
    onMounted,
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
  const semantic_name = attributes.n || kind;
  let element = null;

  function sync_element() {
    if (!element) return;
    element.checked = model.state.checked.value;
    element.disabled = model.state.disabled.value;
  }

  const unlistens = [
    model.state.checked.subscribe({
      onChange: sync_element
    }),
    model.state.disabled.subscribe({
      onChange: sync_element
    }),
  ];
  const content = label === undefined ? children : as_children(label);

  return View({
    as: "label",
    class: atomic_classes([
      "display-inline-flex align-items-center gap-space-2 color-color-text font-font-size-1-4-font-family cursor-pointer user-select-none aria-disabled-true-cursor-not-allowed aria-disabled-true-opacity-6",
      `${{}[kind] || ""}`, rootClass
    ].filter(Boolean).join(" ")),
    attributes: {
      n: rootAttributes.n || `${semantic_name}-field`,
      "aria-disabled": computed(model.state.disabled, (state) => state ? "true" : "false"),
      ...rootAttributes,
    },
    onUnmounted() {
      dispose_all(unlistens);
      model.destroy();
      onUnmounted?.();
    },
    style: {
      ...{
        "--max-width-calc-100-vw-16-pixels": "calc(100vw - 16px)",
        "--max-height-75-dynamic-vh": "75dvh",
        "--active-transform-translatey-1-pixels": "translateY(1px)",
        "--focus-visible-outline-2-pixels-solid-color-focus": "2px solid var(--frui-color-focus)",
        "--focus-visible-outline-offset-2-pixels": "2px",
        "--width-14-pixels": "14px",
        "--height-14-pixels": "14px",
        "--border-2-pixels-solid-currentcolor": "2px solid currentColor",
        "--border-1-pixels-solid-color-border": "1px solid var(--frui-color-border)",
        "--border-radius-8-pixels": "8px",
        "--padding-0-10-pixels": "0 10px",
        "--focus-box-shadow-0-0-0-3-pixels-color-mix-in-srgb-control-focus-color-color-focus-24-percent-transparent": "0 0 0 3px color-mix(in srgb,var(--frui-control-focus-color, var(--frui-color-focus)) 24%,transparent)",
        "--focus-visible-box-shadow-0-0-0-3-pixels-color-mix-in-srgb-control-focus-color-color-focus-24-percent-transparent": "0 0 0 3px color-mix(in srgb,var(--frui-control-focus-color, var(--frui-color-focus)) 24%,transparent)",
        "--media-forced-colors-active-focus-outline-2-pixels-solid-highlight": "2px solid Highlight",
        "--media-forced-colors-active-focus-outline-offset-2-pixels": "2px",
        "--media-forced-colors-active-focus-visible-outline-2-pixels-solid-highlight": "2px solid Highlight",
        "--media-forced-colors-active-focus-visible-outline-offset-2-pixels": "2px",
        "--width-40-pixels": "40px",
        "--height-22-pixels": "22px",
        "--min-width-16-pixels": "16px",
        "--min-height-80-pixels": "80px",
        "--min-height-24-pixels": "24px",
        "--font-600-11-pixels-1-font-family": "600 11px/1 var(--frui-font-family)",
        "--height-1-pixels": "1px",
        "--width-32-pixels": "32px",
        "--height-32-pixels": "32px",
        "--max-width-min-280-pixels-calc-100-vw-32-pixels": "min(280px,calc(100vw - 32px))",
        "--min-width-20-pixels": "20px",
        "--border-block-start-1-pixels-solid-color-border": "1px solid var(--frui-color-border)"
      }
    }
  }, [
    View({
      ...rest,
      as: "input",
      class: atomic_classes([
        "not-disabled-focus-visible-border-color-control-focus-color-color-focus focus-visible-outline-none focus-visible-box-shadow-0-0-0-3-pixels-color-mix-in-srgb-control-focus-color-color-focus-24-percent-transparent media-forced-colors-active-focus-visible-outline-2-pixels-solid-highlight media-forced-colors-active-focus-visible-outline-offset-2-pixels box-sizing-border-box flex-none width-18-pixels height-18-pixels margin-0 appearance-none border-1-pixels-solid-color-border background-color-surface-raised cursor-inherit transition-background-motion-fast-border-color-motion-fast not-disabled-hover-border-color-color-border-strong checked-border-color-color-primary checked-background-color-primary",
        `${{"checkbox":"display-inline-flex align-items-center justify-content-center border-radius-5-pixels padding-0 color-color-on-primary disabled-opacity-1 not-disabled-hover-background-color-surface-hover aria-checked-true-border-color-color-primary aria-checked-true-background-color-primary", "radio":"border-radius-50-percent checked-box-shadow-inset-0-0-0-4-pixels-color-surface-raised"}[kind] || ""}`,
        custom_class
      ].filter(Boolean).join(" ")),
      attributes: {
        n: semantic_name,
        ...attributes,
        type: kind,
        name,
        value,
      },
      onChange(event) {
        model.methods.set_checked(Boolean(event.target?.checked));
      },
      onMounted(event) {
        element = event?.target?.get$elm ? event.target.get$elm() : event?.target ?? null;
        sync_element();
        onMounted?.(event);
      },
      style: {
        ...{
          "--focus-visible-box-shadow-0-0-0-3-pixels-color-mix-in-srgb-control-focus-color-color-focus-24-percent-transparent": "0 0 0 3px color-mix(in srgb,var(--frui-control-focus-color, var(--frui-color-focus)) 24%,transparent)",
          "--media-forced-colors-active-focus-visible-outline-2-pixels-solid-highlight": "2px solid Highlight",
          "--media-forced-colors-active-focus-visible-outline-offset-2-pixels": "2px",
          "--width-18-pixels": "18px",
          "--height-18-pixels": "18px",
          "--border-1-pixels-solid-color-border": "1px solid var(--frui-color-border)",
          "--border-radius-5-pixels": "5px",
          "--checked-box-shadow-inset-0-0-0-4-pixels-color-surface-raised": "inset 0 0 0 4px var(--frui-color-surface-raised)"
        },
        ...(rest)?.style
      }
    }),
    content.length === 0 ?
    null :
    View({
      class: "overflow-wrap-anywhere",
      attributes: {
        n: `${semantic_name}-label`
      }
    }, content),
  ].filter(Boolean));
}

export {
  ChoiceViewModel,
  ChoiceView
};
