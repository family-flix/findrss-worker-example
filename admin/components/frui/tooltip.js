import {
  atomic_classes
} from "./atomic.js";
const {
  View,
  For,
  ref,
  computed
} = Timeless;
import {
  as_children,
  next_uid,
  source_value
} from "./shared.js";
import {
  frui_host
} from "./platform.js";

function TooltipSessionModel() {
  const store = new vm.TooltipCore({
    strategy: "fixed"
  });
  const content = ref([]);
  const id = next_uid("frui-tooltip");
  let active = null;
  let warm = false;
  let cooldown = null;

  function clear_cooldown() {
    if (cooldown !== null) frui_host.clear_timeout(cooldown);
    cooldown = null;
  }

  function release(model) {
    if (active !== model) return;
    store.hide();
    clear_cooldown();
    // 留出节点之间的移动时间，连续查看提示时不重复等待。
    cooldown = frui_host.set_timeout(() => {
      warm = false;
      cooldown = null;
    }, 300);
  }
  return {
    store,
    content,
    id,
    is_warm() {
      return warm;
    },
    activate(model) {
      const previous = active;
      active = model;
      warm = true;
      clear_cooldown();
      if (previous !== model) {
        previous?.dismiss();
        content.as([{
          id: model.id,
          content: model.content
        }]);
      }
      store.popper.setConfig({
        placement: model.side + (model.align === "center" ? "" : `-${model.align}`)
      });
      store.popper.setReference(model.reference, {
        force: true
      });
      store.show();
    },
    release,
    hover(value) {
      active?.hover(value);
    },
    dismiss() {
      active?.dismiss();
    },
    detach(model) {
      if (active !== model) return;
      release(model);
      active = null;
      content.as([]);
    },
    destroy() {
      active?.dismiss();
      active = null;
      clear_cooldown();
      content.as([]);
      content.destroy?.();
      store.unmount();
    },
  };
}

// 单例状态不归某个触发节点的动态渲染作用域所有。
let tooltip_session = TooltipSessionModel();

function get_tooltip_session() {
  if (!tooltip_session) tooltip_session = TooltipSessionModel();
  return tooltip_session;
}

function TooltipViewModel({
  content,
  side,
  align
}) {
  const session = get_tooltip_session();
  let hovered = false;
  let focused = false;
  let dismissed = false;
  let pending = null;

  function cancel_pending() {
    if (pending !== null) frui_host.clear_timeout(pending);
    pending = null;
  }

  function show() {
    cancel_pending();
    session.activate(model);
  }

  function hide() {
    cancel_pending();
    session.release(model);
  }

  function update(kind, value) {
    if (kind === "hover") hovered = value;
    else focused = value;
    if (value) dismissed = false;
    if (dismissed || (!hovered && !focused)) {
      hide();
      return;
    }
    if (focused || session.is_warm()) {
      show();
      return;
    }
    if (pending === null) pending = frui_host.set_timeout(show, 1000);
  }
  const model = {
    id: next_uid("tooltip-trigger"),
    content,
    side,
    align,
    reference: null,
    hover(value) {
      update("hover", value);
    },
    focus(value) {
      update("focus", value);
    },
    dismiss() {
      dismissed = true;
      hide();
    },
    set_reference(element) {
      model.reference = {
        $el: element,
        getRect: () => element.getBoundingClientRect()
      };
    },
    destroy() {
      cancel_pending();
      session.detach(model);
    },
  };
  return model;
}

// 组合根挂载一次；所有触发节点共用这一个 Portal 与 Popper。
function TooltipHost({
  style
} = {}) {
  const session = get_tooltip_session();
  const portal = ui.TooltipPrimitive.Portal({
    store: session.store,
    style,
    class: ""
  }, [
    View({
      class: "display-inline-flex align-items-center gap-space-2 max-width-min-320-pixels-calc-100-vw-16-pixels border-0 border-radius-radius-sm padding-6-pixels-space-2 background-color-text color-color-canvas box-shadow-shadow-card font-font-size-sm-1-5-font-family overflow-wrap-anywhere",
      attributes: {
        n: "tooltip-content",
        id: session.id,
        role: "tooltip"
      },
      onMouseEnter() {
        session.hover(true);
      },
      onMouseLeave() {
        session.hover(false);
      },
      style: {
        ...{
          "--max-width-min-320-pixels-calc-100-vw-16-pixels": "min(320px,calc(100vw - 16px))",
          "--padding-6-pixels-space-2": "6px var(--frui-space-2)"
        }
      }
    }, [For({
      each: session.content,
      key: "id",
      render: item => View({
        as: "span",
        style: {
          display: "contents"
        },
        attributes: {
          n: "tooltip-body"
        }
      }, as_children(source_value(item).content))
    })]),
  ]);
  portal.children[0].state.attributes.n = "tooltip-positioner";
  return View({
    style: {
      display: "contents"
    },
    attributes: {
      n: "tooltip-host"
    },
    onMounted() {
      return frui_host.listen_document?.("keydown", event => {
        if (event.key === "Escape") session.dismiss();
      });
    },
    onUnmounted() {
      session.destroy();
      tooltip_session = null;
    },
  }, [portal]);
}

function Tooltip(props = {}, children = []) {
  const {
    content,
    as = "span",
    side = "top",
    align = "center",
    class: custom_class,
    attributes = {},
    renderTrigger = View,
    onMounted,
    onUnmounted,
    ...rest
  } = props;
  const model = TooltipViewModel({
    content,
    side,
    align
  });
  const tooltip_id = get_tooltip_session().id;
  const triggers = as_children(children);
  for (const trigger of triggers) {
    if (trigger?.state?.attributes) {
      const attributes = trigger.state.attributes;
      attributes["aria-describedby"] = [attributes["aria-describedby"], tooltip_id].filter(Boolean).join(" ");
    }
  }
  return renderTrigger({
    ...rest,
    as,
    class: atomic_classes(["display-inline-flex align-items-center", custom_class].filter(Boolean).join(" ")),
    attributes: {
      n: attributes.n || "tooltip-trigger",
      ...attributes,
      "aria-describedby": [attributes["aria-describedby"], tooltip_id].filter(Boolean).join(" ")
    },
    onMouseEnter() {
      model.hover(true);
    },
    onMouseLeave() {
      model.hover(false);
    },
    onClick() {
      model.dismiss();
    },
    onMounted(event) {
      const cleanup = onMounted?.(event);
      const element = event.target?.get$elm?.() || event.target;
      if (!element) return cleanup;
      model.set_reference(element);
      const focus = () => model.focus(true);
      const blur = event => {
        if (!element.contains(event.relatedTarget)) model.focus(false);
      };
      element.addEventListener("focusin", focus);
      element.addEventListener("focusout", blur);
      return () => {
        element.removeEventListener("focusin", focus);
        element.removeEventListener("focusout", blur);
        if (typeof cleanup === "function") cleanup();
      };
    },
    onUnmounted() {
      model.destroy();
      onUnmounted?.();
    },
  }, triggers);
}

function button_tooltip(control, state) {
  const button = control.state.attributes["aria-label"] !== undefined ? control : control.children[0];
  const tooltip = Tooltip({
    content: computed(state, () => button.state.attributes["aria-label"]),
    side: "bottom",
    attributes: {
      n: `${button.state.attributes.n}-tooltip`
    },
  }, [button]);
  if (button === control) return tooltip;
  control.children[0] = tooltip;
  return control;
}

export {
  Tooltip,
  TooltipHost,
  button_tooltip
};
