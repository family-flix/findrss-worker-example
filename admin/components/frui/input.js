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
  as_children,
  next_uid
} from "./shared.js";
import {
  field_attributes,
  field_autocomplete,
  apply_autocomplete
} from "./field.js";

function InputViewModel(props = {}) {
  const attributes = props.attributes || {};
  const value_source = props.value;
  const store = props.store || new vm.InputCore({
    defaultValue: source_value(value_source, props.defaultValue ?? ""),
    placeholder: source_value(props.placeholder, attributes.placeholder || ""),
    type: props.type || attributes.type || "text",
    disabled: Boolean(source_value(props.disabled, false)),
    allowClear: props.allowClear === true,
    ignoreEnterEvent: Boolean(props.onKeyDown) && !props.onEnter,
  });
  if (props.store && props.placeholder !== undefined) {
    store.setPlaceholder(String(source_value(props.placeholder, "") || ""));
  }
  const unlistens = [
    store.onChange((value) => {
      if (value_source && typeof value_source.as === "function") value_source.as(value);
      else if (value_source && typeof value_source.set === "function") value_source.set(value);
      props.onChange?.(value);
      props.onInput?.({
        target: {
          value
        }
      });
    }),
    props.onEnter ? store.onEnter(props.onEnter) : null,
    props.onKeyDown ? store.onKeyDown(props.onKeyDown) : null,
    props.onBlur ? store.onBlur(props.onBlur) : null,
    subscribe_source(value_source, (value) => {
      if (store.value !== value) store.setValue(value, {
        silence: true
      });
    }),
    subscribe_source(props.placeholder, (value) => store.setPlaceholder(String(value || ""))),
    subscribe_source(props.disabled, (value) => {
      store.disabled = Boolean(value);
      store.setValue(store.value, {
        silence: true
      });
    }),
  ];
  return {
    store,
    destroy: () => dispose_all(unlistens)
  };
}

function Input(props = {}) {
  const {
    class: custom_class,
    rootClass,
    rootAttributes = {},
    attributes = {},
    value,
    onChange,
    onInput,
    onKeyDown,
    // 这四个由 field_attributes / apply_autocomplete 落到 DOM，不透传给 Timeless 的 input 节点。
    maxLength,
    minLength,
    type,
    autoComplete,
    prefix,
    suffix,
    addonBefore,
    addonAfter,
    status = "default",
    size = "default",
    label,
    help,
    error,
    showCount = false,
    onMounted,
    onUnmounted,
    ...rest
  } = props;
  const model = InputViewModel({
    ...props,
    value,
    onChange,
    onInput,
    onKeyDown,
    attributes
  });
  const state_ = refobj(model.store.state);
  const unlisten = model.store.onStateChange((state) => state_.as(state));
  const input_id = attributes.id || next_uid("frui-input");
  const label_id = `${input_id}-label`;
  const help_id = `${input_id}-help`;
  const affixed = prefix !== undefined || suffix !== undefined || addonBefore !== undefined || addonAfter !== undefined;
  const input_attributes = field_attributes(attributes, {
    id: input_id
  }, {
    maxLength,
    minLength,
    type
  });
  const autocomplete = field_autocomplete(autoComplete, attributes);
  if (label !== undefined) input_attributes["aria-labelledby"] = label_id;
  if (help !== undefined || error !== undefined) input_attributes["aria-describedby"] = help_id;
  if (status === "error") input_attributes["aria-invalid"] = "true";
  const max_length = input_attributes.maxlength;

  const root_node = ui.InputPrimitive.Root({
    store: model.store,
    class: atomic_classes([
      "flex-1 width-100-percent min-width-0",
      affixed ?
      "box-sizing-border-box width-100-percent min-width-0 min-height-control-height border-1-pixels-solid-color-border border-radius-8-pixels padding-0-10-pixels background-color-color-surface color-color-text font-400-font-size-1-4-font-family transition-background-color-motion-fast-border-color-motion-fast-box-shadow-motion-fast placeholder-color-color-placeholder placeholder-opacity-1 aria-invalid-true-frui-control-focus-color-color-danger aria-invalid-true-border-color-color-danger not-disabled-hover-border-color-control-focus-color-color-border-strong focus-border-color-control-focus-color-color-focus focus-visible-border-color-control-focus-color-color-focus focus-outline-none focus-box-shadow-0-0-0-3-pixels-color-mix-in-srgb-control-focus-color-color-focus-24-percent-transparent focus-visible-outline-none focus-visible-box-shadow-0-0-0-3-pixels-color-mix-in-srgb-control-focus-color-color-focus-24-percent-transparent disabled-cursor-not-allowed disabled-opacity-6 media-forced-colors-active-focus-outline-2-pixels-solid-highlight media-forced-colors-active-focus-outline-offset-2-pixels media-prefers-reduced-motion-reduce-transition-none" :
      null,
      affixed ?
      "focus-within-border-color-control-focus-color-color-focus focus-within-outline-none focus-within-box-shadow-0-0-0-3-pixels-color-mix-in-srgb-control-focus-color-color-focus-24-percent-transparent has-disabled-cursor-not-allowed has-disabled-opacity-6 media-forced-colors-active-focus-within-outline-2-pixels-solid-highlight media-forced-colors-active-focus-within-outline-offset-2-pixels display-flex align-items-center gap-space-2" :
      null, affixed ? ({
        "error": "border-color-color-danger",
        "warning": "border-color-color-warning",
        "small": "min-height-control-height-sm padding-inline-space-2",
        "large": "min-height-control-height-lg padding-inline-space-4"
      } [status] || "") : null, affixed ? ({
        "error": "border-color-color-danger",
        "warning": "border-color-color-warning",
        "small": "min-height-control-height-sm padding-inline-space-2",
        "large": "min-height-control-height-lg padding-inline-space-4"
      } [size] || "") : null,
      status !== "default" ?
      `${{"error":"frui-control-focus-color-color-danger","warning":"frui-control-focus-color-color-warning"}[status] || ""}` :
      null,
      size !== "default" ? `${{}[size] || ""}` : null,
      rootClass,
    ].filter(Boolean).join(" ")),
    attributes: {
      n: rootAttributes.n || `${attributes.n || "input"}-root`,
      ...rootAttributes
    },
    onUnmounted() {
      unlisten?.();
      model.destroy();
      state_.destroy?.();
      onUnmounted?.();
    },
    style: {
      ...{
        "--border-1-pixels-solid-color-border": "1px solid var(--frui-color-border)",
        "--border-radius-8-pixels": "8px",
        "--padding-0-10-pixels": "0 10px",
        "--focus-box-shadow-0-0-0-3-pixels-color-mix-in-srgb-control-focus-color-color-focus-24-percent-transparent": "0 0 0 3px color-mix(in srgb,var(--frui-control-focus-color, var(--frui-color-focus)) 24%,transparent)",
        "--focus-visible-box-shadow-0-0-0-3-pixels-color-mix-in-srgb-control-focus-color-color-focus-24-percent-transparent": "0 0 0 3px color-mix(in srgb,var(--frui-control-focus-color, var(--frui-color-focus)) 24%,transparent)",
        "--media-forced-colors-active-focus-outline-2-pixels-solid-highlight": "2px solid Highlight",
        "--media-forced-colors-active-focus-outline-offset-2-pixels": "2px",
        "--focus-within-box-shadow-0-0-0-3-pixels-color-mix-in-srgb-control-focus-color-color-focus-24-percent-transparent": "0 0 0 3px color-mix(in srgb,var(--frui-control-focus-color, var(--frui-color-focus)) 24%,transparent)",
        "--media-forced-colors-active-focus-within-outline-2-pixels-solid-highlight": "2px solid Highlight",
        "--media-forced-colors-active-focus-within-outline-offset-2-pixels": "2px"
      }
    }
  }, [
    addonBefore === undefined ? null : View({
      class: "flex-none border-radius-radius-sm padding-space-1-space-2 background-color-surface-raised box-shadow-inset-0-0-0-1-pixels-color-border color-color-muted font-size-font-size-sm",
      attributes: {
        n: "input-addon-before"
      },
      style: {
        ...{
          "--box-shadow-inset-0-0-0-1-pixels-color-border": "inset 0 0 0 1px var(--frui-color-border)"
        }
      }
    }, as_children(addonBefore)),
    prefix === undefined ? null : View({
      class: "display-inline-flex align-items-center justify-content-center flex-none min-width-16-pixels min-height-16-pixels color-color-muted font-size-font-size-sm",
      attributes: {
        n: "input-prefix"
      },
      style: {
        ...{
          "--min-width-16-pixels": "16px",
          "--min-height-16-pixels": "16px"
        }
      }
    }, as_children(prefix)),
    ui.InputPrimitive.Input({
      ...rest,
      store: model.store,
      class: atomic_classes(["placeholder-color-color-placeholder placeholder-opacity-1 font-400-font-size-1-4-font-family", (
            affixed ? "" : ({
              "error": "border-color-color-danger",
              "warning": "border-color-color-warning"
            } [status] || "")), affixed ?
          "flex-1 width-100-percent min-width-0 min-height-auto border-0 border-radius-0 padding-0 background-transparent color-inherit focus-outline-none focus-box-shadow-none disabled-cursor-inherit disabled-opacity-1" :
          "box-sizing-border-box width-100-percent min-width-0 min-height-control-height border-1-pixels-solid-color-border border-radius-8-pixels padding-0-10-pixels background-color-color-surface color-color-text font-400-font-size-1-4-font-family transition-background-color-motion-fast-border-color-motion-fast-box-shadow-motion-fast placeholder-color-color-placeholder placeholder-opacity-1 aria-invalid-true-frui-control-focus-color-color-danger aria-invalid-true-border-color-color-danger not-disabled-hover-border-color-control-focus-color-color-border-strong focus-border-color-control-focus-color-color-focus focus-visible-border-color-control-focus-color-color-focus focus-outline-none focus-box-shadow-0-0-0-3-pixels-color-mix-in-srgb-control-focus-color-color-focus-24-percent-transparent focus-visible-outline-none focus-visible-box-shadow-0-0-0-3-pixels-color-mix-in-srgb-control-focus-color-color-focus-24-percent-transparent disabled-cursor-not-allowed disabled-opacity-6 media-forced-colors-active-focus-outline-2-pixels-solid-highlight media-forced-colors-active-focus-outline-offset-2-pixels media-prefers-reduced-motion-reduce-transition-none",
          size !== "default" ?
          `${{"small":"min-height-control-height-sm padding-0-space-2 font-size-font-size-sm","large":"min-height-control-height-lg padding-0-space-4 font-size-font-size-lg"}[size] || ""}` :
          null, custom_class
        ]
        .filter(Boolean).join(" ")),
      attributes: input_attributes,
      onKeyDown(event) {
        model.store.handleKeyDown(event);
      },
      onMounted(event) {
        apply_autocomplete(event?.target?.get$elm ? event.target.get$elm() : event?.target ?? null, autocomplete);
        onMounted?.(event);
      },
      style: {
        ...{
          "--border-1-pixels-solid-color-border": "1px solid var(--frui-color-border)",
          "--border-radius-8-pixels": "8px",
          "--padding-0-10-pixels": "0 10px",
          "--focus-box-shadow-0-0-0-3-pixels-color-mix-in-srgb-control-focus-color-color-focus-24-percent-transparent": "0 0 0 3px color-mix(in srgb,var(--frui-control-focus-color, var(--frui-color-focus)) 24%,transparent)",
          "--focus-visible-box-shadow-0-0-0-3-pixels-color-mix-in-srgb-control-focus-color-color-focus-24-percent-transparent": "0 0 0 3px color-mix(in srgb,var(--frui-control-focus-color, var(--frui-color-focus)) 24%,transparent)",
          "--media-forced-colors-active-focus-outline-2-pixels-solid-highlight": "2px solid Highlight",
          "--media-forced-colors-active-focus-outline-offset-2-pixels": "2px"
        },
        ...(rest)?.style
      }
    }),
    suffix === undefined ? null : View({
      class: "display-inline-flex align-items-center justify-content-center flex-none min-width-16-pixels min-height-16-pixels color-color-muted font-size-font-size-sm",
      attributes: {
        n: "input-suffix"
      },
      style: {
        ...{
          "--min-width-16-pixels": "16px",
          "--min-height-16-pixels": "16px"
        }
      }
    }, as_children(suffix)),
    addonAfter === undefined ? null : View({
      class: "flex-none border-radius-radius-sm padding-space-1-space-2 background-color-surface-raised box-shadow-inset-0-0-0-1-pixels-color-border color-color-muted font-size-font-size-sm",
      attributes: {
        n: "input-addon-after"
      },
      style: {
        ...{
          "--box-shadow-inset-0-0-0-1-pixels-color-border": "inset 0 0 0 1px var(--frui-color-border)"
        }
      }
    }, as_children(addonAfter)),
  ].filter(Boolean));

  if (label === undefined && help === undefined && error === undefined && !showCount) return root_node;
  return View({
    class: "display-grid gap-space-1 min-width-0",
    attributes: {
      n: `${rootAttributes.n || attributes.n || "input"}-field`
    }
  }, [
    label === undefined ? null : View({
      as: "label",
      class: "color-color-text font-size-font-size font-weight-600",
      attributes: {
        n: "input-label",
        id: label_id,
        for: input_id
      }
    }, as_children(label)),
    root_node,
    error !== undefined ?
    View({
      class: "color-color-muted font-size-font-size-sm font-weight-400 line-height-1-6 color-color-danger cursor-text user-select-text webkit-user-select-text",
      attributes: {
        n: "input-error",
        id: help_id
      }
    }, as_children(error)) :
    (help === undefined ? null : View({
      class: "color-color-muted font-size-font-size-sm font-weight-400 line-height-1-6",
      attributes: {
        n: "input-help",
        id: help_id
      }
    }, as_children(help))),
    showCount ?
    View({
      class: "color-color-muted font-size-font-size-sm text-align-right",
      attributes: {
        n: "input-count"
      }
    }, [
      computed(state_, (state) => `${String(state.value ?? "").length}/${max_length ?? "∞"}`),
    ]) :
    null,
  ].filter(Boolean));
}

export {
  Input,
  InputViewModel,
  Input as FRInput
};
