import { format_bytes } from "../utils.js";
import { format_datetime } from "../../server/lib/datetime.js";

export function StorageModel() {
  const { ref, refarr, computed } = window.FindRSSAdminUI;
  const files = refarr([]);
  const busy = ref(false);
  const usage_busy = ref(false);
  const loaded = ref(false);
  const error = ref("");
  const usage_error = ref("");
  const usage = ref(null);
  const cursors = ref([null]);
  const next_cursor = ref(null);

  async function request_json(path) {
    const response = await window.FindRSSAdminAuth.fetch("/admin/api/storage" + path, {
      credentials: "same-origin", cache: "no-store",
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "读取失败：HTTP " + response.status);
    return result;
  }

  async function load_page(next_cursors) {
    if (busy.value) return;
    busy.as(true);
    error.as("");
    try {
      const cursor = next_cursors.at(-1);
      const result = await request_json(cursor ? "?cursor=" + encodeURIComponent(cursor) : "");
      files.as(result.objects.map(file => ({ ...file,
        size_label: format_bytes(file.size),
        uploaded_label: format_datetime(file.uploaded, { fallback: "—" }),
        view_url: "/admin/api/storage/file?key=" + encodeURIComponent(file.key),
        download_url: "/admin/api/storage/file?download=1&key=" + encodeURIComponent(file.key),
      })));
      cursors.as(next_cursors);
      next_cursor.as(result.truncated ? result.cursor : null);
      loaded.as(true);
    } catch (failure) {
      error.as(failure.message || String(failure));
    } finally {
      busy.as(false);
    }
  }

  async function load_usage() {
    if (usage_busy.value) return;
    usage_busy.as(true);
    usage_error.as("");
    try { usage.as(await request_json("/usage")); }
    catch (failure) { usage_error.as(failure.message || String(failure)); }
    finally { usage_busy.as(false); }
  }

  return {
    state: { files, busy, usage_busy, loaded, error, usage_error,
      usage_label: computed(usage, value => value ? (value.truncated ? "≥ " : "") + format_bytes(value.bytes) : "—"),
      count_label: computed(usage, value => value ? (value.truncated ? "≥ " : "") + value.objects + " 个文件" : "—"),
      usage_status: computed(usage, value => !value ? "" : (value.truncated
        ? "文件较多，当前显示已扫描部分的用量下限。"
        : "统计时间：" + format_datetime(value.generated_at, { fallback: "—" }))),
      page_label: computed(cursors, value => "第 " + value.length + " 页 · 每页 100 个文件"),
      can_previous: computed(cursors, value => value.length > 1),
      can_next: computed(next_cursor, Boolean),
    },
    methods: {
      refresh: () => Promise.all([load_page([null]), load_usage()]),
      previous: () => cursors.value.length > 1 ? load_page(cursors.value.slice(0, -1)) : undefined,
      next: () => next_cursor.value ? load_page([...cursors.value, next_cursor.value]) : undefined,
    },
  };
}
