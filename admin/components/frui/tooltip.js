import { atomic_classes } from "./atomic.js";
import { as_children, next_uid, source_value } from "./shared.js";
import { frui_host } from "./platform.js";

const { View, For, ref } = Timeless;

function TooltipSessionModel() {
  const store = new vm.TooltipCore({ strategy: "fixed" });
  const content = ref([]);
  const id = next_uid("frui-tooltip");
  let active = null;
  function release(model) {
    if (active === model) store.hide();
  }
  return {
    store, content, id,
    activate(model) {
      const previous = active;
      active = model;
      if (previous !== model) {
        previous?.dismiss();
        content.as([{ id: model.id, content: model.content }]);
      }
      store.popper.setConfig({ placement: model.side + (model.align === "center" ? "" : `-${model.align}`) });
      store.popper.setReference(model.reference, { force: true });
      store.show();
    },
    release,
    hover(value) { active?.hover(value); },
    dismiss() { active?.dismiss(); },
    detach(model) {
      if (active !== model) return;
      release(model);
      active = null;
      content.as([]);
    },
    destroy() {
      active?.dismiss();
      active = null;
      content.as([]);
      content.destroy?.();
      store.unmount();
    },
  };
}

// 共享会话在组合根创建，不归动态列表触发节点的渲染作用域所有。
let tooltip_session = TooltipSessionModel();
function get_tooltip_session() {
  if (!tooltip_session) tooltip_session = TooltipSessionModel();
  return tooltip_session;
}

function TooltipViewModel({ content, side, align }) {
  const session = get_tooltip_session();
  let hovered = false;
  let focused = false;
  let dismissed = false;
  function update(kind, value) {
    if (kind === "hover") hovered = value;
    else focused = value;
    if (value) dismissed = false;
    if (dismissed || (!hovered && !focused)) session.release(model);
    else session.activate(model);
  }
  const model = {
    id: next_uid("tooltip-trigger"), content, side, align, reference: null,
    hover(value) { update("hover", value); },
    focus(value) { update("focus", value); },
    dismiss() { dismissed = true; session.release(model); },
    set_reference(element) {
      model.reference = { $el: element, getRect: () => element.getBoundingClientRect() };
    },
    destroy() { session.detach(model); },
  };
  return model;
}

// Shell 挂载一次，所有触发节点共用一个 Portal 和 Popper。
function TooltipHost() {
  const session = get_tooltip_session();
  const portal = ui.TooltipPrimitive.Portal({ store: session.store, style: frui_host.floating_style, class: "" }, [
    ui.Transition({
      store: session.store.presence,
      animation: { in: "animate-tooltip-in", out: "animate-tooltip-out pointer-events-none" },
      class: "inline-flex items-center gap-space-2 max-width-min-320-pixels-calc-100-vw-16-pixels border-0 border-radius-radius-sm padding-6-pixels-space-2 background-color-surface-raised color-color-text box-shadow-shadow-card font-font-size-sm-1-5-font-family overflow-wrap-anywhere media-prefers-reduced-motion-reduce-animation-duration",
      style: {
        "--max-width-min-320-pixels-calc-100-vw-16-pixels": "min(320px,calc(100vw - 16px))",
        "--padding-6-pixels-space-2": "6px var(--frui-space-2)",
        "--tooltip-enter": "frui-tooltip-in 120ms ease-out both",
        "--tooltip-exit": "frui-tooltip-out 100ms ease-in both",
        "--media-prefers-reduced-motion-reduce-animation-duration": "1ms",
      },
      attributes: { n: "tooltip-content", id: session.id, role: "tooltip" },
      onMouseEnter() { session.hover(true); },
      onMouseLeave() { session.hover(false); },
    }, [For({ each: session.content, key: "id", render(item) {
      return View({ class: "contents", attributes: { n: "tooltip-body" } }, as_children(source_value(item).content));
    } })]),
  ]);
  portal.children[0].state.attributes.n = "tooltip-positioner";
  return View({
    class: "contents", attributes: { n: "tooltip-host" },
    onMounted() {
      return frui_host.listen_document?.("keydown", event => {
        if (event.key === "Escape") session.dismiss();
      });
    },
    onUnmounted() { session.destroy(); tooltip_session = null; },
  }, [portal]);
}

function Tooltip(props = {}, children = []) {
  const { content, as = "span", side = "top", align = "center", class: custom_class,
    attributes = {}, renderTrigger = View, onMounted, onUnmounted, ...rest } = props;
  const model = TooltipViewModel({ content, side, align });
  const tooltip_id = get_tooltip_session().id;
  const triggers = as_children(children);
  for (const trigger of triggers) {
    if (trigger?.state?.attributes) {
      const attrs = trigger.state.attributes;
      attrs["aria-describedby"] = [attrs["aria-describedby"], tooltip_id].filter(Boolean).join(" ");
    }
  }
  return renderTrigger({
    ...rest, as,
    class: atomic_classes(["inline-flex items-center", custom_class].filter(Boolean).join(" ")),
    attributes: { n: attributes.n || "tooltip-trigger", ...attributes,
      "aria-describedby": [attributes["aria-describedby"], tooltip_id].filter(Boolean).join(" ") },
    onMouseEnter() { model.hover(true); },
    onMouseLeave() { model.hover(false); },
    onClick() { model.dismiss(); },
    onMounted(event) {
      const cleanup = onMounted?.(event);
      const element = event.target?.get$elm?.() || event.target;
      if (!element) return cleanup;
      model.set_reference(element);
      const focus = () => model.focus(true);
      const blur = event => { if (!element.contains(event.relatedTarget)) model.focus(false); };
      element.addEventListener("focusin", focus);
      element.addEventListener("focusout", blur);
      return () => {
        element.removeEventListener("focusin", focus);
        element.removeEventListener("focusout", blur);
        if (typeof cleanup === "function") cleanup();
      };
    },
    onUnmounted() { model.destroy(); onUnmounted?.(); },
  }, triggers);
}

export { Tooltip, TooltipHost };
