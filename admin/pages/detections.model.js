import { DetectionModel } from "../../server/domain/detection.js";
import { PollPolicyModel } from "../components/poll_policy.model.js";
import { format_datetime } from "../../server/lib/datetime.js";

const statuses = { pending: "尚未检测", initialized: "基线已建立", unchanged: "无变化", changed: "发现变化", inconclusive: "无法可靠判断", error: "检测失败" };
const types = { "content.updated": "正文更新", "field.added": "字段新增", "field.removed": "字段删除", "field.updated": "字段更新",
  "list.item_added": "条目新增", "list.item_removed": "条目移除", "list.item_entered": "进入窗口", "list.item_left": "离开窗口",
  "list.item_updated": "条目更新", "list.item_moved": "条目顺序变化", "target.appeared": "对象出现", "target.disappeared": "对象消失" };

export function DetectionsModel({ ui = window.FindRSSAdminUI, fetch_impl = (...args) => window.FindRSSAdminAuth.fetch(...args),
  realtime = globalThis.window?.FindRSSAdminRealtime } = {}) {
  const state = { detections: ui.ref([]), scripts: ui.ref([]), script_options: ui.ref([]), loading: ui.ref(false), busy: ui.ref(false), error: ui.ref(""),
    form_open: ui.ref(false), form_error: ui.ref(""), editing_id: ui.ref(""), title: ui.ref(""), script_id: ui.ref(""), script_url: ui.ref(""),
    history_open: ui.ref(false), history_loading: ui.ref(false), selected: ui.ref(null), runs: ui.ref([]), detail: ui.ref(null),
    events: ui.ref([]), matches: ui.ref([]), issues: ui.ref([]), result_text: ui.ref(""), result_preview: ui.ref(""), pending_ids: ui.ref([]) };
  state.event_page = ui.ref(1); state.event_pages = ui.ref(1); state.event_count = ui.ref(0);
  const policy = PollPolicyModel({ ui });
  const requests = new Set();
  let visible = false, stop_realtime = null, loading = false, reload = false, epoch = 0, detail_sequence = 0;
  let all_events = [];
  function decorate(row) { return { ...row, status_label: statuses[row.status] || row.status,
    saved_label: row.saved_at ? format_datetime(row.saved_at) : "尚未执行", tone: row.running ? "brand" : row.status === "error" || row.status === "inconclusive" ? "danger" : row.status === "changed" ? "brand" : "neutral" }; }
  async function request(path = "", options = {}) {
    const controller = new AbortController(); requests.add(controller);
    try {
      const response = await fetch_impl("/admin/api/detections" + path, { cache: "no-store", ...options,
        signal: controller.signal, headers: { "Content-Type": "application/json" } });
      const result = await response.json(); controller.signal.throwIfAborted();
      if (!response.ok) throw new Error(result.error || "内容检测操作失败");
      return result;
    } finally { requests.delete(controller); }
  }
  function clear_detail() {
    state.detail.as(null); state.events.as([]); state.matches.as([]); state.issues.as([]); state.result_text.as(""); state.result_preview.as("");
    all_events = []; state.event_page.as(1); state.event_pages.as(1); state.event_count.as(0);
  }
  const methods = {
    async load() {
      if (loading) { reload = true; return; }
      loading = true; state.loading.as(true); const before = epoch;
      try {
        const result = await request(); if (before !== epoch) return;
        if (!Array.isArray(result.detections) || !Array.isArray(result.scripts)) throw new Error("检测接口返回格式错误");
        state.detections.as(result.detections.map(decorate)); state.scripts.as(result.scripts);
        state.script_options.as(result.scripts.map(script => ({ value: script.id, label: script.name })));
        state.error.as("");
      } catch (error) { if (before === epoch && error.name !== "AbortError") state.error.as(error.message); }
      finally { loading = false; if (before === epoch) state.loading.as(false); if (reload && visible) { reload = false; void methods.load(); } }
    },
    start() {
      if (visible) return; visible = true;
      stop_realtime = realtime?.subscribe("detections.changed", event => { if (event.type === "detections.changed" || event.reconnected) void methods.load(); });
      void methods.load();
    },
    stop() {
      visible = false; reload = false; stop_realtime?.(); stop_realtime = null; epoch++; detail_sequence++;
      for (const controller of requests) controller.abort();
      state.loading.as(false); state.busy.as(false); state.form_open.as(false); state.history_open.as(false); state.pending_ids.as([]);
    },
    open(row = null) {
      if (state.busy.value) return;
      state.editing_id.as(row?.id || ""); state.title.as(row?.title || "");
      state.script_id.as(row?.script_id || ""); state.script_url.as(row?.script_url || "");
      if (row?.script_id && !state.script_options.value.some(option => option.value === row.script_id)) {
        state.script_options.as([...state.script_options.value, { value: row.script_id, label: "原检测脚本（当前不可用）" }]);
      }
      policy.methods.reset(row?.poll_policy); state.form_error.as(""); state.form_open.as(true);
    },
    close() { if (!state.busy.value) state.form_open.as(false); },
    set(key, value) {
      if (state.busy.value) return;
      if (["title", "script_url"].includes(key)) state[key].as(value);
      if (key === "script_id") { state.script_id.as(value); state.script_url.as(state.scripts.value.find(script => script.id === value)?.routes[0]?.example || ""); }
    },
    async save() {
      if (state.busy.value) return;
      let body;
      try {
        body = { title: state.title.value, script_id: state.script_id.value, script_url: state.script_url.value, poll_policy: policy.methods.value() };
        const result = DetectionModel.validate(body); if (!result.ok) throw new Error(result.error);
      } catch (error) { state.form_error.as(error.message); return; }
      const before = epoch, id = state.editing_id.value; state.busy.as(true); state.form_error.as("");
      try { await request(id ? "/" + id : "", { method: id ? "PATCH" : "POST", body: JSON.stringify(body) });
        if (before !== epoch) return; state.form_open.as(false); await methods.load();
      } catch (error) { if (before === epoch) state.form_error.as(error.message); }
      finally { if (before === epoch) state.busy.as(false); }
    },
    async action(row, action) {
      if (state.pending_ids.value.includes(row.id)) return;
      const before = epoch; state.pending_ids.as([...state.pending_ids.value, row.id]); state.error.as("");
      try {
        await request("/" + row.id + (["run", "reset"].includes(action) ? "/" + action : ""), {
          method: action === "toggle" ? "PATCH" : action === "delete" ? "DELETE" : "POST",
          ...(action === "toggle" ? { body: JSON.stringify({ enabled: !row.enabled }) } : {}),
        });
        if (before !== epoch) return;
        await methods.load();
      } catch (error) { if (before === epoch) state.error.as(error.message); }
      finally { if (before === epoch) state.pending_ids.as(state.pending_ids.value.filter(id => id !== row.id)); }
    },
    async history(row) {
      const before = epoch, sequence = ++detail_sequence;
      state.selected.as(row); state.runs.as([]); clear_detail(); state.history_open.as(true); state.history_loading.as(true);
      try {
        const result = await request("/" + row.id + "/runs"); if (before !== epoch || sequence !== detail_sequence) return;
        state.runs.as(result.runs.map(run => ({ ...run, status_label: (statuses[run.status] || run.status) + (run.is_baseline ? " · 当前基线" : ""), time_label: format_datetime(run.observed_at) })));
        if (result.runs.length) await methods.detail(result.runs[0].id);
      } catch (error) { if (before === epoch && sequence === detail_sequence) state.error.as(error.message); }
      finally { if (before === epoch) state.history_loading.as(false); }
    },
    async detail(id) {
      const row = state.selected.value; if (!row) return;
      const sequence = ++detail_sequence, before = epoch; clear_detail();
      try {
        const result = await request("/" + row.id + "/runs/" + id);
        if (before !== epoch || sequence !== detail_sequence) return;
        state.detail.as(result);
        all_events = result.changes || []; state.event_count.as(all_events.length); state.event_pages.as(Math.max(1, Math.ceil(all_events.length / 50)));
        methods.set_event_page(1);
        state.matches.as((result.matches || []).map(match => ({ id: match.id, label: match.label })));
        state.issues.as((result.issues || []).map(issue => (issue.target ? issue.target + "：" : "") + issue.reason));
        const text = JSON.stringify(result, null, 2); state.result_text.as(text);
        state.result_preview.as(text.length <= 32768 ? text : text.slice(0, 32768) + "\n…展示已截断，复制完整 JSON 可查看全部内容。");
      } catch (error) { if (before === epoch && sequence === detail_sequence) state.error.as(error.message); }
    },
    set_event_page(page) {
      page = Math.max(1, Math.min(page, state.event_pages.value)); state.event_page.as(page);
      state.events.as(all_events.slice((page - 1) * 50, page * 50).map((change, index) => ({ id: change.id || String((page - 1) * 50 + index),
        title: (types[change.type] || change.type) + " · " + change.target + (change.item_id ? " · " + change.item_id : "") + (change.path || ""),
        text: JSON.stringify(change, null, 2).slice(0, 16384) })));
    },
    previous_events() { methods.set_event_page(state.event_page.value - 1); },
    next_events() { methods.set_event_page(state.event_page.value + 1); },
    close_history() { detail_sequence++; state.history_open.as(false); state.history_loading.as(false); clear_detail(); },
  };
  return { state, methods, policy };
}
