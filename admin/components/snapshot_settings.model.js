import { PollPolicyModel } from "./poll_policy.model.js";

export function SnapshotSettingsModel({
  ui,
  request_json = async (url, options = {}) => {
    const response = await window.FindRSSAdminAuth.fetch(url, {
      credentials: "same-origin",
      cache: "no-store",
      ...options,
      headers: { "Content-Type": "application/json", ...options.headers },
    });
    const result = await response.json();
    if (!response.ok)
      throw new Error(result.error || "请求失败：HTTP " + response.status);
    return result;
  },
}) {
  const editor = PollPolicyModel({ ui, inherit: false });
  const loading = ui.ref(false),
    loaded = ui.ref(false),
    busy = ui.ref(false),
    error = ui.ref(""),
    message = ui.ref("");
  let generation = 0,
    pending_save = null;
  const methods = {
    async start() {
      if (loading.value) return;
      const current = ++generation;
      loading.set(true);
      loaded.set(false);
      error.set("");
      message.set("");
      try {
        if (pending_save) await pending_save;
        if (current !== generation) return;
        const result = await request_json("/admin/api/settings/snapshots");
        if (current !== generation) return;
        editor.methods.reset(result.policy);
        loaded.set(true);
      } catch (failure) {
        if (current === generation) error.set(failure.message);
      } finally {
        if (current === generation) loading.set(false);
      }
    },
    save() {
      if (!loaded.value || loading.value || busy.value) return;
      const current = generation;
      busy.set(true);
      error.set("");
      message.set("");
      pending_save = (async () => {
        try {
          const result = await request_json("/admin/api/settings/snapshots", {
            method: "PUT",
            body: JSON.stringify({ policy: editor.methods.value() }),
          });
          if (current !== generation) return;
          editor.methods.reset(result.policy);
          message.set("订阅源抓取规则已保存");
        } catch (failure) {
          if (current === generation) error.set(failure.message);
        } finally {
          busy.set(false);
        }
      })();
      return pending_save;
    },
    leave() {
      generation++;
      loading.set(false);
      loaded.set(false);
      error.set("");
      message.set("");
      editor.methods.reset();
    },
  };
  return { editor, state: { loading, loaded, busy, error, message }, methods };
}
