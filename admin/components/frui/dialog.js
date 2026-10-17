import {
  atomic_classes
} from "./atomic.js";
import {
  frui_host
} from "./platform.js";
const {
  View
} = Timeless;
import {
  source_value,
  subscribe_source,
  dispose_all,
  as_children
} from "./shared.js";

function DialogViewModel({
  open,
  title,
  footer,
  maskClosable,
  mask,
  onClose
}) {
  const controlled = open !== undefined && (typeof open === "object" || typeof open === "boolean");
  // DialogCore 是 ES class（`xi=class extends _t`），必须 `new`——用 `vm.ButtonCore`/`vm.InputCore`
  // 的写法套过来会抛 "Class constructor xi cannot be invoked without 'new'"。
  // SwitchCore 是普通工厂函数（`function Sl(e)`），照旧不加 `new`。
  const store = new vm.DialogCore({
    open: Boolean(source_value(open, false)),
    title: source_value(title),
    footer: footer !== undefined,
    closeable: maskClosable !== false,
    mask: mask !== false,
  });
  let was_open = Boolean(store.state.open || store.presence.state.visible);
  let suppress_close = false;
  const unlistens = [store.onStateChange((state) => {
    if (state.open || (state.visible && !state.exit)) {
      was_open = true;
      return;
    }
    if (!was_open) return;
    was_open = false;
    if (!suppress_close) onClose?.();
    suppress_close = false;
  })];
  if (controlled) {
    unlistens.push(subscribe_source(open, (value) => {
      const next = Boolean(value);
      if (next === Boolean(store.presence.state.visible && !store.presence.state.exit)) return;
      if (next) {
        suppress_close = false;
        store.show();
        return;
      }
      // 外部把 open 置回 false：由调用方发起的关闭，不再回头调 onClose。
      suppress_close = true;
      store.hide();
    }));
  }

  /** 用户主动关闭：收起内部 state，通知交给上面的 StateChange 分支统一发。 */
  function request_close() {
    store.hide();
  }

  return {
    store,
    request_close,
    destroy() {
      dispose_all(unlistens);
      store.destroy?.();
      store.presence?.destroy?.();
    },
  };
}

function Dialog(props = {}, children = []) {
  const {
    open,
    title,
    description,
    footer,
    closable = true,
    maskClosable = true,
    mask = true,
    class: custom_class,
    attributes = {},
    onClose,
    onUnmounted,
    headerProps = {},
    bodyProps = {},
    footerProps = {},
    overlayProps = {},
    closeProps = {},
    ...rest
  } = props;

  const model = DialogViewModel({
    open,
    title,
    footer,
    maskClosable,
    mask,
    onClose
  });
  const store = model.store;

  function handle_keydown(event) {
    if (event.key !== "Escape" || !maskClosable) return;
    if (!store.presence.state.visible) return;
    event.stopPropagation();
    model.request_close();
  }
  const unlisten_keydown = frui_host.listen_document?.("keydown", handle_keydown);

  const header = title === undefined && description === undefined ?
    null :
    ui.DialogPrimitive.Header({
      ...headerProps,
      class: atomic_classes(["margin-bottom-space-3 padding-right-space-5", headerProps.class].filter(Boolean).join(" ")),
      attributes: {
        n: "dialog-header"
      }
    }, [
      ui.DialogPrimitive.Title({
        class: "font-size-font-size-lg font-weight-700",
        attributes: {
          n: "dialog-title"
        }
      }, as_children(title)),
      description === undefined ?
      null :
      View({
        class: "margin-top-space-1 color-color-muted font-size-font-size-sm",
        attributes: {
          n: "dialog-description"
        }
      }, as_children(description)),
    ].filter(Boolean));

  return ui.DialogPrimitive.Root({
    store,
    onUnmounted() {
      unlisten_keydown?.();
      model.destroy();
      onUnmounted?.();
    },
  }, [
    mask ?
    ui.DialogPrimitive.Overlay({
      store,
      ...overlayProps,
      class: atomic_classes(["position-fixed inset-0 z-index-300 background-color-overlay", overlayProps.class].filter(Boolean).join(
        " ")),
      attributes: {
        n: "dialog-overlay",
        "aria-hidden": "true"
      },
    }) :
    null,
    ui.DialogPrimitive.Content({
      ...rest,
      store,
      class: atomic_classes([
        "position-fixed top-50-percent left-50-percent z-index-301 width-min-480-pixels-calc-100-vw-32-pixels max-height-85-vh overflow-auto transform-translate-negative-50-percent-negative-50-percent border-0 border-radius-radius-card padding-space-4 background-color-surface color-color-text box-shadow-shadow-card outline-none",
        custom_class
      ].filter(Boolean).join(" ")),
      attributes: {
        n: attributes.n || "dialog",
        role: "dialog",
        "aria-modal": "true",
        tabindex: "-1",
        ...attributes
      },
      onMounted(event) {
        // Esc 挂在 document 上，焦点仍留在触发元素上时也能生效；主动把焦点收进来更好。
        const elm = event?.target?.get$elm ? event.target.get$elm() : null;
        elm?.focus?.();
        return rest.onMounted?.(event);
      },
      style: {
        ...{
          "--width-min-480-pixels-calc-100-vw-32-pixels": "min(480px,calc(100vw - 32px))",
          "--max-height-85-vh": "85vh"
        },
        ...(rest)?.style
      }
    }, [
      header,
      View({
        ...bodyProps,
        class: atomic_classes(["", bodyProps.class].filter(Boolean).join(" ")),
        attributes: {
          n: "dialog-body"
        }
      }, as_children(children)),
      footer === undefined ?
      null :
      ui.DialogPrimitive.Footer({
        ...footerProps,
        class: atomic_classes(["display-flex justify-content-flex-end gap-space-2 margin-top-space-3", footerProps.class].filter(
          Boolean).join(" ")),
        attributes: {
          n: "dialog-footer"
        }
      }, as_children(footer)),
      closable ?
      View({
        ...closeProps,
        class: atomic_classes([
          "border-0 position-absolute top-space-3 right-space-3 border-radius-radius-sm padding-4-pixels-8-pixels color-color-muted line-height-1 cursor-pointer hover-background-color-surface-hover hover-color-color-text focus-visible-outline-2-pixels-solid-color-focus focus-visible-outline-offset-2-pixels",
          closeProps.class
        ].filter(Boolean).join(" ")),
        attributes: {
          n: "dialog-close",
          role: "button",
          tabindex: "0",
          "aria-label": "关闭"
        },
        onClick: model.request_close,
        onKeyDown(event) {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          model.request_close();
        },
        style: {
          ...{
            "--padding-4-pixels-8-pixels": "4px 8px",
            "--focus-visible-outline-2-pixels-solid-color-focus": "2px solid var(--frui-color-focus)",
            "--focus-visible-outline-offset-2-pixels": "2px"
          },
          ...(closeProps)?.style
        }
      }, ["×"]) :
      null,
    ].filter(Boolean)),
  ].filter(Boolean));
}

export {
  Dialog
};
