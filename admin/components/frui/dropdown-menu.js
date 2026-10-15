import {
  atomic_classes
} from "./atomic.js";
const {
  Fragment,
  View,
  Scope,
  createContext,
  provide,
  use,
  computed,
  combine,
  refobj
} = Timeless;
import {
  source_value,
  as_children,
  subscribe_source,
  dispose_all
} from "./shared.js";
import {
  FloatingModel,
  FloatingTrigger,
  FloatingContent
} from "./floating.js";
import {
  button_size
} from "./button.js";

const menu_context = createContext("frui-dropdown-menu", null);

function DropdownMenuModel({
  side = "bottom",
  align = "start",
  ...props
} = {}) {
  const store = new vm.DropdownMenuCore({
    side,
    align,
    trigger: "click",
    offsetY: 6
  });
  const floating = FloatingModel({
    ...props,
    store: store.menu,
    side,
    align
  });
  return {
    ...floating,
    destroy() {
      floating.destroy();
      store.unmount();
    }
  };
}

function DropdownMenuSessionModel(floating, parent) {
  const children = new Set();
  let focused_item = null;
  const core = floating.store instanceof vm.MenuCore ? floating.store : null;
  // Portal 子菜单属于同一菜单，用根浮层的 branches 一次处理整组 outside。
  const layer = parent ? parent.layer : new vm.DismissableLayerCore();
  const model = {
    floating,
    layer,
    enter() {
      core?.handleEnter();
    },
    register_item(item) {
      if (!core) return;
      core.items.push(item);
      core.listen_item(item);
      return () => {
        const index = core.items.indexOf(item);
        if (index >= 0) core.items.splice(index, 1);
      };
    },
    focus_item(item) {
      if (focused_item !== item) focused_item?.blur();
      focused_item = item;
    },
    close_submenus_except(element) {
      for (const child of children) {
        if (element === undefined || child.floating.popper.reference?.$el !== element) child.floating.close();
      }
    },
    hover(visible) {
      if (visible) core?.handleEnter();
      floating.hover(visible);
      if (parent?.parent) parent.hover(visible);
    },
    parent,
    mount() {
      if (parent) return;
      layer.register();
      return () => layer.unregister();
    },
    destroy() {
      unlisten?.();
      remove_branch?.();
      parent?.remove(model);
      model.close_submenus_except();
      if (!parent) {
        layer.unregister();
        layer.destroy();
      }
      floating.destroy();
    },
    add(child) {
      children.add(child);
    },
    remove(child) {
      children.delete(child);
    },
  };
  parent?.add(model);
  const remove_branch = parent ? layer.addBranch(() => floating.open.value ? floating.popper.floating?.getRect() : null) : null;
  if (!parent) {
    layer.setRect(() => floating.popper.floating?.getRect());
    layer.addBranch(() => floating.popper.reference?.getRect());
    layer.onDismiss(() => floating.close());
  }
  const unlisten = subscribe_source(floating.open, open => {
    if (open) parent?.close_submenus_except(floating.popper.reference?.$el);
    else model.close_submenus_except();
  });
  return model;
}

function DropdownMenuItemModel({
  disabled,
  menu_store,
  ...props
} = {}, parent) {
  const store = new vm.MenuItemCore({
    label: "",
    menu: menu_store,
    disabled: Boolean(source_value(disabled, false))
  });
  const state = refobj(store.state);
  const unlistens = [parent?.register_item(store), store.onStateChange(value => state.as(value)),
    subscribe_source(disabled, value => value ? store.disable() : store.enable())
  ];
  return {
    store,
    state,
    handle(event_name, event, primitive_handler) {
      if (state.value.disabled) return;
      if (event_name === "onMouseEnter" || event_name === "onFocus") parent?.enter();
      primitive_handler?.(event);
      if (event_name === "onMouseEnter" || event_name === "onFocus") {
        parent?.focus_item(store);
        parent?.close_submenus_except(event?.currentTarget);
      }
      return props[event_name]?.(event);
    },
    destroy() {
      dispose_all(unlistens);
      store.destroy();
      state.destroy?.();
    },
  };
}

function DropdownMenuItem({
  class: custom_class,
  attributes = {},
  icon,
  menu_store,
  onUnmounted,
  variant = "quiet",
  size,
  ...props
} = {}, children = []) {
  const parent = use(menu_context);
  const model = DropdownMenuItemModel({
    ...props,
    menu_store
  }, parent);
  const view = ui.DropdownMenuPrimitive.Item({
    ...props,
    as: "button",
    store: model.store,
    class: atomic_classes(combine({
      state: model.state,
      custom: custom_class
    }, ({
      state,
      custom
    }) => [
      `box-sizing-border-box font-inherit display-inline-flex align-items-center justify-content-center gap-space-2 min-height-control-height border-0 border-radius-radius-control padding-0-space-3 background-color-surface-raised color-color-text font-family-font-family font-size-button-font-size line-height-1-4 cursor-pointer transition-background-motion-fast-transform-motion-fast hover-background-color-surface-hover active-transform-translatey-1-pixels disabled-cursor-not-allowed disabled-opacity-6 focus-visible-outline-2-pixels-solid-color-focus focus-visible-outline-offset-2-pixels where-a-text-decoration-none where-a-aria-disabled-true-pointer-events-none where-a-aria-disabled-true-opacity-6  ${{"primary":"background-color-primary color-color-on-primary font-weight-700 hover-background-color-primary-hover","quiet":"background-transparent","danger":"background-transparent color-color-danger hover-background-color-danger-bg","ghost":"background-transparent hover-background-color-surface-hover","link":"min-height-auto padding-0 background-transparent color-color-link font-weight-650 hover-background-transparent hover-text-decoration-underline active-transform-none"}[variant] || ""}  ${{"medium":"frui-button-height-control-height-md min-height-button-height padding-0-space-3 font-size-button-font-size","small":"frui-button-height-control-height-sm min-height-button-height padding-0-space-2 font-size-font-size-sm","large":"frui-button-height-control-height-lg min-height-button-height padding-0-space-4 font-size-font-size-lg"}[button_size(size)] || ""}  border-0 display-flex align-items-center gap-space-2 width-100-percent border-radius-radius-sm padding-space-2-space-3 color-color-text font-family-font-family font-size-font-size text-align-left cursor-pointer hover-background-color-surface-hover focus-visible-outline-2-pixels-solid-color-focus focus-visible-outline-offset-negative-2-pixels justify-content-flex-start`,
      state.focused ? "background-color-surface-hover" : null,
      state.disabled ? "cursor-not-allowed opacity-5" : null, custom,
    ].filter(Boolean).join(" "))),
    attributes: {
      n: "dropdown-item",
      role: "menuitem",
      type: "button",
      ...attributes,
      disabled: computed(model.state, state => state.disabled || undefined),
      "aria-disabled": computed(model.state, state => state.disabled ? "true" : undefined),
      "data-highlighted": computed(model.state, state => state.focused ? "" : undefined),
      "data-state": menu_store ? computed(model.state, state => state.open ? "open" : "closed") : undefined,
    },
    onUnmounted() {
      model.destroy();
      onUnmounted?.();
    },
    style: {
      ...{
        "--active-transform-translatey-1-pixels": "translateY(1px)",
        "--focus-visible-outline-2-pixels-solid-color-focus": "2px solid var(--frui-color-focus)",
        "--focus-visible-outline-offset-2-pixels": "2px",
        "--focus-visible-outline-offset-negative-2-pixels": "-2px"
      },
      ...(props)?.style
    }
  }, [
    icon === undefined ? null : View({
      class: "display-inline-flex flex-none",
      attributes: {
        n: "button-icon",
        "aria-hidden": "true"
      }
    }, as_children(icon)),
    View({
      class: "flex-1 min-width-0 display-flex align-items-center justify-content-flex-start gap-space-2 text-align-left",
      attributes: {
        n: "button-content"
      }
    }, children),
  ].filter(Boolean));
  const events = {
    ...view.events
  };
  for (const event_name of ["onClick", "onMouseEnter", "onMouseLeave", "onFocus", "onBlur"]) {
    view.events[event_name] = event => model.handle(event_name, event, events[event_name]);
  }
  return view;
}

function DropdownSubmenu({
  label,
  icon,
  onOpen,
  disabled,
  attributes = {},
  content,
  contentProps = {}
}) {
  const store = new vm.MenuCore({
    side: "right",
    align: "start"
  });
  const model = FloatingModel({
    store,
    side: "right",
    align: "start",
    onOpenChange: open => {
      if (open) onOpen?.();
    }
  });
  const menu = DropdownMenuSessionModel(model, use(menu_context));
  return DropdownMenu({
    model,
    menu,
    attributes,
    disabled,
    onUnmounted: () => store.unmount(),
    trigger: props => DropdownMenuItem({
      ...props,
      icon,
      disabled,
      menu_store: store,
      attributes: {
        ...props.attributes,
        role: "menuitem",
        "aria-haspopup": "menu"
      },
      onMouseEnter() {
        if (!source_value(disabled, false)) menu.hover(true);
      },
      onMouseLeave() {
        menu.hover(false);
      },
      onClick(event) {
        if (model.open.value) {
          event.preventDefault();
          return;
        }
        props.onClick?.(event);
      },
      onKeyDown(event) {
        if (["ArrowRight", "Enter", " ", "ArrowDown"].includes(event.key)) menu.parent?.enter();
        if (event.key !== "ArrowRight") {
          props.onKeyDown?.(event);
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        if (!source_value(disabled, false) && !model.open.value) model.toggle();
      },
    }, [View({
      class: "flex-1 min-width-0 text-align-left",
      attributes: {
        n: "dropdown-submenu-label"
      }
    }, as_children(label)), Timeless.Icon({
      name: "chevron-right",
      size: 16,
      attributes: {
        n: "dropdown-submenu-chevron",
        "aria-hidden": "true"
      }
    })]),
    contentProps: {
      ...contentProps,
      attributes: {
        role: "menu",
        "aria-label": source_value(label),
        ...contentProps.attributes
      },
      onMouseEnter(event) {
        menu.hover(true);
        contentProps.onMouseEnter?.(event);
      },
      onMouseLeave(event) {
        menu.hover(false);
        contentProps.onMouseLeave?.(event);
      },
      onKeyDown(event) {
        contentProps.onKeyDown?.(event);
        if (event.key === "ArrowLeft") {
          event.preventDefault();
          event.stopPropagation();
          model.close(true);
        }
      },
    },
    content,
  });
}

function DropdownMenu(props = {}) {
  const {
    trigger,
    items = [],
    content,
    align = "start",
    side = "bottom",
    class: custom_class,
    attributes = {},
    onOpenChange,
    open,
    anchor,
    contentProps = {},
    model: provided_model,
    menu: provided_menu,
    onUnmounted,
    ...rest
  } = props;
  const model = provided_model || DropdownMenuModel({
    side,
    align,
    open,
    anchor,
    onOpenChange
  });
  const menu = provided_menu || DropdownMenuSessionModel(model, null);

  function make_item(item) {
    if (item.type === "separator") {
      return View({
        class: "height-1-pixels margin-space-1-0 background-color-border",
        attributes: {
          n: "dropdown-separator",
          role: "separator"
        },
        style: {
          ...{
            "--height-1-pixels": "1px"
          }
        }
      });
    }
    const disabled = item.disabled;
    const is_disabled = () => Boolean(source_value(disabled, false));
    const item_attributes = {
      n: `dropdown-item-${item.id}`,
      role: "menuitem",
      tabindex: computed(disabled, value => value ? "-1" : "0")
    };
    const run = () => {
      if (is_disabled()) return;
      model.close();
      item.onClick?.(item.id);
    };
    return DropdownMenuItem({
      disabled,
      class: atomic_classes([
        "border-0 display-flex align-items-center gap-space-2 width-100-percent border-radius-radius-sm padding-space-2-space-3 color-color-text font-family-font-family font-size-font-size text-align-left cursor-pointer hover-background-color-surface-hover focus-visible-outline-2-pixels-solid-color-focus focus-visible-outline-offset-negative-2-pixels justify-content-flex-start",
        item.danger ? "color-color-danger" : null,
      ].filter(Boolean).join(" ")),
      attributes: item_attributes,
      onClick: run,
      onKeyDown(event) {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        run();
      },
      style: {
        ...{
          "--focus-visible-outline-2-pixels-solid-color-focus": "2px solid var(--frui-color-focus)",
          "--focus-visible-outline-offset-negative-2-pixels": "-2px"
        }
      }
    }, [
      item.icon === undefined ?
      null :
      View({
        class: "",
        attributes: {
          n: "dropdown-item-icon",
          "aria-hidden": "true"
        }
      }, as_children(item.icon)),
      View({
        class: "flex-1 min-width-0 text-align-left",
        attributes: {
          n: "dropdown-item-label"
        }
      }, as_children(item.label)),
    ].filter(Boolean));
  }

  const trigger_props = FloatingTrigger(model, {
    ...rest,
    class: atomic_classes(["display-inline-flex", custom_class].filter(Boolean).join(" ")),
    attributes: {
      n: attributes.n || "dropdown-trigger",
      "aria-haspopup": contentProps.attributes?.role || (content === undefined ? "menu" : "dialog"),
      ...attributes
    },
  });

  return Fragment({
    onUnmounted() {
      menu.destroy();
      onUnmounted?.();
    },
  }, [
    trigger === undefined ? null : typeof trigger === "function" ? trigger(trigger_props) : View(trigger_props, as_children(trigger)),
    FloatingContent({
      ...contentProps,
      model,
      class: atomic_classes([
        "min-width-160-pixels border-0 border-radius-radius-control padding-space-1 background-color-surface-raised box-shadow-shadow-card",
        contentProps.class
      ].filter(Boolean).join(" ")),
      onDismiss: null,
      attributes: {
        n: "dropdown-menu",
        role: content === undefined ? "menu" : "dialog",
        "aria-label": content === undefined ? undefined : attributes["aria-label"] || "更多操作",
        ...contentProps.attributes
      },
      onMounted(event) {
        const unmount = menu.mount();
        const cleanup = contentProps.onMounted?.(event);
        if (!contentProps.onMounted)(event.target?.get$elm?.() || event.target)?.querySelector('[role="menuitem"],button,input')
          ?.focus();
        return () => {
          unmount?.();
          if (typeof cleanup === "function") cleanup();
        };
      },
      onMouseMove(event) {
        contentProps.onMouseMove?.(event);
        const item = event.target?.closest?.('[role^="menuitem"]');
        if (item) menu.close_submenus_except(item);
      },
      onKeyDown(event) {
        contentProps.onKeyDown?.(event);
        if (event.defaultPrevented || !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
        const items = [...(event.currentTarget?.querySelectorAll?.('[role^="menuitem"]') || [])]
          .filter(item => !item.disabled && item.getAttribute("aria-disabled") !== "true");
        if (!items.length) return;
        event.preventDefault();
        const index = items.indexOf(event.target?.closest?.('[role^="menuitem"]'));
        const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 :
          event.key === "ArrowDown" ? (index + 1) % items.length : (index + items.length - 1) % items.length;
        menu.close_submenus_except(items[next]);
        items[next]?.focus();
      },
      render: ({
        close
      }) => Scope(() => provide(menu_context, menu), () => content === undefined ? items.map(make_item) : as_children(
        typeof content === "function" ? content({
          close
        }) : content)),
      style: {
        ...{
          "--min-width-160-pixels": "160px"
        },
        ...(contentProps)?.style
      }
    }),
  ].filter(Boolean));
}

export {
  DropdownMenu,
  DropdownMenuModel,
  DropdownMenuItem,
  DropdownSubmenu
};
