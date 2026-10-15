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

function button_size(value) {
  return value === "small" || value === "large" ? value : "medium";
}

function ButtonViewModel(props = {}) {
  const store = props.store || new vm.ButtonCore({
    disabled: Boolean(source_value(props.disabled, false)),
    loading: Boolean(source_value(props.loading, false)),
    variant: props.variant || "default",
    size: button_size(props.size),
  });
  if (props.store && props.disabled !== undefined) {
    source_value(props.disabled, false) ? store.disable() : store.enable();
  }
  if (props.store && props.loading !== undefined) {
    store.setLoading(Boolean(source_value(props.loading, false)));
  }
  const unlistens = [
    subscribe_source(props.disabled, (value) => value ? store.disable() : store.enable()),
    subscribe_source(props.loading, (value) => store.setLoading(Boolean(value))),
  ];
  return {
    store,
    destroy: () => dispose_all(unlistens)
  };
}

function Button(props = {}, children = []) {
  const {
    class: custom_class,
    attributes = {},
    store: provided_store,
    disabled,
    loading,
    variant = provided_store?.state.variant || "default",
    size = provided_store?.state.size || "medium",
    href,
    icon,
    icon_position = "start",
    onClick,
    contentProps = {},
    onUnmounted,
    ...rest
  } = props;
  const resolved_size = button_size(size);
  const model = ButtonViewModel({
    store: provided_store,
    disabled,
    loading,
    variant,
    size: resolved_size
  });
  const state_ = refobj(model.store.state);
  const unlisten = model.store.onStateChange((state) => state_.as(state));
  const loading_node = ui.ButtonPrimitive.Loading({
    store: model.store
  }, [
    View({
      class: "display-inline-flex align-items-center",
      attributes: {
        n: "button-loading",
        "aria-hidden": "true"
      }
    }, [
      View({
        class: "width-14-pixels height-14-pixels flex-none border-2-pixels-solid-currentcolor border-top-color-transparent border-radius-50-percent animation-frui-spin-8s-linear-infinite media-prefers-reduced-motion-reduce-animation-none",
        attributes: {
          n: "button-spinner",
          "aria-hidden": "true"
        },
        style: {
          ...{
            "--width-14-pixels": "14px",
            "--height-14-pixels": "14px",
            "--border-2-pixels-solid-currentcolor": "2px solid currentColor"
          }
        }
      }),
    ]),
  ]);
  const icon_node = icon === undefined ?
    null :
    View({
      class: "display-inline-flex flex-none",
      attributes: {
        n: "button-icon",
        "aria-hidden": "true"
      }
    }, as_children(icon));
  const content_node = ui.ButtonPrimitive.Content({
    ...contentProps,
    attributes: {
      n: "button-content"
    }
  }, children);
  const slots = (icon_position === "end" ?
    [loading_node, content_node, icon_node] :
    [loading_node, icon_node, content_node]).filter(Boolean);
  const base_class =
    `box-sizing-border-box font-inherit display-inline-flex align-items-center justify-content-center gap-space-2 min-height-control-height border-0 border-radius-radius-control padding-0-space-3 background-color-surface-raised color-color-text font-family-font-family font-size-button-font-size line-height-1-4 cursor-pointer transition-background-motion-fast-transform-motion-fast hover-background-color-surface-hover active-transform-translatey-1-pixels disabled-cursor-not-allowed disabled-opacity-6 focus-visible-outline-2-pixels-solid-color-focus focus-visible-outline-offset-2-pixels where-a-text-decoration-none where-a-aria-disabled-true-pointer-events-none where-a-aria-disabled-true-opacity-6  ${{"primary":"background-color-primary color-color-on-primary font-weight-700 hover-background-color-primary-hover","quiet":"background-transparent","danger":"background-transparent color-color-danger hover-background-color-danger-bg","ghost":"background-transparent hover-background-color-surface-hover","link":"min-height-auto padding-0 background-transparent color-color-link font-weight-650 hover-background-transparent hover-text-decoration-underline active-transform-none"}[variant] || ""}  ${{"medium":"frui-button-height-control-height-md min-height-button-height padding-0-space-3 font-size-button-font-size","small":"frui-button-height-control-height-sm min-height-button-height padding-0-space-2 font-size-font-size-sm","large":"frui-button-height-control-height-lg min-height-button-height padding-0-space-4 font-size-font-size-lg"}[resolved_size] || ""}`;
  const class_name = custom_class && typeof custom_class.subscribe === "function" ?
    computed(custom_class, (value) => [base_class, value].filter(Boolean).join(" ")) :
    [base_class, custom_class].filter(Boolean).join(" ");
  const clean_up = () => {
    unlisten?.();
    model.destroy();
    state_.destroy?.();
    class_name.destroy?.();
    onUnmounted?.();
  };

  if (href !== undefined) {
    // Timeless 没有 Slot / asChild 机制，`href` 是「长得像按钮的链接」的等价能力。
    // <a> 没有 disabled：只能 aria-disabled + CSS pointer-events。
    const {
      disabled: _drop,
      type: _type,
      ...anchor_attributes
    } = attributes;
    return View({
      ...rest,
      class: atomic_classes(class_name),
      attributes: {
        n: attributes.n || "button",
        href: computed(href, (value) => String(source_value(value) ?? "")),
        ...anchor_attributes,
        "aria-disabled": computed(state_, (state) => state.disabled || state.loading ? "true" : undefined),
        "aria-busy": computed(state_, (state) => state.loading ? "true" : undefined),
      },
      onClick: provided_store ? undefined : onClick,
      onUnmounted: clean_up,
      style: {
        ...{
          "--active-transform-translatey-1-pixels": "translateY(1px)",
          "--focus-visible-outline-2-pixels-solid-color-focus": "2px solid var(--frui-color-focus)",
          "--focus-visible-outline-offset-2-pixels": "2px"
        },
        ...(rest)?.style
      }
    }, slots);
  }

  return ui.ButtonPrimitive.Root({
    ...rest,
    onClick: provided_store ? undefined : onClick,
    store: model.store,
    class: atomic_classes(class_name),
    attributes: {
      n: attributes.n || "button",
      type: attributes.type || "button",
      ...attributes,
      disabled: computed(state_, (state) => state.disabled || state.loading || undefined),
      "aria-busy": computed(state_, (state) => state.loading ? "true" : undefined),
    },
    onUnmounted: clean_up,
    style: {
      ...{
        "--active-transform-translatey-1-pixels": "translateY(1px)",
        "--focus-visible-outline-2-pixels-solid-color-focus": "2px solid var(--frui-color-focus)",
        "--focus-visible-outline-offset-2-pixels": "2px"
      },
      ...(rest)?.style
    }
  }, slots);
}

export {
  Button,
  ButtonViewModel,
  Button as FRButton,
  button_size
};
