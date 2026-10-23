import {
  atomic_classes
} from "./atomic.js";
const {
  Portal,
  Show,
  computed,
  ref
} = Timeless;
import {
  dispose_all,
  subscribe_source,
  source_value
} from "./shared.js";
import {
  frui_host
} from "./platform.js";
import {
  destroy_on_unmount
} from "./lifecycle.js";

function floating_root() {
  const root = frui_host.floating_root?.();
  return root?.ownerDocument && root !== root.ownerDocument.body ? root : null;
}

function floating_rect(rect) {
  const root = floating_root();
  if (!root) return rect;
  const origin = root.getBoundingClientRect();
  const scale_x = origin.width / root.offsetWidth || 1;
  const scale_y = origin.height / root.offsetHeight || 1;
  const x = ((rect.x ?? rect.left) - origin.left) / scale_x - (root.clientLeft || 0) + (root.scrollLeft || 0);
  const y = ((rect.y ?? rect.top) - origin.top) / scale_y - (root.clientTop || 0) + (root.scrollTop || 0);
  const width = rect.width / scale_x, height = rect.height / scale_y;
  return { x, y, left: x, top: y, right: x + width, bottom: y + height, width, height };
}

function FloatingModel({
  store,
  side = "bottom",
  align = "start",
  open: controlled_open,
  anchor,
  onOpenChange
} = {}) {
  const owned = !store;
  store ||= new vm.PopoverCore({
    side,
    align,
    strategy: "fixed",
    offsetY: 6,
    destroyOnClose: true
  });
  const popper = store.popper || store.popper$;
  const presence = store.presence || store.presence$;
  // 画板将 Portal 的 body 重定向到局部容器，几何和边界检测统一使用该容器的 CSS 坐标。
  const platform = popper.platform;
  popper.platform = {
    ...platform,
    getClippingRect(options) {
      const root = floating_root();
      return root ? {
        x: root.scrollLeft || 0, y: root.scrollTop || 0,
        width: root.clientWidth, height: root.clientHeight,
      } : platform.getClippingRect(options);
    },
    getScale(element) {
      return floating_root() ? { x: 1, y: 1 } : platform.getScale?.(element);
    },
  };
  const set_floating = popper.setFloating.bind(popper);
  popper.setFloating = element => set_floating(element && {
    ...element,
    getViewportRect: () => element.getRect(),
    getRect: () => floating_rect(element.getRect()),
  });
  popper.setConfig({
    strategy: "fixed",
    placement: `${side}-${align}`
  });
  let destroyed = false;
  const compute_position = popper.computePosition.bind(popper);
  popper.computePosition = async (...args) => {
    if (destroyed) return null;
    let position;
    try {
      position = await compute_position(...args);
    } catch (error) {
      if (destroyed) return null;
      throw error;
    }
    if (destroyed || !popper.floating) return null;
    const root = floating_root();
    const viewport = root ? { x: root.scrollLeft || 0, width: root.clientWidth } : frui_host.viewport?.();
    if (!position || !viewport || !popper.floating) return position;
    // 当前 Timeless shift 只约束放置轴，补齐横向视口边界。
    const left = (viewport.x || 0) + 8;
    position.x = Math.max(left, Math.min(position.x, (viewport.x || 0) + viewport.width - popper.floating.getRect().width - 8));
    return position;
  };
  const open = ref(Boolean(store.visible ?? store.open ?? store.state.open));
  const hide = () => {
    store.cancelShow?.();
    store.cancelHide?.();
    store.hide({
      reason: "manual"
    });
    if (store instanceof vm.MenuCore) presence.unmount();
  };
  let reference = null;
  let hover_timer = null;

  function cancel_hover() {
    if (hover_timer !== null) frui_host.clear_timeout(hover_timer);
    hover_timer = null;
  }

  function update() {
    const next = Boolean(store.visible ?? store.open ?? store.state.open);
    if (next === open.value) return;
    open.as(next);
    // 当前浮层没有退出动画，关闭时立即卸载，Presence 不保留可点击的旧内容。
    if (!owned && !next && !(store instanceof vm.MenuCore) && presence.mounted) presence.unmount();
    if (next) popper.place();
    onOpenChange?.(next);
  }
  const unlistens = [store.onStateChange(update), store.onShow?.(update), store.onHide?.(() => {
    update();
    presence.unmount();
  })];
  const sync_open = value => value ? store.show() : hide();
  unlistens.push(subscribe_source(controlled_open, sync_open));
  if (controlled_open?.value) sync_open(true);
  const focus_reference = () => (reference?.querySelector?.("button") || reference)?.focus?.();

  function set_reference(element) {
    if (!element) return;
    const virtual = typeof element.getRect === "function";
    if (!virtual && !element.getBoundingClientRect) return;
    reference = virtual ? element.$el : element;
    const get_viewport_rect = () => virtual ? element.getRect() : element.getBoundingClientRect();
    popper.setReference({
      ...(virtual ? element : { $el: element }),
      getViewportRect: get_viewport_rect,
      getRect: () => floating_rect(get_viewport_rect())
    }, {
      force: true
    });
    if (!owned) store.focus = focus_reference;
  }
  unlistens.push(subscribe_source(anchor, set_reference));
  set_reference(source_value(anchor));
  return {
    store,
    popper,
    presence,
    open,
    reference: set_reference,
    toggle() {
      if (open.value) hide();
      else store.show();
      update();
    },
    close(restore_focus = false) {
      cancel_hover();
      hide();
      update();
      if (restore_focus) focus_reference();
    },
    hover(visible) {
      cancel_hover();
      if (visible) {
        store.cancelHide?.();
        store.show();
      } else hover_timer = frui_host.set_timeout(() => {
        hover_timer = null;
        hide();
      }, 150);
    },
    destroy() {
      destroyed = true;
      cancel_hover();
      store.cancelShow?.();
      store.cancelHide?.();
      // 删除列表项会先销毁触发器；在取消订阅前关闭 Portal 内的菜单。
      hide();
      update();
      dispose_all(unlistens);
      presence.unmount();
      if (owned) store.unmount();
      else {
        presence.destroy();
        popper.destroy();
      }
      open.destroy?.();
      reference = null;
    },
  };
}

function FloatingTrigger(model, props = {}) {
  return {
    ...props,
    attributes: {
      type: "button",
      "aria-expanded": computed(model.open, String),
      ...props.attributes
    },
    onMounted(event) {
      model.reference(event.target?.get$elm?.() || event.target);
      return props.onMounted?.(event);
    },
    onClick(event) {
      props.onClick?.(event);
      if (event?.currentTarget) model.reference(event.currentTarget);
      model.toggle();
    },
    onKeyDown(event) {
      props.onKeyDown?.(event);
      if (event.defaultPrevented) return;
      if (event.key === "Escape") {
        event.stopPropagation();
        model.close(true);
        return;
      }
      if (!["Enter", " ", "ArrowDown"].includes(event.key)) return;
      event.preventDefault();
      if (event.key !== "ArrowDown" || !model.open.value) model.toggle();
    },
  };
}

function FloatingContent({
  model,
  render,
  class: custom_class,
  attributes = {},
  onKeyDown,
  onMounted,
  onDismiss = () => model.close(),
  ...rest
}) {
  // Primitive 的点击区域使用 clientX/clientY，触发器分支须保留视口坐标。
  const content_popper = new Proxy(model.popper, {
    get(target, key) {
      const value = Reflect.get(target, key, target);
      if (key === "reference" && value) return { ...value, getRect: value.getViewportRect };
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const render_content = () => destroy_on_unmount(ui.PopperPrimitive.Content({
    ...rest,
    style: {
      ...{
        "--max-width-calc-100-vw-16-pixels": "calc(100vw - 16px)",
        "--max-height-75-dynamic-vh": "75dvh"
      },
      ...({
        ...frui_host.floating_style,
        ...rest.style
      })
    },
    store: content_popper,
    class: atomic_classes([
      "box-sizing-border-box width-max-content max-width-calc-100-vw-16-pixels max-height-75-dynamic-vh overflow-auto right-auto bottom-auto",
      custom_class
    ].filter(Boolean).join(" ")),
    attributes: {
      n: "floating-content",
      ...attributes
    },
    onDismiss,
    onReferenceOutOfView() {
      model.close();
    },
    onMounted,
    onKeyDown(event) {
      onKeyDown?.(event);
      if (event.key === "Escape") {
        event.stopPropagation();
        if (model.open.value) model.close(true);
      }
    },
  }, render({
    close: () => model.close(true)
  })));
  return Portal({}, [model.store instanceof vm.MenuCore ?
    Show({
      when: model.open,
      ok: render_content
    }) :
    ui.PresencePrimitive.Presence({
      store: model.presence
    }, render_content)
  ]);
}

export {
  FloatingModel,
  FloatingTrigger,
  FloatingContent
};
