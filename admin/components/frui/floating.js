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
    if (destroyed) return null;
    const viewport = frui_host.viewport?.();
    if (!position || !viewport || !popper.floating) return position;
    // 当前 Timeless shift 只约束放置轴，补齐横向视口边界。
    position.x = Math.max(8, Math.min(position.x, viewport.width - popper.floating.getRect().width - 8));
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
    popper.setReference(virtual ? element : {
      $el: element,
      getRect: () => element.getBoundingClientRect()
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
    store: model.popper,
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
