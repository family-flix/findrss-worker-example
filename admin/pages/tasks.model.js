import { format_datetime } from "../../server/lib/datetime.js";

export const task_status_options = [
  { value: "", label: "全部状态" },
  { value: "running", label: "进行中" },
  { value: "completed", label: "已完成" },
  { value: "failed", label: "失败" },
  { value: "cancelled", label: "已终止" },
];

export function TasksModel({ ui = window.FindRSSAdminUI, fetch_impl = (...args) => window.FindRSSAdminAuth.fetch(...args) } = {}) {
  const state = { tasks: ui.ref([]), status: ui.ref(""), loading: ui.ref(false), cleaning: ui.ref(false), error: ui.ref(""), cancelling: ui.ref([]) };
  state.visible_tasks = ui.combine({ tasks: state.tasks, status: state.status }, ({ tasks, status }) =>
    status ? tasks.filter(task => task.status === status) : tasks);
  let controller = null;
  const status_labels = { running: "进行中", completed: "已完成", failed: "失败", cancelled: "已终止" };
  function task_value(task) {
    return { ...task, status_label: status_labels[task.status] || task.status,
      tone: ({ completed: "success", failed: "danger", running: "brand" })[task.status] || "neutral",
      started_label: format_datetime(task.started_at),
      elapsed_label: Math.max(0, Math.round(((task.finished_at || Date.now()) - task.started_at) / 1000)) + " 秒",
      cancellable: task.status === "running" };
  }
  async function load() {
    if (controller || state.cleaning.value) return;
    const active = new AbortController();
    controller = active;
    state.loading.as(true);
    try {
      const response = await fetch_impl("/admin/api/background-tasks", { cache: "no-store", signal: active.signal });
      const payload = await response.json();
      if (active.signal.aborted) return;
      if (!response.ok) throw new Error(payload.error || "任务加载失败");
      if (!Array.isArray(payload.tasks)) throw new Error("任务接口返回格式不正确");
      state.tasks.as(payload.tasks.map(task_value));
      state.error.as("");
    } catch (error) {
      if (!active.signal.aborted) state.error.as(error.message || "任务加载失败");
    } finally {
      if (controller === active) { controller = null; state.loading.as(false); }
    }
  }
  const methods = {
    load,
    set_status(status) {
      if (task_status_options.some(option => option.value === status)) state.status.as(status);
    },
    async cleanup() {
      if (state.cleaning.value || state.cancelling.value.length) return;
      controller?.abort(); controller = null; state.loading.as(false);
      state.cleaning.as(true);
      state.error.as("");
      try {
        const response = await fetch_impl("/admin/api/background-tasks", { method: "DELETE" });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "清理任务失败");
        if (!Array.isArray(payload.tasks)) throw new Error("任务接口返回格式不正确");
        state.tasks.as(payload.tasks.map(task_value));
      } catch (error) { state.error.as(error.message || "清理任务失败"); }
      finally { state.cleaning.as(false); }
    },
    async cancel(id) {
      if (state.cleaning.value || state.cancelling.value.includes(id) || !state.tasks.value.some(task => task.id === id && task.cancellable)) return;
      state.cancelling.as([...state.cancelling.value, id]);
      state.error.as("");
      try {
        const response = await fetch_impl("/admin/api/background-tasks/" + encodeURIComponent(id) + "/cancel", { method: "POST" });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "终止任务失败");
        if (!payload.task?.id || !status_labels[payload.task.status]) throw new Error("任务接口返回格式不正确");
        controller?.abort(); controller = null; state.loading.as(false);
        state.tasks.as(state.tasks.value.map(task => task.id === id ? task_value(payload.task) : task));
      } catch (error) { state.error.as(error.message || "终止任务失败"); }
      finally { state.cancelling.as(state.cancelling.value.filter(value => value !== id)); }
    },
    stop() {
      controller?.abort(); controller = null; state.loading.as(false);
    },
  };
  return { state, methods };
}
