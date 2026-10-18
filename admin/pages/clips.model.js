import { PollPolicyModel } from "../components/poll_policy.model.js";
import { ClipModel } from "../../server/domain/clip.js";

export function clip_embed(clip, origin) {
  const url = new URL(clip.path, origin).href;
  return `<iframe src="${url}" title="${String(clip.title).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}" width="${clip.width || 800}" height="${clip.height || 600}" style="border:0;max-width:100%" loading="lazy" sandbox referrerpolicy="no-referrer"></iframe>`;
}

export function ClipsModel({ ui = window.FindRSSAdminUI, fetch_impl = (...args) => window.FindRSSAdminAuth.fetch(...args),
  origin = globalThis.location?.origin || "https://localhost", realtime = globalThis.window?.FindRSSAdminRealtime } = {}) {
  const state = {
    clips: ui.ref([]), page: ui.ref(1), loading: ui.ref(false), busy: ui.ref(false), error: ui.ref(""),
    renderer_available: ui.ref(true), form_open: ui.ref(false), editing_id: ui.ref(""), form_error: ui.ref(""),
    title: ui.ref(""), url: ui.ref(""), selector: ui.ref(""), viewport_width: ui.ref("1440"), viewport_height: ui.ref("900"), wait_ms: ui.ref("1000"),
    selected: ui.ref(null), pending_ids: ui.ref([]),
  };
  const policy = PollPolicyModel({ ui });
  let controller = null, stop_realtime = null, load_pending = false, visible = false, sequence = 0, epoch = 0;
  const requests = new Set();
  async function request(path = "", options = {}) {
    const active = new AbortController(); requests.add(active);
    try {
      const response = await fetch_impl("/admin/api/clips" + path, {
        ...options, signal: active.signal, cache: "no-store", headers: { "Content-Type": "application/json" },
      });
      const result = await response.json();
      active.signal.throwIfAborted();
      if (!response.ok) throw new Error(result.error || "剪藏操作失败");
      return result;
    } finally { requests.delete(active); }
  }
  function replace(clip) {
    const previous = state.clips.value;
    state.clips.as(previous.some(row => row.id === clip.id) ? previous.map(row => row.id === clip.id ? clip : row) : [clip, ...previous]);
    if (state.selected.value?.id === clip.id) state.selected.as(clip);
  }
  const methods = {
    async load() {
      if (controller) { load_pending = true; return; }
      const active = new AbortController(); controller = active;
      const before = sequence;
      state.loading.as(true);
      try {
        const response = await fetch_impl("/admin/api/clips", { cache: "no-store", signal: active.signal });
        const result = await response.json();
        if (active.signal.aborted || before !== sequence) return;
        if (!response.ok) throw new Error(result.error || "剪藏加载失败");
        if (!Array.isArray(result.clips)) throw new Error("剪藏接口返回格式错误");
        state.clips.as(result.clips); state.renderer_available.as(Boolean(result.renderer_available));
        const selected = state.selected.value;
        if (selected) {
          const latest = result.clips.find(clip => clip.id === selected.id);
          if (!latest || latest.saved_at !== selected.saved_at) state.selected.as(latest || null);
        }
        state.page.as(Math.min(state.page.value, Math.max(1, Math.ceil(result.clips.length / 10))));
      } catch (error) { if (!active.signal.aborted) state.error.as(error.message); }
      finally { if (controller === active) { controller = null; state.loading.as(false);
        if (load_pending && visible) { load_pending = false; void methods.load(); }
      } }
    },
    start() {
      if (visible) return;
      visible = true;
      stop_realtime = realtime?.subscribe("clips.changed", event => {
        if (event.type === "clips.changed" || (event.type === "realtime.connected" && event.reconnected)) void methods.load();
      });
      void methods.load();
    },
    stop() {
      visible = false; load_pending = false; stop_realtime?.(); stop_realtime = null; controller?.abort(); controller = null; state.loading.as(false);
      for (const active of requests) active.abort();
      sequence++; epoch++; state.busy.as(false); state.pending_ids.as([]);
      state.form_open.as(false); state.selected.as(null);
    },
    set(key, value) {
      if (!state.busy.value && ["title", "url", "selector", "viewport_width", "viewport_height", "wait_ms"].includes(key)) state[key].as(value);
    },
    open(clip = null) {
      if (state.busy.value) return;
      state.editing_id.as(clip?.id || "");
      for (const [key, fallback] of Object.entries({ title: "", url: "", selector: "", viewport_width: 1440, viewport_height: 900, wait_ms: 1000 })) state[key].as(String(clip?.[key] ?? fallback));
      policy.methods.reset(clip?.poll_policy); state.form_error.as(""); state.form_open.as(true);
    },
    close() { if (!state.busy.value) state.form_open.as(false); },
    preview(clip) { state.selected.as(clip); },
    close_preview() { state.selected.as(null); },
    set_page(page) { state.page.as(Math.max(1, Math.min(page, Math.ceil(state.clips.value.length / 10) || 1))); },
    link: clip => new URL(clip.path, origin).href,
    embed: clip => clip_embed(clip, origin),
    async save() {
      if (state.busy.value) return;
      state.form_error.as("");
      let fields;
      try {
        fields = { title: state.title.value, url: state.url.value, selector: state.selector.value,
          viewport_width: Number(state.viewport_width.value), viewport_height: Number(state.viewport_height.value),
          wait_ms: Number(state.wait_ms.value), poll_policy: policy.methods.value() };
        const checked = ClipModel.validate(fields);
        if (!checked.ok) throw new Error(checked.error);
      } catch (error) { state.form_error.as(error.message); return; }
      const id = state.editing_id.value, before = epoch;
      sequence++;
      state.busy.as(true);
      try {
        const result = await request(id ? "/" + id : "", { method: id ? "PATCH" : "POST", body: JSON.stringify(fields) });
        if (before !== epoch) return;
        replace(result.clip); state.form_open.as(false); state.page.as(1); state.error.as("");
      } catch (error) { if (before === epoch) state.form_error.as(error.message); }
      finally { if (before === epoch) { state.busy.as(false); void methods.load(); } }
    },
    async action(clip, action) {
      if (state.pending_ids.value.includes(clip.id)) return;
      const before = epoch;
      sequence++;
      state.pending_ids.as([...state.pending_ids.value, clip.id]); state.error.as("");
      try {
        const result = await request("/" + clip.id + (action === "refresh" ? "/snapshot" : ""), {
          method: action === "refresh" ? "POST" : action === "delete" ? "DELETE" : "PATCH",
          ...(action === "toggle" ? { body: JSON.stringify({ enabled: !clip.enabled }) } : {}),
        });
        if (before !== epoch) return;
        if (action === "delete") {
          state.clips.as(state.clips.value.filter(row => row.id !== clip.id));
          if (state.selected.value?.id === clip.id) state.selected.as(null);
        } else if (action === "refresh") replace({ ...clip, refreshing: true });
        else replace(result.clip);
      } catch (error) { if (before === epoch) state.error.as(error.message); }
      finally {
        if (before === epoch) {
          state.pending_ids.as(state.pending_ids.value.filter(id => id !== clip.id));
          if (visible) void methods.load();
        }
      }
    },
  };
  return { state, methods, policy };
}
