import { StorageModel } from "./storage.model.js";

const { View, Button, Link, For, Show, computed, combine } = window.FindRSSAdminUI;

export function StoragePage() {
  const { state, methods } = StorageModel();
  return window.FindRSSAdminShell.Page({ page_id: "storage", title: "存储", actions: [
    Button({ attributes: { n: "storage-refresh" },
      disabled: combine({ busy: state.busy, usage_busy: state.usage_busy }, value => value.busy || value.usage_busy),
      onClick: methods.refresh }, ["刷新"]),
  ] }, [
    View({ class: "grid min-w-0 gap-space-4", attributes: { n: "storage-page" }, onMounted: methods.refresh }, [
      View({ class: "grid gap-space-2 rounded-card bg-surface-raised", style: { padding: "20px" },
        attributes: { n: "storage-summary", "aria-busy": computed(state.usage_busy, String) } }, [
        View({ class: "text-muted text-sm", attributes: { n: "storage-usage-label" } }, ["R2 已用空间"]),
        View({ style: { "font-size": "24px" }, attributes: { n: "storage-usage" } }, [state.usage_label]),
        View({ class: "text-sm", attributes: { n: "storage-count" } }, [state.count_label]),
        View({ class: "text-muted text-sm", attributes: { n: "storage-usage-status", role: "status" } }, [
          computed(state.usage_busy, busy => busy ? "正在统计已用空间…" : ""), state.usage_status,
        ]),
        View({ class: "text-danger text-sm", attributes: { n: "storage-usage-error", role: "alert" } }, [state.usage_error]),
      ]),
      View({ class: "text-danger text-sm", attributes: { n: "storage-error", role: "alert" } }, [state.error]),
      Show({ when: state.busy, ok: () => View({ class: "text-muted text-sm", attributes: { n: "storage-loading", role: "status" } }, ["正在读取文件…"]) }),
      Show({ when: combine({ loaded: state.loaded, files: state.files, busy: state.busy }, value => value.loaded && !value.busy && !value.files.length),
        ok: () => View({ class: "text-muted text-sm", attributes: { n: "storage-empty" } }, ["暂无文件"]) }),
      View({ class: "grid min-w-0 gap-space-2", attributes: { n: "storage-files", "aria-label": "R2 文件列表", "aria-busy": computed(state.busy, String) } }, [
        For({ each: state.files, key: "key", render(value) {
          const file = value?.__is_ref ? value.value : value;
          return View({ class: "flex flex-wrap items-center justify-between gap-space-3 rounded-card bg-surface-raised",
            style: { padding: "16px" }, attributes: { n: "storage-file" } }, [
            View({ class: "grid min-w-0 flex-1 gap-space-2", attributes: { n: "storage-file-info" } }, [
              View({ class: "break-anywhere text-sm", attributes: { n: "storage-file-key" } }, [file.key]),
              View({ class: "text-muted text-sm", attributes: { n: "storage-file-details" } }, [file.size_label + " · 上传于 " + file.uploaded_label]),
            ]),
            View({ class: "flex gap-space-3", attributes: { n: "storage-file-actions" } }, [
              Link({ href: file.view_url, class: "text-link text-sm", attributes: { n: "storage-file-view", target: "_blank", rel: "noopener", "aria-label": "查看 " + file.key } }, ["查看"]),
              Link({ href: file.download_url, class: "text-link text-sm", attributes: { n: "storage-file-download", target: "_blank", rel: "noopener", "aria-label": "下载 " + file.key } }, ["下载"]),
            ]),
          ]);
        } }),
      ]),
      View({ class: "flex flex-wrap items-center justify-between gap-space-3", attributes: { n: "storage-pagination" } }, [
        View({ class: "text-muted text-sm", attributes: { n: "storage-page-label" } }, [state.page_label]),
        View({ class: "flex gap-space-2", attributes: { n: "storage-page-actions" } }, [
          Button({ attributes: { n: "storage-previous" }, onClick: methods.previous,
            disabled: combine({ busy: state.busy, enabled: state.can_previous }, value => value.busy || !value.enabled) }, ["上一页"]),
          Button({ attributes: { n: "storage-next" }, onClick: methods.next,
            disabled: combine({ busy: state.busy, enabled: state.can_next }, value => value.busy || !value.enabled) }, ["下一页"]),
        ]),
      ]),
    ]),
  ]);
}
