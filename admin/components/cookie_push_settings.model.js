export function CookiePushSettingsModel({ ui, request_json = async (url, options = {}) => {
  const response = await window.FindRSSAdminAuth.fetch(url, {
    credentials: "same-origin", cache: "no-store", ...options,
    headers: { "Content-Type": "application/json" },
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "请求失败：HTTP " + response.status);
  return result;
} }) {
  const uuid = ui.ref(""), password = ui.ref(""), configured = ui.ref(false);
  const loading = ui.ref(false), loaded = ui.ref(false), busy = ui.ref(false), error = ui.ref(""), message = ui.ref("");
  let generation = 0, pending_save;
  const apply = result => { uuid.set(result.uuid); configured.set(result.configured); password.set(""); };
  const methods = {
    async start() {
      if (loading.value) return;
      const current = ++generation;
      loading.set(true); loaded.set(false); error.set(""); message.set(""); password.set("");
      try {
        if (pending_save) await pending_save;
        if (current !== generation) return;
        const result = await request_json("/admin/api/settings/cookies");
        if (current !== generation) return;
        apply(result); loaded.set(true);
      } catch (failure) {
        if (current === generation) error.set(failure.message);
      } finally {
        if (current === generation) loading.set(false);
      }
    },
    set_uuid(value) { if (loaded.value && !busy.value) uuid.set(value); },
    set_password(value) { if (loaded.value && !busy.value) password.set(value); },
    save() {
      if (!loaded.value || loading.value || busy.value) return;
      const current = generation;
      busy.set(true); error.set(""); message.set("");
      pending_save = (async () => {
        try {
          const result = await request_json("/admin/api/settings/cookies", {
            method: "PUT", body: JSON.stringify({ uuid: uuid.value, password: password.value }),
          });
          if (current !== generation) return;
          apply(result); message.set("Cookie 解密设置已保存，立即生效");
        } catch (failure) {
          if (current === generation) error.set(failure.message);
        } finally { busy.set(false); }
      })();
      return pending_save;
    },
    leave() {
      generation++; uuid.set(""); password.set(""); configured.set(false);
      loading.set(false); loaded.set(false); error.set(""); message.set("");
    },
  };
  return { state: { uuid, password, configured, loading, loaded, busy, error, message }, methods };
}
