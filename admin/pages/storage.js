import { StorageModel } from "./storage.model.js";
import { StorageTreeView, StoragePreviewView } from "../components/storage_tree.js";

const { View, Button, computed, combine } = window.FindRSSAdminUI;

export function StoragePage({ view } = {}) {
  const model = StorageModel();
  const { state, methods } = model;
  let stop_hide;
  return window.FindRSSAdminShell.Page({ page_id: "storage", title: "存储", actions: [
    Button({ attributes: { n: "storage-refresh" },
      disabled: combine({ busy: state.busy, usage_busy: state.usage_busy }, value => value.busy || value.usage_busy),
      onClick: methods.refresh }, ["刷新"]),
  ] }, [
    View({ class: "grid min-w-0 gap-space-4", attributes: { n: "storage-page" },
      onMounted() { stop_hide = view?.onBeforeHide(methods.close_preview); void methods.refresh(); },
      onUnmounted() { stop_hide?.(); methods.dispose(); } }, [
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
      View({ class: "grid min-w-0 gap-space-4 max-760-grid-template-columns", style: {
        "grid-template-columns": "minmax(240px, 2fr) minmax(0, 3fr)", "align-items": "start",
        "--max-760-grid-template-columns": "minmax(0, 1fr)",
      }, attributes: { n: "storage-workspace" } }, [StorageTreeView({ model }), StoragePreviewView({ model })]),
    ]),
  ]);
}
