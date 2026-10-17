import { atomic_classes } from "../../components/frui/atomic.js";

const { View, computed } = window.FindRSSAdminUI;

// KeepAlive retains the view; route visibility owns loading and draft cleanup.
function SettingsSection({ view, history, name, loading, start, leave, destroy, class: custom_class }, children) {
  let stop_route, stop_hide, active = false;
  function activate() {
    if (active) return;
    active = true;
    return start();
  }
  function deactivate() {
    if (!active) return;
    active = false;
    leave();
  }
  return View({
    class: atomic_classes(["box-border grid min-w-0 gap-space-3", custom_class].filter(Boolean).join(" ")),
    attributes: { n: name, "aria-busy": loading ? computed(loading, String) : undefined },
    onMounted() {
      stop_route = history?.onRouteChange(event => {
        if (event.view === view) void activate();
      });
      stop_hide = view?.onBeforeHide(deactivate);
      void activate();
    },
    onUnmounted() {
      stop_route?.();
      stop_hide?.();
      deactivate();
      destroy?.();
    },
  }, children);
}

export { SettingsSection };
