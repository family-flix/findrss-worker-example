import {
  source_value
} from "./shared.js";

function ModalViewModel({
  onClose,
  busy,
  initialFocus = "input, textarea, select, button, [tabindex]"
}) {
  let element = null,
    trigger = null;

  function close() {
    if (!source_value(busy, false)) onClose?.();
  }
  return {
    close,
    mount(event) {
      element = event.target?.get$elm?.() || event.target;
      trigger = element.ownerDocument.activeElement;
      (element.querySelector(initialFocus) || element).focus();
    },
    unmount() {
      if (trigger?.isConnected) trigger.focus();
      element = null;
      trigger = null;
    },
    keydown(event) {
      if (event.key === "Escape" && !event.defaultPrevented) {
        event.preventDefault();
        event.stopPropagation();
        close();
      }
      if (event.key !== "Tab" || !element || event.defaultPrevented) return;
      const controls = [...element.querySelectorAll('button, input, textarea, select, a[href], [tabindex]')]
        .filter(node => !node.disabled && node.tabIndex >= 0 && node.getClientRects().length);
      const first = controls[0],
        last = controls.at(-1),
        current = element.ownerDocument.activeElement;
      if (!first) {
        event.preventDefault();
        element.focus();
      } else if (event.shiftKey && (current === first || current === element)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (current === last || current === element)) {
        event.preventDefault();
        first.focus();
      }
    },
  };
}

export {
  ModalViewModel
};
