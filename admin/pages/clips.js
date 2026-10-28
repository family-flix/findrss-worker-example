import { ClipsModel } from "./clips.model.js";
import { PollPolicyView, poll_policy_label } from "../components/poll_policy.js";
import { format_datetime } from "../../server/lib/datetime.js";

const { View, Input, Select, Button, Badge, CopyButton, Dialog, Popconfirm, For, Show, computed, combine } = window.FindRSSAdminUI;

function ClipForm({ model }) {
  const { state, methods, policy } = model;
  const field = (key, label, help, attributes = {}) => Input({ label, help, disabled: state.busy, value: state[key],
    attributes: { n: "clips-form-" + key, ...attributes }, onInput: event => methods.set(key, event.target.value) });
  return Dialog({ open: state.form_open, title: computed(state.editing_id, id => id ? "编辑剪藏" : "创建剪藏"),
    description: "选择剪藏脚本及具体路由，定时更新同一个公开链接。",
    attributes: { n: "clips-form-dialog" }, onClose: methods.close,
    style: { width: "min(640px, calc(100vw - 32px))", "max-height": "calc(100dvh - 32px)" },
    bodyProps: { class: "grid min-h-0 overflow-auto gap-space-3" }, maskClosable: false,
    footer: [Button({ disabled: state.busy, attributes: { n: "clips-form-cancel" }, onClick: methods.close }, ["取消"]),
      Button({ disabled: state.busy, variant: "primary", attributes: { n: "clips-form-save" }, onClick: methods.save },
        [computed(state.busy, busy => busy ? "正在保存…" : "保存剪藏")])],
  }, [
    field("title", "名称", "用于后台识别和 iframe 标题。", { maxLength: 200 }),
    View({ as: "label", class: "text-sm", attributes: { n: "clips-script-label" } }, ["剪藏脚本"]),
    Select({ value: state.script_id, options: state.script_options, disabled: state.busy,
      attributes: { n: "clips-script-select", "aria-label": "剪藏脚本" }, onChange: value => methods.set("script_id", value) }),
    Show({ when: computed(state.script_id, Boolean), ok: () =>
      field("script_url", "脚本路由", "填写所选脚本的具体路由，例如 /github/ltaoo/findrss-worker/readme；多路由脚本可填写其他入口。", { placeholder: "/github/owner/repo/readme" }) }),
    Show({ when: computed(state.script_id, value => !value), ok: () => View({ class: "grid gap-space-3", attributes: { n: "clips-website-fields" } }, [
    field("url", "来源网址", "填写公开网页的完整网址，采集使用独立浏览器，不使用你的登录状态。", { type: "url", placeholder: "https://example.com/" }),
    field("selector", "CSS 选择器", "例如 #main、.weather-card；匹配多个节点时取第一个。", { placeholder: "#main", spellcheck: "false" }),
    View({ class: "flex flex-wrap gap-space-3", attributes: { n: "clips-viewport-fields" } }, [
      field("viewport_width", "采集视口宽度（px）", "320–3840", { type: "number", min: 320, max: 3840 }),
      field("viewport_height", "采集视口高度（px）", "320–2160", { type: "number", min: 320, max: 2160 }),
    ]),
    field("wait_ms", "节点出现后的等待时间（ms）", "0–10000；供异步内容、图片和样式完成加载。", { type: "number", min: 0, max: 10000 }),
    ]) }),
    View({ class: "text-sm", attributes: { n: "clips-poll-label" } }, ["刷新规则"]),
    PollPolicyView(policy, { name: "clips-poll-policy", disabled: state.busy }),
    View({ class: "text-danger text-sm whitespace-pre-wrap", attributes: { n: "clips-form-error", role: "alert" } }, [state.form_error]),
  ]);
}

function ClipPreview({ model }) {
  const { state, methods } = model;
  return Dialog({ open: computed(state.selected, Boolean), title: computed(state.selected, clip => clip?.title || "剪藏预览"),
    attributes: { n: "clips-preview-dialog" }, onClose: methods.close_preview,
    style: { width: "min(1100px, calc(100vw - 32px))", "max-height": "calc(100dvh - 32px)" },
    bodyProps: { class: "grid min-h-0 overflow-auto gap-space-3" },
  }, [For({ each: computed(state.selected, clip => clip ? [clip] : []), render(value) {
    const clip = value?.__is_ref ? value.value : value;
    return View({ class: "grid min-w-0 gap-space-3" }, [
      View({ class: "flex flex-wrap items-center gap-space-2" }, [
        View({ as: "a", class: "break-anywhere", attributes: { n: "clips-public-link", href: methods.link(clip), target: "_blank", rel: "noopener noreferrer" } }, [methods.link(clip)]),
        CopyButton({ label: "复制链接", onCopy: () => navigator.clipboard.writeText(methods.link(clip)), onError: error => state.error.as(error.message) }),
        CopyButton({ label: "复制 iframe", onCopy: () => navigator.clipboard.writeText(methods.embed(clip)), onError: error => state.error.as(error.message) }),
      ]),
      View({ as: "pre", class: "m-0 whitespace-pre-wrap break-anywhere bg-surface-raised rounded-control",
        style: { padding: "var(--frui-space-3)" }, attributes: { n: "clips-embed-code" } }, [methods.embed(clip)]),
      View({ class: "text-muted text-sm" }, ["iframe 展示最近一次成功快照，不执行 JavaScript。高度使用快照尺寸；内容更新后如有变化，可调整嵌入代码的 height。"]),
      clip.saved_at ? View({ as: "iframe", class: "box-border w-full bg-surface rounded-control",
        style: { border: "0", height: Math.min(clip.height || 600, 650) + "px" },
        attributes: { n: "clips-preview-frame", src: methods.link(clip) + "?v=" + clip.saved_at, title: clip.title, sandbox: "", referrerpolicy: "no-referrer" } })
        : View({ class: "text-muted", attributes: { role: "status" } }, ["尚无成功快照，采集完成后可预览。"]),
    ]);
  } })]);
}

export function ClipsPage({ view } = {}) {
  const model = ClipsModel(), { state, methods } = model;
  let stop_show, stop_hide;
  const rows = combine({ clips: state.clips, page: state.page }, value => value.clips.slice((value.page - 1) * 10, value.page * 10));
  const count = computed(state.clips, clips => clips.length);
  return window.FindRSSAdminShell.Page({ page_id: "clips", title: "区域剪藏", count,
    actions: [Button({ variant: "primary", attributes: { n: "clips-create" }, onClick: () => methods.open() }, ["创建剪藏"]),
      Button({ disabled: state.loading, attributes: { n: "clips-refresh" }, onClick: methods.load }, ["刷新列表"])],
  }, [View({ class: "grid min-w-0 gap-space-3", attributes: { n: "clips-page", "aria-busy": computed(state.loading, String) },
    onMounted() { stop_show = view?.onShow(methods.start); stop_hide = view?.onBeforeHide(methods.stop); methods.start(); },
    onUnmounted() { stop_show?.(); stop_hide?.(); methods.stop(); } }, [
    View({ class: "text-muted text-sm" }, ["按计划采集指定网页节点，保留当前样式、移除脚本，生成可嵌入任意网站的固定链接。更新失败时保留上一次成功快照。"]),
    Show({ when: computed(state.renderer_available, available => !available), ok: () =>
      View({ class: "text-danger text-sm", attributes: { n: "clips-renderer-warning", role: "status" } }, ["剪藏渲染器尚未配置完成，请检查部署配置。可先保存剪藏规则。"])
    }),
    View({ class: "text-danger text-sm whitespace-pre-wrap", attributes: { n: "clips-error", role: "alert" } }, [state.error]),
    Show({ when: combine({ clips: state.clips, loading: state.loading }, value => !value.clips.length && !value.loading), ok: () =>
      View({ class: "text-muted", attributes: { n: "clips-empty", role: "status" } }, ["暂无剪藏。点击「创建剪藏」，填写网址和节点选择器即可开始。"])
    }),
    For({ each: rows, render(value) {
      const clip = value?.__is_ref ? value.value : value;
      const pending = combine({ ids: state.pending_ids, busy: state.busy }, value => value.busy || value.ids.includes(clip.id));
      const disabled_refresh = combine({ pending, available: state.renderer_available }, value => value.pending || !value.available || clip.refreshing);
      return View({ class: "grid min-w-0 gap-space-2 bg-surface-raised rounded-card", style: { padding: "var(--frui-space-3)" }, attributes: { n: "clips-item" } }, [
        View({ class: "flex flex-wrap items-center justify-between gap-space-2" }, [
          View({ as: "h2", class: "m-0 text-sm break-anywhere" }, [clip.title]),
          Badge({ tone: clip.refreshing ? "brand" : clip.error ? "danger" : clip.saved_at ? "success" : "neutral" }, [clip.refreshing ? "采集中" : clip.error ? "刷新失败" : clip.saved_at ? "已有快照" : "等待首次采集"]),
        ]),
        View({ class: "text-sm text-muted break-anywhere", attributes: { n: "clips-item-source" } }, [clip.script_url || clip.url + " · " + clip.selector]),
        View({ class: "text-sm text-muted" }, [
          (clip.enabled ? poll_policy_label(clip.poll_effective) : "已暂停定时刷新") + " · "
          + (clip.saved_at ? "快照 " + format_datetime(clip.saved_at) + ` · ${clip.width} × ${clip.height} px` : "尚无快照")
          + (clip.enabled && clip.next_snapshot_at ? " · 下次 " + format_datetime(clip.next_snapshot_at) : ""),
        ]),
        clip.error ? View({ class: "text-danger text-sm break-anywhere", attributes: { role: "status" } }, [clip.error]) : null,
        clip.image_missing ? View({ class: "text-muted text-sm" }, [`${clip.image_missing} 张图片无法读取，已使用占位图。`]) : null,
        View({ class: "flex flex-wrap items-center gap-space-2" }, [
          Button({ size: "small", attributes: { n: "clips-item-preview" }, onClick: () => methods.preview(clip) }, ["预览与嵌入"]),
          Button({ size: "small", disabled: pending, attributes: { n: "clips-item-edit" }, onClick: () => methods.open(clip) }, ["编辑"]),
          Button({ size: "small", disabled: disabled_refresh, attributes: { n: "clips-item-refresh" }, onClick: () => methods.action(clip, "refresh") }, [clip.refreshing ? "采集中…" : "立即采集"]),
          Button({ size: "small", disabled: pending, attributes: { n: "clips-item-toggle" }, onClick: () => methods.action(clip, "toggle") }, [clip.enabled ? "暂停定时" : "启用定时"]),
          Popconfirm({ title: "删除这条剪藏及快照？现有 iframe 链接将失效。", disabled: pending,
            attributes: { n: "clips-item-delete-confirm" }, onConfirm: () => methods.action(clip, "delete"),
            trigger: props => Button({ ...props, size: "small", disabled: pending, attributes: { ...props.attributes, n: "clips-item-delete" } }, ["删除"]),
          }),
        ]),
      ]);
    } }),
    Show({ when: computed(count, count => count > 10), ok: () => View({ class: "flex items-center justify-center gap-space-3" }, [
      Button({ disabled: computed(state.page, page => page <= 1), attributes: { n: "clips-page-previous" }, onClick: () => methods.set_page(state.page.value - 1) }, ["上一页"]),
      View({ attributes: { n: "clips-page-number" } }, [combine({ page: state.page, count }, value => `${value.page} / ${Math.ceil(value.count / 10)}`)]),
      Button({ disabled: combine({ page: state.page, count }, value => value.page * 10 >= value.count), attributes: { n: "clips-page-next" }, onClick: () => methods.set_page(state.page.value + 1) }, ["下一页"]),
    ]) }),
    Show({ when: state.form_open, ok: () => ClipForm({ model }) }),
    Show({ when: computed(state.selected, Boolean), ok: () => ClipPreview({ model }) }),
  ])]);
}
