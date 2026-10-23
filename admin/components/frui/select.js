import {
  atomic_classes
} from "./atomic.js";
const {
  View,
  For,
  computed,
  ref
} = Timeless;
import {
  SelectViewModel
} from "./select.model.js";
import {
  next_uid,
  as_children
} from "./shared.js";
import {
  FloatingModel,
  FloatingTrigger,
  FloatingContent
} from "./floating.js";

function Select({
  value,
  defaultValue,
  defaultOpen,
  options,
  disabled,
  placeholder,
  onChange,
  render_value,
  render_option,
  attributes = {},
  class: custom_class,
  style
} = {}) {
  const model = SelectViewModel({
    value,
    defaultValue,
    defaultOpen,
    options,
    disabled,
    placeholder,
    onChange
  });
  const {
    store,
    state,
    items
  } = model;
  const popup_width = ref("auto");
  const floating = FloatingModel({
    store,
    onOpenChange(open) { if (open) sync_popup_width(); }
  });
  function sync_popup_width() {
    const width = floating.popper.reference?.getRect().width;
    if (Number.isFinite(width) && width > 0 && popup_width.value !== `${width}px`) {
      popup_width.set(`${width}px`);
    }
  }
  const unlisten_width = floating.popper.onStateChange(sync_popup_width);
  const name = attributes.n || "select",
    id = attributes.id || next_uid("frui-select");
  const option_id = item => `${id}-option-${String(item.value)}`;
  return View({
    style,
    class: "box-sizing-border-box width-100-percent max-width-100-percent min-width-0",
    attributes: {
      n: `${name}-root`
    },
    onUnmounted() {
      unlisten_width();
      floating.destroy();
      model.destroy();
      popup_width.destroy?.();
    }
  }, [ui.SelectPrimitive.Root({
    store,
    attributes: {
      n: `${name}-primitive`
    }
  }, [
    View({
      ...FloatingTrigger(floating, {
        as: "button",
        class: atomic_classes([
          "box-sizing-border-box width-100-percent min-width-0 min-height-control-height border-1-pixels-solid-color-border border-radius-8-pixels padding-0-10-pixels background-color-color-surface color-color-text font-400-font-size-1-4-font-family transition-background-color-motion-fast-border-color-motion-fast-box-shadow-motion-fast placeholder-color-color-placeholder placeholder-opacity-1 aria-invalid-true-frui-control-focus-color-color-danger aria-invalid-true-border-color-color-danger not-disabled-hover-border-color-control-focus-color-color-border-strong focus-border-color-control-focus-color-color-focus focus-visible-border-color-control-focus-color-color-focus focus-outline-none focus-box-shadow-0-0-0-3-pixels-color-mix-in-srgb-control-focus-color-color-focus-24-percent-transparent focus-visible-outline-none focus-visible-box-shadow-0-0-0-3-pixels-color-mix-in-srgb-control-focus-color-color-focus-24-percent-transparent disabled-cursor-not-allowed disabled-opacity-6 media-forced-colors-active-focus-outline-2-pixels-solid-highlight media-forced-colors-active-focus-outline-offset-2-pixels media-prefers-reduced-motion-reduce-transition-none",
          "data-placeholder-true-color-color-placeholder aria-expanded-true-border-color-control-focus-color-color-focus aria-expanded-true-outline-none aria-expanded-true-box-shadow-0-0-0-3-pixels-color-mix-in-srgb-control-focus-color-color-focus-24-percent-transparent display-flex align-items-center justify-content-space-between gap-space-2 text-align-start cursor-pointer not-disabled-hover-background-color-color-mix-in-srgb-color-surface-hover-35-percent-color-surface aria-expanded-true-background-color-color-mix-in-srgb-color-surface-hover-35-percent-color-surface active-transform-none media-forced-colors-active-aria-expanded-true-outline-2-pixels-solid-highlight media-forced-colors-active-aria-expanded-true-outline-offset-2-pixels",
          "", custom_class
        ].filter(Boolean).join(" ")),
        attributes: {
          ...attributes,
          n: name,
          id,
          type: "button",
          role: "combobox",
          "aria-haspopup": "listbox",
          "aria-controls": `${id}-popup`,
          "aria-expanded": computed(state, next => String(next.open)),
          "data-placeholder": computed(model.is_placeholder, next => String(next)),
          "aria-activedescendant": computed(model.focused, next => next === undefined ? undefined : option_id({
            value: next
          })),
          disabled: computed(state, next => next.disabled || undefined)
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
            "--aria-expanded-true-box-shadow-0-0-0-3-pixels-color-mix-in-srgb-control-focus-color-color-focus-24-percent-transparent": "0 0 0 3px color-mix(in srgb,var(--frui-control-focus-color, var(--frui-color-focus)) 24%,transparent)",
            "--media-forced-colors-active-aria-expanded-true-outline-2-pixels-solid-highlight": "2px solid Highlight",
            "--media-forced-colors-active-aria-expanded-true-outline-offset-2-pixels": "2px"
          }
        }
      }),
      onKeyDown: model.handle_key,
    }, [
      View({
        class: "flex-1 min-width-0 overflow-hidden text-overflow-ellipsis white-space-nowrap",
        attributes: {
          n: `${name}-value`
        }
      }, render_value ? as_children(render_value({
        state,
        label: model.label,
        placeholder: model.is_placeholder
      })) : [model.label]),
      View({
        class: "display-inline-flex align-items-center justify-content-center flex-none min-width-16-pixels min-height-16-pixels color-color-muted",
        attributes: {
          n: `${name}-chevron`,
          "aria-hidden": "true"
        },
        style: {
          ...{
            "--min-width-16-pixels": "16px",
            "--min-height-16-pixels": "16px"
          }
        }
      }, [Timeless.Icon({
        name: "chevron-down",
        size: 16
      })]),
    ]),
    FloatingContent({
      model: floating,
      class: "z-index-70 min-width-0 max-width-calc-100-vw-16-pixels max-height-min-320-pixels-60-dynamic-vh overflow-y-auto padding-space-1 border-radius-radius-card background-color-surface-raised color-color-text box-shadow-shadow-card font-font-size-1-4-font-family",
      attributes: {
        n: `${name}-popup`,
        id: `${id}-popup`,
        role: "listbox",
        "aria-label": attributes["aria-label"] || placeholder || "请选择"
      },
      onKeyDown: model.handle_key,
      render: () => [For({
        each: items,
        key: "value",
        render(raw) {
          const item = raw?.__is_ref ? raw.value : raw;
          const label = computed(state, () => item.label);
          return View({
            as: "button",
            class: atomic_classes(computed(state, () =>
              `box-sizing-border-box display-flex align-items-center justify-content-space-between gap-space-2 width-100-percent max-width-100-percent min-width-0 min-height-control-height border-0 border-radius-radius-control padding-0-space-3 background-transparent color-inherit font-inherit text-align-start cursor-pointer not-disabled-hover-background-color-surface-hover disabled-opacity-6 disabled-cursor-not-allowed active-transform-none${item.selected ? " background-color-selected color-color-link" : ""}${item.focused ? " background-color-surface-hover" : ""}`
              )),
            attributes: {
              n: `${name}-option-${item.value}`,
              id: option_id(item),
              type: "button",
              role: "option",
              tabindex: -1,
              "aria-selected": computed(state, () => String(item.selected)),
              disabled: computed(state, () => item.disabled || undefined)
            },
            onClick() {
              model.select(item);
              store.focus();
            },
            onMouseEnter() {
              store.handleMouseEnterItem(item);
            },
            style: { "padding-block": "var(--frui-space-1)" },
          }, [
            View({
              class: "flex-1 min-width-0 white-space-normal overflow-wrap-anywhere",
              attributes: {
                n: `${name}-option-label`
              }
            }, render_option ? as_children(render_option({
              value: item.value,
              label
            })) : [label]),
            View({
              class: "display-inline-flex align-items-center justify-content-center flex-none min-width-16-pixels min-height-16-pixels color-color-muted",
              attributes: {
                n: `${name}-option-check`,
                "aria-hidden": "true"
              },
              style: {
                ...{
                  "--min-width-16-pixels": "16px",
                  "--min-height-16-pixels": "16px"
                },
                ...({
                  visibility: computed(state, () => item.selected ? "visible" : "hidden")
                })
              }
            }, [Timeless.Icon({
              name: "check",
              size: 16
            })]),
          ]);
        }
      })],
      style: {
        width: popup_width,
        ...{
          "--max-width-calc-100-vw-16-pixels": "calc(100vw - 16px)",
          "--max-height-min-320-pixels-60-dynamic-vh": "min(320px,60dvh)"
        }
      }
    }),
  ])]);
}

export {
  Select
};
