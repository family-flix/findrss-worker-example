import {
  atomic_classes
} from "./atomic.js";
const {
  Show,
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
import {
  frui_host
} from "./platform.js";

function TabsViewModel({
  items,
  value,
  onChange
}) {
  const fallback = items.find(item => !item.disabled)?.id ?? "";
  const current_ = ref(source_value(value, fallback) ?? fallback);
  const indicator = ref({
    "--frui-tabs-indicator-display": "none"
  });
  let element = null;
  let observer = null;
  let frame = null;
  let positioned = false;

  function measure() {
    if (!element) return;
    const index = items.findIndex(item => item.id === current_.value);
    const active = element.querySelectorAll('[role="tab"]')[index];
    if (!active || !active.offsetWidth || !active.offsetHeight) {
      indicator.as({
        "--frui-tabs-indicator-display": "none"
      });
      positioned = false;
      return;
    }
    const style = frui_host.get_computed_style(element);
    const vertical = style.flexDirection === "column";
    const container = element.getBoundingClientRect();
    const tab = active.getBoundingClientRect();
    const size = Math.min(parseFloat(style.getPropertyValue("--frui-tabs-indicator-size")) || 32, vertical ? tab.height : tab.width);
    const thickness = 4;
    const left = tab.left - container.left + element.scrollLeft - element.clientLeft;
    const top = tab.top - container.top + element.scrollTop - element.clientTop;
    indicator.as({
      "--frui-tabs-indicator-display": "block",
      "--frui-tabs-indicator-x": `${left + (vertical ? tab.width - thickness : (tab.width - size) / 2)}px`,
      "--frui-tabs-indicator-y": `${top + (vertical ? (tab.height - size) / 2 : tab.height - thickness)}px`,
      "--frui-tabs-indicator-width": `${vertical ? thickness : size}px`,
      "--frui-tabs-indicator-height": `${vertical ? size : thickness}px`,
      "--frui-tabs-indicator-transition": positioned ? "transform var(--frui-motion-fast)" : "none",
    });
    positioned = true;
  }

  function schedule() {
    if (!element || frame !== null) return;
    if (!frui_host.request_frame) {
      measure();
      return;
    }
    frame = frui_host.request_frame(() => {
      frame = null;
      measure();
    });
  }
  const unlistens = [
    subscribe_source(value, (next) => {
      if (next !== current_.value) current_.as(next);
    }),
    current_.subscribe({
      onChange: schedule
    }),
  ];

  function select(id) {
    if (items.find(item => item.id === id)?.disabled) return;
    if (id === current_.value) return;
    current_.as(id);
    if (value && typeof value.as === "function") value.as(id);
    else if (value && typeof value.set === "function") value.set(id);
    onChange?.(id);
  }

  return {
    current: current_,
    indicator,
    select,
    mount(list) {
      element = list;
      if (!element) return;
      measure();
      observer = frui_host.observe_resize?.(schedule);
      observer?.observe(element);
      for (const tab of element.querySelectorAll('[role="tab"]')) observer?.observe(tab);
    },
    destroy() {
      if (frame !== null) frui_host.cancel_frame?.(frame);
      element = null;
      observer?.disconnect();
      dispose_all(unlistens);
      indicator.destroy?.();
      current_.destroy?.();
    },
  };
}

function TabsView(props = {}) {
  const {
    items = [],
      value,
      onChange,
      class: custom_class,
      attributes = {},
      listProps = {}, panelProps = {}, tabClass = "",
      onUnmounted,
      ...rest
  } = props;
  const model = TabsViewModel({
    items,
    value,
    onChange
  });
  const tabs = items.map((item) => {
    const active_ = computed(model.current, (id) => id === item.id);
    const disabled = item.disabled === true;
    return View({
      class: atomic_classes(computed(active_, (active) => [
        "border-0 position-relative min-width-tabs-indicator-size padding-space-2-2-pixels color-color-muted font-family-font-family font-size-font-size text-align-center cursor-pointer hover-color-color-text focus-visible-outline-2-pixels-solid-color-focus focus-visible-outline-offset-2-pixels aria-disabled-true-color-color-muted aria-disabled-true-cursor-not-allowed aria-disabled-true-opacity-6 aria-disabled-true-hover-color-color-muted flex-shrink-0",
        active ? "color-color-text font-weight-650" : "", disabled ?
        "color-color-muted cursor-not-allowed opacity-6 hover-color-color-muted" : "", tabClass
      ].filter(Boolean).join(" "))),
      attributes: {
        n: `tab-${item.id}`,
        role: "tab",
        tabindex: disabled ? "-1" : "0",
        "aria-disabled": disabled ? "true" : "false",
        "aria-selected": computed(active_, (active) => active ? "true" : "false"),
      },
      onClick() {
        if (!disabled) model.select(item.id);
      },
      onKeyDown(event) {
        if (disabled) return;
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        model.select(item.id);
      },
      style: {
        ...{
          "--padding-10-pixels-12-pixels": "10px 12px",
          "--padding-space-2-2-pixels": "var(--frui-space-2) 2px",
          "--focus-visible-outline-2-pixels-solid-color-focus": "2px solid var(--frui-color-focus)",
          "--focus-visible-outline-offset-2-pixels": "2px"
        }
      }
    }, as_children(item.label));
  });

  // 每个面板各自 Show：Show 只在「真值变假值」时重建，用整块切换会拿不到内容更新。
  const panels = items.map((item) => Show({
    when: computed(model.current, (id) => id === item.id),
    ok() {
      return View({
        ...panelProps,
        class: atomic_classes(["color-color-text font-font-size-1-6-font-family empty-display-none", panelProps.class].filter(
          Boolean).join(" ")),
        attributes: {
          n: `tabs-panel-${item.id}`,
          role: "tabpanel"
        }
      }, as_children(item.content));
    },
  }));

  return View({
    ...rest,
    class: atomic_classes(["display-grid gap-space-3", custom_class].filter(Boolean).join(" ")),
    attributes: {
      n: attributes.n || "tabs",
      ...attributes
    },
    onUnmounted() {
      model.destroy();
      onUnmounted?.();
    },
  }, [
    View({
      ...listProps,
      class: atomic_classes([
        "position-relative display-flex align-items-center gap-space-4 border-bottom-1-pixels-solid-color-border after-position-absolute after-top-0 after-left-0 after-display-tabs-indicator-display-none after-width-tabs-indicator-width after-height-tabs-indicator-height after-border-radius-radius-pill after-background-color-primary after-transform-translate-tabs-indicator-x-tabs-indicator-y after-transition-tabs-indicator-transition-none after-pointer-events-none after-content media-prefers-reduced-motion-reduce-after-transition-none overflow-x-auto white-space-nowrap",
        listProps.class
      ].filter(Boolean).join(" ")),
      attributes: {
        n: "tabs-list",
        role: "tablist"
      },
      style: computed(computed(model.indicator, value => ({
        ...listProps.style,
        ...value
      })), value => ({
        ...{
          "--border-bottom-1-pixels-solid-color-border": "1px solid var(--frui-color-border)"
        },
        ...value
      })),
      onMounted(event) {
        model.mount(event.target?.get$elm?.() || event.target);
      },
    }, tabs),
    ...panels,
  ]);
}

// 沿用组件库的渲染和选中状态，补齐语义标识、面板关联与方向键操作。
function Tabs({
  items = [],
  orientation = "horizontal",
  size = "default",
  ...props
}) {
  const view = TabsView({
    ...props,
    items,
    class: atomic_classes(["min-width-0", props.class].filter(Boolean).join(" ")),
    tabClass: [size === "large" ? "min-height-control-height-lg font-size-font-size-lg" : "", orientation === "vertical" ?
      "padding-10-pixels-12-pixels text-align-start" : ""
    ].join(" "),
    listProps: {
      ...props.listProps,
      class: atomic_classes([orientation === "vertical" ? "flex-direction-column align-items-stretch border-bottom-0 gap-space-2" : "",
        props.listProps?.class
      ].filter(Boolean).join(" ")),
      style: {
        ...{
          "--padding-10-pixels-12-pixels": "10px 12px"
        },
        ...props.listProps?.style
      }
    },
    onChange(value) {
      sync_tabindex(value);
      props.onChange?.(value);
    },
    onUnmounted() {
      unsubscribe?.();
      props.onUnmounted?.();
    },
  });
  const list = view.children[0];
  const tabs = list.children;
  const prefix = props.attributes?.n || "tabs";
  Object.assign(list.state.attributes, {
    n: `${prefix}-list`,
    "aria-label": props.attributes?.["aria-label"],
    "aria-orientation": orientation,
  });

  function sync_tabindex(value) {
    const found = items.findIndex((item) => item.id === value && !item.disabled);
    const active = found >= 0 ? found : items.findIndex(item => !item.disabled);
    tabs.forEach((tab, index) => {
      const tabindex = index === active && !items[index].disabled ? "0" : "-1";
      tab.state.attributes.tabindex = tabindex;
      tab.$elm?.setAttribute("tabindex", tabindex);
    });
  }
  const unsubscribe = props.value?.subscribe?.({
    onChange: sync_tabindex
  });
  tabs.forEach((tab, index) => {
    const item = items[index];
    Object.assign(tab.state.attributes, {
      n: `${prefix}-${item.id}`,
      id: `${prefix}-${String(item.id).replace(/[^A-Za-z0-9_-]/g, "-")}`,
      "aria-controls": item.panel_id,
      ...item.attributes,
    });
    const original_keydown = tab.events.onKeyDown;
    tab.events.onKeyDown = (event) => {
      const step = orientation === "vertical" ?
        {
          ArrowDown: 1,
          ArrowUp: -1,
          ArrowRight: 1,
          ArrowLeft: -1
        } :
        {
          ArrowRight: 1,
          ArrowLeft: -1
        };
      const enabled = items.map((item, item_index) => item.disabled ? -1 : item_index).filter(item_index => item_index >= 0);
      const next = event.key === "Home" ? enabled[0] : event.key === "End" ? enabled.at(-1) :
        step[event.key] ? enabled[(enabled.indexOf(index) + step[event.key] + enabled.length) % enabled.length] : null;
      if (next === undefined) return;
      if (next === null) return original_keydown(event);
      event.preventDefault();
      tabs[next].events.onClick(event);
      event.currentTarget.parentElement.querySelector(`#${tabs[next].state.attributes.id}`)?.focus();
    };
  });
  sync_tabindex(props.value?.value ?? items[0]?.id);
  return view;
}

export {
  Tabs
};
