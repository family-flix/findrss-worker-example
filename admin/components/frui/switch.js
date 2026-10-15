import {
  atomic_classes
} from "./atomic.js";
const {
  View,
  computed,
  refobj
} = Timeless;
import {
  source_value,
  subscribe_source,
  dispose_all,
  as_children
} from "./shared.js";

function SwitchViewModel({
  checked,
  disabled,
  defaultChecked,
  onChange
}) {
  const store = vm.SwitchCore({
    defaultValue: Boolean(source_value(checked, defaultChecked ?? false)),
    disabled: Boolean(source_value(disabled, false)),
  });
  const state_ = refobj(store.state);
  let syncing = false;
  const unlistens = [
    store.onStateChange((state) => state_.as(state)),
    store.onChange((value) => {
      if (!syncing) onChange?.(value);
    }),
    subscribe_source(checked, (value) => {
      if (Boolean(value) === Boolean(store.state.checked)) return;
      syncing = true;
      try {
        store.setValue(Boolean(value));
      } finally {
        syncing = false;
      }
    }),
    subscribe_source(disabled, (value) => value ? store.disable() : store.enable()),
  ];
  const is_on_ = computed(state_, (state) => Boolean(state.checked));
  const is_disabled_ = computed(state_, (state) => Boolean(state.disabled));

  function toggle() {
    if (is_disabled_.value) return;
    store.setValue(!store.state.checked);
  }

  return {
    checked: is_on_,
    disabled: is_disabled_,
    toggle,
    destroy() {
      dispose_all(unlistens);
      state_.destroy?.();
      is_on_.destroy?.();
      is_disabled_.destroy?.();
    },
  };
}

function Switch(props = {}) {
  const {
    checked,
    disabled,
    label,
    size = "default",
    onChange,
    class: custom_class,
    attributes = {},
    onUnmounted,
    ...rest
  } = props;
  const model = SwitchViewModel({
    checked,
    disabled,
    defaultChecked: props.defaultChecked,
    onChange
  });

  const root_node = View({
    ...rest,
    class: atomic_classes([
      "not-aria-disabled-true-focus-visible-border-color-control-focus-color-color-focus focus-visible-outline-none focus-visible-box-shadow-0-0-0-3-pixels-color-mix-in-srgb-control-focus-color-color-focus-24-percent-transparent media-forced-colors-active-focus-visible-outline-2-pixels-solid-highlight media-forced-colors-active-focus-visible-outline-offset-2-pixels position-relative display-inline-flex align-items-center flex-none width-40-pixels height-22-pixels border-1-pixels-solid-color-border border-radius-radius-pill padding-0 background-color-surface-raised cursor-pointer transition-background-motion-fast-border-color-motion-fast aria-checked-true-border-color-color-primary aria-checked-true-background-color-primary aria-disabled-true-cursor-not-allowed aria-disabled-true-opacity-6",
      size !== "default" ? `${{"small":"width-32-pixels height-18-pixels"}[size] || ""}` : null, custom_class
    ].filter(Boolean).join(" ")),
    attributes: {
      ...attributes,
      n: `${attributes.n || "switch"}-control`,
      role: "switch",
      tabindex: computed(model.disabled, (value) => value ? "-1" : "0"),
      "aria-checked": computed(model.checked, (on) => (on ? "true" : "false")),
      "aria-disabled": computed(model.disabled, (value) => (value ? "true" : "false")),
    },
    onClick() {
      model.toggle();
    },
    onKeyDown(event) {
      if (event.key !== " " && event.key !== "Enter") return;
      event.preventDefault();
      model.toggle();
    },
    onUnmounted() {
      model.destroy();
      onUnmounted?.();
    },
    style: {
      ...{
        "--focus-visible-box-shadow-0-0-0-3-pixels-color-mix-in-srgb-control-focus-color-color-focus-24-percent-transparent": "0 0 0 3px color-mix(in srgb,var(--frui-control-focus-color, var(--frui-color-focus)) 24%,transparent)",
        "--media-forced-colors-active-focus-visible-outline-2-pixels-solid-highlight": "2px solid Highlight",
        "--media-forced-colors-active-focus-visible-outline-offset-2-pixels": "2px",
        "--width-40-pixels": "40px",
        "--height-22-pixels": "22px",
        "--border-1-pixels-solid-color-border": "1px solid var(--frui-color-border)",
        "--width-32-pixels": "32px",
        "--height-18-pixels": "18px"
      },
      ...(rest)?.style
    }
  }, [View({
    class: atomic_classes(computed(model.checked, value => [
      "position-absolute top-50-percent left-2-pixels width-16-pixels height-16-pixels transform-translatey-negative-50-percent border-1-pixels-solid-color-border-soft border-radius-50-percent background-color-surface-raised box-shadow-0-1-pixels-2-pixels-reader-color-shadow transition-left-motion-fast-background-motion-fast",
      size === "small" ? "width-12-pixels height-12-pixels" : "", value ? (size === "small" ?
        "left-calc-100-percent-14-pixels" : "left-calc-100-percent-18-pixels background-color-on-primary") : ""
    ].join(" "))),
    attributes: {
      n: "switch-thumb",
      "aria-hidden": "true"
    },
    style: {
      ...{
        "--left-2-pixels": "2px",
        "--width-16-pixels": "16px",
        "--height-16-pixels": "16px",
        "--border-1-pixels-solid-color-border-soft": "1px solid var(--frui-color-border-soft)",
        "--box-shadow-0-1-pixels-2-pixels-reader-color-shadow": "0 1px 2px var(--reader-color-shadow)",
        "--width-12-pixels": "12px",
        "--height-12-pixels": "12px",
        "--left-calc-100-percent-14-pixels": "calc(100% - 14px)",
        "--left-calc-100-percent-18-pixels": "calc(100% - 18px)"
      }
    }
  })]);
  if (label === undefined) {
    return View({
      class: "display-inline-flex align-items-center flex-none gap-space-2",
      attributes: {
        n: attributes.n || "switch"
      }
    }, [root_node]);
  }
  return View({
    class: "display-inline-flex align-items-center flex-none gap-space-2",
    attributes: {
      n: attributes.n || "switch"
    }
  }, [
    root_node,
    View({
      class: "color-color-text font-size-font-size",
      attributes: {
        n: "switch-label"
      }
    }, as_children(label)),
  ]);
}

export {
  Switch
};
