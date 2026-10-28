import { TasksModel, task_status_options } from "./tasks.model.js";
import { PaginationView } from "../components/pagination.js";

const { View, Button, Badge, Select, Popconfirm, Show, For, computed, combine } = window.FindRSSAdminUI;

export function TasksPage({ view } = {}) {
  const { state, methods, pagination } = TasksModel();
  const busy = combine({ loading: state.loading, cleaning: state.cleaning }, value => value.loading || value.cleaning);
  const cleanup_disabled = combine({ busy, cancelling: state.cancelling }, value => value.busy || value.cancelling.length > 0);
  let stop_show, stop_hide;
  return window.FindRSSAdminShell.Page({ page_id: "tasks", title: "任务", actions: [
    Popconfirm({ title: "从数据库删除全部已完成和失败任务？此操作无法撤销。进行中和已终止的任务会保留。",
      confirmText: "确认清理", disabled: cleanup_disabled,
      attributes: { n: "tasks-cleanup-confirmation" }, onConfirm: methods.cleanup,
      trigger: props => Button({ ...props, disabled: cleanup_disabled,
        attributes: { ...props.attributes, n: "tasks-cleanup" } },
      [computed(state.cleaning, value => value ? "正在清理…" : "清理已完成和失败任务")]),
    }),
    Button({ disabled: busy, attributes: { n: "tasks-refresh" }, onClick: methods.load }, ["刷新"]),
  ] }, [
    View({ class: "grid min-w-0 gap-space-3", attributes: { n: "tasks-page", "aria-busy": computed(busy, String) },
      onMounted() { stop_show = view?.onShow(methods.start); stop_hide = view?.onBeforeHide(methods.stop); methods.start(); },
      onUnmounted() { stop_show?.(); stop_hide?.(); methods.stop(); } }, [
      View({ class: "text-muted text-sm", attributes: { n: "tasks-description" } }, ["最近 100 条后台任务分页展示，默认每页 20 条，任务状态实时更新。清理会从数据库移除全部已完成和失败任务。终止刷新会保留上次成功保存的快照；下次定时刷新仍按原计划执行。"]),
      View({ class: "flex flex-wrap items-center gap-space-2", attributes: { n: "tasks-filters" } }, [
        View({ class: "text-muted text-sm", attributes: { n: "tasks-status-label", id: "tasks-status-label" } }, ["状态"]),
        Select({ value: state.status, options: task_status_options, style: { width: "10rem" },
          attributes: { n: "tasks-status-filter", "aria-labelledby": "tasks-status-label", "aria-label": "任务状态" },
          onChange: event => methods.set_status(event.target.value) }),
      ]),
      View({ class: "text-danger text-sm whitespace-pre-wrap break-anywhere", attributes: { n: "tasks-error", role: "alert" } }, [state.error]),
      Show({ when: combine({ tasks: state.visible_tasks, loading: state.loading, error: state.error }, value => !value.tasks.length && !value.loading && !value.error),
        ok: () => View({ class: "text-muted", attributes: { n: "tasks-empty", role: "status" } }, [
          computed(state.status, status => status ? "暂无该状态的后台任务" : "暂无后台任务"),
        ]) }),
      View({ class: "grid min-w-0 gap-space-3", attributes: { n: "tasks-list" } }, [
        For({ each: state.paged_tasks, render(value) {
          const task = value?.__is_ref ? value.value : value;
          return View({ class: "grid min-w-0 gap-space-2 bg-surface-raised rounded-card", style: { padding: "var(--frui-space-3)" }, attributes: { n: "tasks-item" } }, [
            View({ class: "flex flex-wrap items-center justify-between gap-space-2", attributes: { n: "tasks-item-heading" } }, [
              View({ as: "h2", class: "m-0 text-sm break-anywhere", attributes: { n: "tasks-item-title" } }, [task.title]),
              Badge({ tone: task.tone, attributes: { n: "tasks-item-status" } }, [task.status_label]),
            ]),
            View({ class: "text-muted text-sm break-anywhere", attributes: { n: "tasks-item-target" } }, [task.target]),
            View({ class: "text-muted text-xs break-anywhere", attributes: { n: "tasks-item-id" } }, ["任务 ID：" + task.id]),
            View({ class: "text-muted text-sm", attributes: { n: "tasks-item-time" } }, [task.started_label + " · 耗时 " + task.elapsed_label]),
            task.error ? View({ class: "text-sm break-anywhere", attributes: { n: "tasks-item-error" } }, [task.error]) : null,
            task.cancellable ? Button({ size: "small", disabled: combine({ cancelling: state.cancelling, cleaning: state.cleaning }, value => value.cleaning || value.cancelling.includes(task.id)),
              attributes: { n: "tasks-item-cancel", "aria-label": "终止" + task.title }, onClick: () => methods.cancel(task.id) },
              [computed(state.cancelling, ids => ids.includes(task.id) ? "正在终止…" : "终止刷新")]) : null,
          ]);
        } }),
      ]),
      PaginationView(window.FindRSSAdminUI, { model: pagination, name: "tasks-pagination", label: "任务分页" }),
    ]),
  ]);
}
