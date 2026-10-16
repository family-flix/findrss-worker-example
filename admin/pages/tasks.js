import { TasksModel } from "./tasks.model.js";

const { View, Button, Badge, Show, For, computed, combine } = window.FindRSSAdminUI;

export function TasksPage({ view } = {}) {
  const { state, methods } = TasksModel();
  let stop_show, stop_hide;
  return window.FindRSSAdminShell.Page({ page_id: "tasks", title: "任务", actions: [
    Button({ disabled: state.loading, attributes: { n: "tasks-refresh" }, onClick: methods.load }, ["刷新"]),
  ] }, [
    View({ class: "grid min-w-0 gap-space-4", attributes: { n: "tasks-page", "aria-busy": computed(state.loading, String) },
      onMounted() { stop_show = view?.onShow(methods.load); stop_hide = view?.onBeforeHide(methods.stop); void methods.load(); },
      onUnmounted() { stop_show?.(); stop_hide?.(); methods.stop(); } }, [
      View({ class: "text-muted text-sm", attributes: { n: "tasks-description" } }, ["展示最近 100 条后台任务，点击刷新更新任务状态。终止刷新会保留上次成功保存的快照；下次定时刷新仍按原计划执行。"]),
      View({ class: "text-danger text-sm whitespace-pre-wrap break-anywhere", attributes: { n: "tasks-error", role: "alert" } }, [state.error]),
      Show({ when: combine({ tasks: state.tasks, loading: state.loading, error: state.error }, value => !value.tasks.length && !value.loading && !value.error),
        ok: () => View({ class: "text-muted", attributes: { n: "tasks-empty", role: "status" } }, ["暂无后台任务"]) }),
      View({ class: "grid min-w-0 gap-space-3", attributes: { n: "tasks-list" } }, [
        For({ each: state.tasks, render(value) {
          const task = value?.__is_ref ? value.value : value;
          return View({ class: "grid min-w-0 gap-space-2 bg-surface-raised rounded-card", style: { padding: "16px" }, attributes: { n: "tasks-item" } }, [
            View({ class: "flex flex-wrap items-center justify-between gap-space-2", attributes: { n: "tasks-item-heading" } }, [
              View({ as: "h2", class: "m-0 text-sm break-anywhere", attributes: { n: "tasks-item-title" } }, [task.title]),
              Badge({ tone: task.tone, attributes: { n: "tasks-item-status" } }, [task.status_label]),
            ]),
            View({ class: "text-muted text-sm break-anywhere", attributes: { n: "tasks-item-target" } }, [task.target]),
            View({ class: "text-muted text-sm", attributes: { n: "tasks-item-time" } }, [task.started_label + " · 耗时 " + task.elapsed_label]),
            task.error ? View({ class: "text-sm break-anywhere", attributes: { n: "tasks-item-error" } }, [task.error]) : null,
            task.cancellable ? Button({ size: "small", disabled: computed(state.cancelling, ids => ids.includes(task.id)),
              attributes: { n: "tasks-item-cancel", "aria-label": "终止" + task.title }, onClick: () => methods.cancel(task.id) },
              [computed(state.cancelling, ids => ids.includes(task.id) ? "正在终止…" : "终止刷新")]) : null,
          ]);
        } }),
      ]),
    ]),
  ]);
}
