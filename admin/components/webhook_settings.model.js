export function WebhookSettingsModel({ ui, request_json = async (url, options = {}) => {
  const response = await window.FindRSSAdminAuth.fetch(url, {
    credentials: "same-origin", cache: "no-store", ...options,
    headers: { "Content-Type": "application/json" },
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "请求失败：HTTP " + response.status);
  return result;
} }) {
  const url = ui.ref(""), token = ui.ref(""), template = ui.ref(""), token_configured = ui.ref(false);
  const loading = ui.ref(false), loaded = ui.ref(false), busy = ui.ref(false), error = ui.ref(""), message = ui.ref("");
  let generation = 0, pending_save;
  const apply = result => {
    url.set(result.url); template.set(result.template); token_configured.set(result.token_configured); token.set("");
  };
  const methods = {
    async start() {
      if (loading.value) return;
      const current = ++generation;
      loading.set(true); loaded.set(false); error.set(""); message.set(""); token.set("");
      try {
        if (pending_save) await pending_save;
        if (current !== generation) return;
        const result = await request_json("/admin/api/settings/webhook");
        if (current !== generation) return;
        apply(result); loaded.set(true);
      } catch (failure) {
        if (current === generation) error.set(failure.message);
      } finally {
        if (current === generation) loading.set(false);
      }
    },
    set_url(value) { if (loaded.value && !busy.value) url.set(value); },
    set_token(value) { if (loaded.value && !busy.value) token.set(value); },
    set_template(value) { if (loaded.value && !busy.value) template.set(value); },
    save() {
      if (!loaded.value || loading.value || busy.value) return;
      const current = generation;
      busy.set(true); error.set(""); message.set("");
      pending_save = (async () => {
        try {
          const result = await request_json("/admin/api/settings/webhook", {
            method: "PUT", body: JSON.stringify({ url: url.value, token: token.value, template: template.value }),
          });
          if (current !== generation) return;
          apply(result); message.set(result.url ? "Webhook 设置已保存，立即生效" : "Webhook 推送已关闭");
        } catch (failure) {
          if (current === generation) error.set(failure.message);
        } finally { busy.set(false); }
      })();
      return pending_save;
    },
    leave() {
      generation++; url.set(""); token.set(""); template.set(""); token_configured.set(false);
      loading.set(false); loaded.set(false); error.set(""); message.set("");
    },
  };
  return { state: { url, token, template, token_configured, loading, loaded, busy, error, message }, methods };
}
