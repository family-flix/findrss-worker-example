import { AISettingsStore } from "../components/ai_settings.js";

function SettingsModel({ ui = window.FindRSSAdminUI, request_json = async (url, options = {}) => {
  const response = await window.FindRSSAdminAuth.fetch(url, {
    credentials: "same-origin", cache: "no-store", ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
  });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || "请求失败：HTTP " + response.status);
  return value;
}, new_id } = {}) {
  const settings = ui.ref({ providers: [] });
  const loading = ui.ref(false), loaded = ui.ref(false), error = ui.ref("");
  const store = AISettingsStore({ ui, settings, request_json, new_id,
    can_save: () => loaded.value && !loading.value });
  let generation = 0;
  const methods = {
    async start() {
      if (loading.value || store.state.settings_busy.value) return;
      const current = ++generation;
      loading.set(true); loaded.set(false); error.set("");
      store.clear_keys();
      try {
        const value = await request_json("/admin/api/scripts/agent/settings");
        if (current !== generation) return;
        settings.as(value); loaded.set(true);
      } catch (failure) {
        if (current === generation) error.set(failure.message || String(failure));
      } finally {
        if (current === generation) loading.set(false);
      }
    },
    leave() {
      generation++; loaded.set(false); loading.set(false); error.set(""); store.clear_keys();
    },
    destroy() { methods.leave(); store.destroy(); },
  };
  return { state: { settings, loading, loaded, error }, store, methods };
}

export { SettingsModel };
