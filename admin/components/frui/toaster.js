import { frui_host } from "./platform.js";
import { Button } from "./button.js";

const { View, Portal, For, combine, ref } = Timeless;

const notification_message = ref("");
const notification_error = ref("");

function dismiss_notification() {
  notification_message.set("");
  notification_error.set("");
}

function notify(message, { error = false } = {}) {
  dismiss_notification();
  (error ? notification_error : notification_message).set(String(message || ""));
}

function Toaster({ message = notification_message, error = notification_error, onDismiss = dismiss_notification } = {}) {
  const timers = new Set();
  const notifications = combine({ message, error }, ({ message, error }) => {
    const text = error || message;
    return text ? [{ id: (error ? "error:" : "info:") + text, text, error: Boolean(error) }] : [];
  });
  return Portal({ onUnmounted() {
    for (const timer of timers) frui_host.clear_timeout(timer);
    timers.clear();
    if (message === notification_message && error === notification_error) dismiss_notification();
  } }, [
    View({ class: "box-border fixed grid pointer-events-none", style: {
      top: "max(var(--frui-space-4), env(safe-area-inset-top))",
      left: "50%", transform: "translateX(-50%)",
      width: "min(420px, calc(100vw - 2 * var(--frui-space-4)))",
      "z-index": "10004",
    }, attributes: { n: "toaster", "aria-live": "polite", "aria-relevant": "additions text" } }, [
      For({ each: notifications, key: "id", render(value) {
        const notification = value?.__is_ref ? value.value : value;
        let timer = null;
        return View({ class: "box-border flex items-center rounded-card bg-surface-raised pointer-events-auto", style: {
          gap: "var(--frui-space-3)", padding: "var(--frui-space-3) var(--frui-space-4)",
          border: "1px solid var(--frui-color-border)", "box-shadow": "var(--frui-shadow-card)",
          color: notification.error ? "var(--frui-color-danger)" : "var(--frui-color-success)",
        }, attributes: { n: "toast", role: notification.error ? "alert" : "status" },
        onMounted() {
          timer = frui_host.set_timeout(onDismiss, notification.error ? 8000 : 4000);
          timers.add(timer);
        },
        onUnmounted() {
          if (timer !== null) frui_host.clear_timeout(timer);
          timers.delete(timer);
        } }, [
          View({ class: "box-border flex-1 min-w-0 whitespace-pre-wrap break-anywhere" }, [notification.text]),
          Button({ variant: "quiet", size: "small", attributes: { n: "toast-dismiss", "aria-label": "关闭提示" },
            onClick: onDismiss }, ["关闭"]),
        ]);
      } }),
    ]),
  ]);
}

export { Toaster, notify };
