import { DetectionsModel } from "./detections.model.js";
import { PollPolicyView, poll_policy_label } from "../components/poll_policy.js";

const { View, Input, Select, Button, Dialog, Badge, CopyButton, Popconfirm, Show, For, computed, combine } = window.FindRSSAdminUI;
const unwrap = value => value?.__is_ref ? value.value : value;

function DetectionForm({ state, methods, policy }) {
  const field = (key, label, help) => Input({ label, help, value: state[key], disabled: state.busy,
    attributes: { n: "detection-form-" + key }, onInput: event => methods.set(key, event.target.value) });
  return Dialog({ open: state.form_open, title: computed(state.editing_id, id => id ? "编辑内容检测" : "创建内容检测"),
    attributes: { n: "detection-form" }, onClose: methods.close, maskClosable: false,
    style: { width: "min(640px, calc(100vw - 32px))", "max-height": "calc(100dvh - 32px)" },
    bodyProps: { class: "grid gap-space-3 min-h-0 overflow-auto" },
    footer: [Button({ attributes: { n: "detection-form-cancel" }, disabled: state.busy, onClick: methods.close }, ["取消"]),
      Button({ attributes: { n: "detection-form-save" }, variant: "primary", disabled: state.busy, onClick: methods.save }, ["保存检测任务"])],
  }, [field("title", "名称", "用于识别检测任务。"),
    View({ as: "label", class: "text-sm", attributes: { n: "detection-script-label" } }, ["内容检测脚本"]),
    Select({ value: state.script_id, options: state.script_options, disabled: state.busy, attributes: { n: "detection-script-select", "aria-label": "内容检测脚本" }, onChange: value => methods.set("script_id", value) }),
    field("script_url", "具体路由", "填写脚本示例中的具体参数。更换来源后会重新建立基线，已有历史保留。"),
    View({ class: "text-sm", attributes: { n: "detection-policy-label" } }, ["检测周期"]),
    PollPolicyView(policy, { name: "detection-policy", disabled: state.busy }),
    View({ class: "text-danger text-sm whitespace-pre-wrap", attributes: { n: "detection-form-error", role: "alert" } }, [state.form_error]),
  ]);
}

function DetectionHistory({ state, methods }) {
  return Dialog({ open: state.history_open, title: computed(state.selected, row => row ? row.title + " · 检测历史" : "检测历史"),
    attributes: { n: "detection-history" }, onClose: methods.close_history,
    style: { width: "min(1000px, calc(100vw - 32px))", "max-height": "calc(100dvh - 32px)" }, bodyProps: { class: "grid gap-space-3 min-h-0 overflow-auto" },
  }, [View({ class: "flex flex-wrap gap-space-2", attributes: { n: "detection-history-runs" } }, [For({ each: state.runs, render(value) {
    const run = unwrap(value);
    return Button({ size: "small", attributes: { n: "detection-history-run" }, onClick: () => methods.detail(run.id) }, [run.time_label + " · " + run.status_label]);
  } })]),
    Show({ when: combine({ rows: state.runs, loading: state.history_loading }, value => !value.loading && !value.rows.length), ok: () => View({ class: "text-muted", attributes: { n: "detection-history-empty", role: "status" } }, ["尚无检测历史。首次成功只建立基线。"]) }),
    View({ class: "text-danger whitespace-pre-wrap text-sm", attributes: { n: "detection-history-error", role: "alert" } }, [computed(state.detail, value => value?.error || "")]),
    For({ each: state.issues, render: value => View({ class: "text-danger text-sm", attributes: { n: "detection-history-issue" } }, [unwrap(value)]) }),
    For({ each: state.matches, render: value => Badge({ attributes: { n: "detection-rule-match" }, tone: "brand" }, [unwrap(value).label]) }),
    For({ each: state.events, render(value) {
      const event = unwrap(value);
      return View({ class: "grid gap-space-2 bg-surface-raised rounded-control", style: { padding: "var(--frui-space-3)" }, attributes: { n: "detection-change" } }, [
        View({ as: "h3", class: "m-0 text-sm break-anywhere", attributes: { n: "detection-change-title" } }, [event.title]),
        View({ as: "pre", class: "m-0 text-sm whitespace-pre-wrap break-anywhere", attributes: { n: "detection-change-detail" } }, [event.text]),
      ]);
    } }),
    Show({ when: computed(state.event_count, count => count > 50), ok: () => View({ class: "flex items-center gap-space-2", attributes: { n: "detection-events-pagination" } }, [
      Button({ attributes: { n: "detection-events-previous" }, disabled: computed(state.event_page, page => page <= 1), onClick: methods.previous_events }, ["上一页"]),
      View({ class: "text-sm", attributes: { n: "detection-events-page" } }, [combine({ page: state.event_page, pages: state.event_pages, count: state.event_count }, value => `${value.page} / ${value.pages} · 共 ${value.count} 项变化`)]),
      Button({ attributes: { n: "detection-events-next" }, disabled: combine({ page: state.event_page, pages: state.event_pages }, value => value.page >= value.pages), onClick: methods.next_events }, ["下一页"]),
    ]) }),
    CopyButton({ attributes: { n: "detection-copy-result" }, disabled: computed(state.result_text, text => !text), label: "复制完整 JSON", onCopy: () => navigator.clipboard.writeText(state.result_text.value) }),
    View({ as: "pre", class: "m-0 text-sm whitespace-pre-wrap break-anywhere", attributes: { n: "detection-result-json" } }, [state.result_preview]),
  ]);
}

export function DetectionsPage({ view } = {}) {
  const model = DetectionsModel(), { state, methods } = model;
  let stop_show, stop_hide;
  return window.FindRSSAdminShell.Page({ page_id: "detections", title: "内容检测", count: computed(state.detections, rows => rows.length),
    actions: [Button({ variant: "primary", attributes: { n: "detection-create" }, onClick: () => methods.open() }, ["创建检测"]),
      Button({ disabled: state.loading, attributes: { n: "detection-reload" }, onClick: methods.load }, ["刷新列表"])],
  }, [View({ class: "grid gap-space-3 min-w-0", attributes: { n: "detections-page" },
    onMounted() { stop_show = view?.onShow(methods.start); stop_hide = view?.onBeforeHide(methods.stop); methods.start(); },
    onUnmounted() { stop_show?.(); stop_hide?.(); methods.stop(); },
  }, [View({ class: "text-muted text-sm", attributes: { n: "detections-description" } }, ["选择已发布的内容检测脚本，比较本次网站内容与上次有效快照。首次建立基线，错误和不完整采集保留原基线。"]),
    View({ class: "text-danger text-sm whitespace-pre-wrap", attributes: { n: "detections-error", role: "alert" } }, [state.error]),
    Show({ when: computed(state.script_options, options => !options.length), ok: () => View({ class: "text-muted text-sm", attributes: { n: "detections-no-scripts", role: "status" } }, ["请先在「脚本 → 内容检测」导入并发布脚本。检测任务每条保留最近 20 次执行及当前基线。"]) }),
    For({ each: state.detections, render(value) {
      const row = unwrap(value), pending = combine({ ids: state.pending_ids, busy: state.busy }, value => value.busy || value.ids.includes(row.id));
      return View({ class: "grid gap-space-2 bg-surface-raised rounded-card", style: { padding: "var(--frui-space-3)" }, attributes: { n: "detection-item" } }, [
        View({ class: "flex flex-wrap items-center justify-between gap-space-2", attributes: { n: "detection-item-header" } }, [
          View({ as: "h2", class: "m-0 text-sm break-anywhere", attributes: { n: "detection-title" } }, [row.title]), Badge({ tone: row.tone, attributes: { n: "detection-status" } }, [row.running ? "检测中" : row.status_label]),
        ]),
        View({ class: "text-muted text-sm break-anywhere", attributes: { n: "detection-source" } }, [row.script_url]),
        View({ class: "text-muted text-sm", attributes: { n: "detection-summary" } }, [row.saved_label + ` · ${row.change_count} 项变化 · ${row.match_count} 项规则命中 · ` + (row.enabled ? poll_policy_label(row.poll_effective) : "已暂停")]),
        row.error ? View({ class: "text-danger text-sm break-anywhere", attributes: { n: "detection-error", role: "status" } }, [row.error]) : null,
        View({ class: "flex flex-wrap gap-space-2", attributes: { n: "detection-actions" } }, [
          Button({ size: "small", attributes: { n: "detection-history-open" }, onClick: () => methods.history(row) }, ["历史与变化"]),
          Button({ size: "small", disabled: pending, attributes: { n: "detection-edit" }, onClick: () => methods.open(row) }, ["编辑"]),
          Button({ size: "small", disabled: combine({ pending }, value => value.pending || row.running), attributes: { n: "detection-run" }, onClick: () => methods.action(row, "run") }, ["立即检测"]),
          Button({ size: "small", disabled: pending, attributes: { n: "detection-toggle" }, onClick: () => methods.action(row, "toggle") }, [row.enabled ? "暂停" : "启用"]),
          Popconfirm({ title: "重置基线？历史保留，下次成功检测重新初始化。", attributes: { n: "detection-reset-confirm" }, onConfirm: () => methods.action(row, "reset"),
            trigger: props => Button({ ...props, size: "small", disabled: pending, attributes: { ...props.attributes, n: "detection-reset" } }, ["重置基线"]) }),
          Popconfirm({ title: "删除检测任务及全部历史？", attributes: { n: "detection-delete-confirm" }, onConfirm: () => methods.action(row, "delete"),
            trigger: props => Button({ ...props, size: "small", disabled: pending, attributes: { ...props.attributes, n: "detection-delete" } }, ["删除"]) }),
        ]),
      ]);
    } }),
    Show({ when: state.form_open, ok: () => DetectionForm(model) }),
    Show({ when: state.history_open, ok: () => DetectionHistory(model) }),
  ])]);
}
