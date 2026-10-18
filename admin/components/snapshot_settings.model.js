import { PollPolicyModel } from "./poll_policy.model.js";
import { DEFAULT_SNAPSHOT_CONCURRENCY, MAX_SNAPSHOT_CONCURRENCY } from "../../server/lib/constants.js";

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
    max_concurrency = ui.ref(String(DEFAULT_SNAPSHOT_CONCURRENCY)),
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
        max_concurrency.set(String(result.max_concurrency ?? DEFAULT_SNAPSHOT_CONCURRENCY));
        loaded.set(true);
      } catch (failure) {
        if (current === generation) error.set(failure.message);
      } finally {
        if (current === generation) loading.set(false);
      }
    },
    save() {
      if (!loaded.value || loading.value || busy.value) return;
      const concurrency = Number(max_concurrency.value);
      if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > MAX_SNAPSHOT_CONCURRENCY) {
        error.set("最大并发抓取数必须为 1 至 " + MAX_SNAPSHOT_CONCURRENCY + " 的整数");
        message.set("");
        return;
      }
      const current = generation;
      busy.set(true);
      error.set("");
      message.set("");
      pending_save = (async () => {
        try {
          const result = await request_json("/admin/api/settings/snapshots", {
            method: "PUT",
            body: JSON.stringify({ policy: editor.methods.value(), max_concurrency: concurrency }),
          });
          if (current !== generation) return;
          editor.methods.reset(result.policy);
          max_concurrency.set(String(result.max_concurrency ?? concurrency));
          message.set("订阅源抓取设置已保存");
        } catch (failure) {
          if (current === generation) error.set(failure.message);
        } finally {
          busy.set(false);
        }
      })();
      return pending_save;
    },
    set_max_concurrency(value) { max_concurrency.set(value); },
    leave() {
      generation++;
      loading.set(false);
      loaded.set(false);
      error.set("");
      message.set("");
      editor.methods.reset();
      max_concurrency.set(String(DEFAULT_SNAPSHOT_CONCURRENCY));
    },
  };
  return { editor, state: { loading, loaded, busy, max_concurrency, error, message }, methods };
}
