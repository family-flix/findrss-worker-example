import {
  atomic_classes
} from "./frui/atomic.js";
const {
  View,
  Show,
  For,
  ref,
  computed
} = Timeless;
import {
  source_value
} from "./frui/shared.js";
import {
  Input
} from "./frui/input.js";
import {
  FloatingModel,
  FloatingTrigger,
  FloatingContent
} from "./frui/floating.js";
import {
  AIProviderLogo
} from "./ai-provider-logo.js";

function XiaoxunModelSelectModel(pet) {
  const search = new vm.InputCore({
    defaultValue: "",
    placeholder: "搜索模型…",
    ignoreEnterEvent: true
  });
  const store = new vm.SelectCore({
    position: "popper",
    defaultValue: pet.dialogue().model_key || null,
    placeholder: "选择模型",
    search
  });
  const state = ref(store.state);
  const groups = ref([]);
  let all_groups = [],
    all_options = [],
    previous_models;
  const items = new Map();
  let keyword = "",
    was_open = false;

  function filter() {
    const visible = all_groups.map(group => ({
      key: group.key,
      label: group.label,
      logo: group.logo,
      options: group.options.filter(option => !keyword || `${group.label} ${option.label} ${option.value}`.toLowerCase().includes(
        keyword)),
    })).filter(group => group.options.length);
    // 过滤键盘候选，保留完整分组与已选值，搜索不能被 SelectCore 当成删除模型。
    store.options = visible.flatMap(group => group.options);
    if (store.focused_item$ && !store.options.includes(store.focused_item$)) {
      store.focused_item$.setFocused(false);
      store.focused_item$ = null;
    }
    groups.set(visible);
    store.refresh();
  }

  function sync(value) {
    if (value.models !== previous_models) {
      previous_models = value.models;
      const providers = new Map();
      for (const model of value.models) {
        if (!providers.has(model.provider_id)) providers.set(model.provider_id, {
          label: model.provider_name,
          logo: model.provider_logo,
          options: []
        });
        let item = items.get(model.key);
        if (!item) {
          item = new vm.SelectItemCore({
            value: model.key,
            label: model.name
          });
          items.set(model.key, item);
        }
        item.disabled = !model.enabled;
        item.setLabel(model.name);
        providers.get(model.provider_id).options.push(item);
      }
      all_groups = [...providers].map(([key, provider]) => Object.assign(new vm.SelectGroupCore(provider), {
        key,
        logo: provider.logo
      }));
      all_options = all_groups.flatMap(group => group.options);
      for (const key of items.keys())
        if (!value.models.some(model => model.key === key)) items.delete(key);
      store.raw_options = all_groups;
    }
    store.value = value.model_key || null;
    store.selected_item$ = all_options.find(option => option.value === store.value) || null;
    for (const option of all_options) option.setSelected(option === store.selected_item$);
    store.disabled = value.busy || !value.models.length;
    if (value.busy && store.open) store.hide();
    filter();
  }
  const detach_state = store.onStateChange(value => {
    const opening = value.open && !was_open;
    was_open = value.open;
    if (opening) {
      store.enableSearch();
      search.setPlaceholder("搜索模型…");
      keyword = "";
      store.clearSearch();
      filter();
    }
    state.set(store.state);
  });
  const detach_search = store.onSearchChange(value => {
    if (!store.canSearch()) return;
    keyword = String(value || "").trim().toLowerCase();
    filter();
  });
  const detach_change = store.onChange(key => {
    pet.select_model(key);
    sync(pet.dialogue());
  });
  const detach_pet = pet.subscribe(sync);
  sync(pet.dialogue());
  return {
    store,
    search,
    state,
    groups,
    handle_key(event) {
      event.stopPropagation();
      if (event.isComposing || event.keyCode === 229) return;
      const action = {
        ArrowDown: () => store.focusNextOption(),
        ArrowUp: () => store.focusPrevOption(),
        Enter: () => store.selectFocusedOption(),
        Escape: () => store.hide()
      } [event.key];
      if (action) {
        event.preventDefault();
        action();
        if (!store.open) store.focus();
      }
    },
    destroy() {
      detach_pet();
      detach_state();
      detach_search();
      detach_change();
      pet.dispose?.();
      store.destroy();
      search.destroy?.();
      state.destroy?.();
      groups.destroy?.();
    },
  };
}

function XiaoxunModelSelect({
  pet,
  label = "切换对话模型",
  list_label = "对话模型"
}) {
  const model = XiaoxunModelSelectModel(pet);
  const {
    store,
    state,
    groups
  } = model;
  const floating = FloatingModel({
    store,
    side: "top"
  });

  function render_option(raw) {
    const option = raw?.__is_ref ? raw.value : raw;
    const item_state = ref(option.state);
    const detach = option.onStateChange(value => item_state.set(value));
    return ui.SelectPrimitive.Item({
      select$: store,
      item$: option,
      class: atomic_classes(computed(item_state, value =>
        "display-flex align-items-center justify-content-space-between width-100-percent gap-8-pixels padding-7-pixels-8-pixels border-0 border-radius-6-pixels background-transparent color-inherit text-align-left font-inherit cursor-pointer not-disabled-hover-background-color-surface-hover disabled-opacity-45 disabled-cursor-not-allowed focus-visible-outline-2-pixels-solid-color-focus focus-visible-outline-offset-negative-2-pixels" +
        (value.focused ? " not-disabled-background-color-surface-hover" : ""))),
      attributes: {
        n: `xiaoxun-model-option-${option.value}`,
        role: "option",
        "aria-selected": computed(item_state, value => String(value.selected)),
        "aria-disabled": computed(model.state, () => String(option.disabled)),
        disabled: computed(model.state, () => option.disabled || undefined),
      },
      onUnmounted() {
        detach();
        item_state.destroy?.();
      },
      style: {
        ...{
          "--gap-8-pixels": "8px",
          "--padding-7-pixels-8-pixels": "7px 8px",
          "--border-radius-6-pixels": "6px",
          "--focus-visible-outline-2-pixels-solid-color-focus": "2px solid var(--frui-color-focus)",
          "--focus-visible-outline-offset-negative-2-pixels": "-2px"
        }
      }
    }, [
      ui.SelectPrimitive.ItemText({
        attributes: {
          n: "xiaoxun-model-option-label"
        }
      }, [computed(model.state, () => option.label)]),
      ui.SelectPrimitive.ItemIndicator({
        store: option,
        class: "flex-none",
        attributes: {
          n: "xiaoxun-model-option-check",
          "aria-hidden": "true"
        }
      }, [Timeless.Icon({
        name: "check",
        size: 14
      })]),
    ]);
  }
  return View({
    class: "width-min-260-pixels-calc-100-percent-32-pixels-space-2 min-width-0",
    attributes: {
      n: "xiaoxun-model-select"
    },
    onUnmounted() {
      floating.destroy();
      model.destroy();
    },
    style: {
      ...{
        "--width-min-260-pixels-calc-100-percent-32-pixels-space-2": "min(260px,calc(100% - 32px - var(--frui-space-2)))"
      }
    }
  }, [
    ui.SelectPrimitive.Root({
      store,
      attributes: {
        n: "xiaoxun-model-select-root"
      }
    }, [
      View(FloatingTrigger(floating, {
        as: "button",
        class: "box-sizing-border-box width-100-percent min-width-0 min-height-control-height border-1-pixels-solid-color-border border-radius-8-pixels padding-0-10-pixels background-color-color-surface color-color-text font-400-font-size-1-4-font-family transition-background-color-motion-fast-border-color-motion-fast-box-shadow-motion-fast placeholder-color-color-placeholder placeholder-opacity-1 aria-invalid-true-frui-control-focus-color-color-danger aria-invalid-true-border-color-color-danger not-disabled-hover-border-color-control-focus-color-color-border-strong focus-border-color-control-focus-color-color-focus focus-visible-border-color-control-focus-color-color-focus focus-outline-none focus-box-shadow-0-0-0-3-pixels-color-mix-in-srgb-control-focus-color-color-focus-24-percent-transparent focus-visible-outline-none focus-visible-box-shadow-0-0-0-3-pixels-color-mix-in-srgb-control-focus-color-color-focus-24-percent-transparent disabled-cursor-not-allowed disabled-opacity-6 media-forced-colors-active-focus-outline-2-pixels-solid-highlight media-forced-colors-active-focus-outline-offset-2-pixels media-prefers-reduced-motion-reduce-transition-none data-placeholder-true-color-color-placeholder aria-expanded-true-border-color-control-focus-color-color-focus aria-expanded-true-outline-none aria-expanded-true-box-shadow-0-0-0-3-pixels-color-mix-in-srgb-control-focus-color-color-focus-24-percent-transparent display-flex align-items-center justify-content-space-between gap-space-2 text-align-start cursor-pointer not-disabled-hover-background-color-color-mix-in-srgb-color-surface-hover-35-percent-color-surface aria-expanded-true-background-color-color-mix-in-srgb-color-surface-hover-35-percent-color-surface active-transform-none media-forced-colors-active-aria-expanded-true-outline-2-pixels-solid-highlight media-forced-colors-active-aria-expanded-true-outline-offset-2-pixels padding-0-space-2 border-color-transparent background-color-transparent font-size-font-size-sm",
        attributes: {
          n: "xiaoxun-model-trigger",
          type: "button",
          role: "combobox",
          "aria-haspopup": "listbox",
          "aria-label": label,
          disabled: computed(state, value => value.disabled || undefined)
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
      }), [
        Show({
          when: computed(state, value => Boolean(value.value)),
          ok: () => AIProviderLogo({
            logo: computed(state, value => pet.dialogue().models.find(model => model.key === value.value)?.provider_logo || {
              initial: "?"
            }),
            attributes: {
              n: "xiaoxun-model-selected-provider-logo"
            },
          })
        }),
        View({
          class: "flex-1 min-width-0 overflow-hidden text-overflow-ellipsis white-space-nowrap text-align-left",
          attributes: {
            n: "xiaoxun-model-value"
          }
        }, [computed(state, value => value.selectedOption?.label || (value.value ? "模型不可用" : "选择模型"))]),
        View({
          class: "display-inline-flex align-items-center justify-content-center flex-none min-width-16-pixels min-height-16-pixels color-color-muted",
          attributes: {
            n: "xiaoxun-model-chevron",
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
      // Popper 写入内联层级，必须通过参数让 Portal 菜单高于桌宠的 10001。
      FloatingContent({
        model: floating,
        zIndex: 10002,
        class: "width-min-280-pixels-calc-100-vw-32-pixels max-height-min-340-pixels-50-dynamic-vh overflow-y-auto box-sizing-border-box padding-4-pixels border-1-pixels-solid-color-border border-radius-10-pixels background-color-surface color-color-text box-shadow-shadow-card font-13-pixels-font-family pointer-events-auto",
        attributes: {
          n: "xiaoxun-model-popup",
          role: "listbox",
          "aria-label": list_label
        },
        onKeyDown: model.handle_key,
        render: () => [
          Input({
            store: model.search,
            class: "min-width-0",
            attributes: {
              n: "xiaoxun-model-search",
              "aria-label": "搜索模型"
            },
            onMounted(event) {
              (event.target?.get$elm?.() || event.target)?.focus();
            },
            onKeyDown: event => model.handle_key(event),
          }),
          For({
            each: groups,
            key: "key",
            render(raw) {
              const group = source_value(raw);
              const label = computed(raw, value => source_value(value).label);
              return View({
                class: "not-first-child-margin-top-4-pixels not-first-child-border-top-1-pixels-solid-color-border not-first-child-padding-top-4-pixels",
                attributes: {
                  n: `xiaoxun-model-group-${group.key}`,
                  role: "group",
                  "aria-label": label
                },
                style: {
                  ...{
                    "--not-first-child-margin-top-4-pixels": "4px",
                    "--not-first-child-border-top-1-pixels-solid-color-border": "1px solid var(--frui-color-border)",
                    "--not-first-child-padding-top-4-pixels": "4px"
                  }
                }
              }, [
                View({
                  class: "display-flex align-items-center gap-8-pixels padding-6-pixels-8-pixels color-color-muted font-size-12-pixels",
                  attributes: {
                    n: "xiaoxun-model-provider"
                  },
                  style: {
                    ...{
                      "--gap-8-pixels": "8px",
                      "--padding-6-pixels-8-pixels": "6px 8px",
                      "--font-size-12-pixels": "12px"
                    }
                  }
                }, [
                  AIProviderLogo({
                    logo: computed(raw, value => source_value(value).logo),
                    attributes: {
                      n: "xiaoxun-model-provider-icon"
                    }
                  }),
                  View({
                    as: "span",
                    attributes: {
                      n: "xiaoxun-model-provider-name"
                    }
                  }, [label]),
                ]),
                For({
                  each: computed(raw, value => source_value(value).options),
                  key: "value",
                  render: render_option
                }),
              ]);
            }
          }),
          Show({
            when: computed(groups, value => !value.length),
            ok: () => View({
              class: "padding-20-pixels-10-pixels color-color-muted text-align-center",
              attributes: {
                n: "xiaoxun-model-empty",
                role: "status"
              },
              style: {
                ...{
                  "--padding-20-pixels-10-pixels": "20px 10px"
                }
              }
            }, ["没有匹配的模型"])
          }),
        ],
        style: {
          ...{
            "--width-min-280-pixels-calc-100-vw-32-pixels": "min(280px,calc(100vw - 32px))",
            "--max-height-min-340-pixels-50-dynamic-vh": "min(340px,50dvh)",
            "--padding-4-pixels": "4px",
            "--border-1-pixels-solid-color-border": "1px solid var(--frui-color-border)",
            "--border-radius-10-pixels": "10px",
            "--font-13-pixels-font-family": "13px var(--frui-font-family)"
          }
        }
      }),
    ]),
  ]);
}

export {
  XiaoxunModelSelectModel,
  XiaoxunModelSelect
};
