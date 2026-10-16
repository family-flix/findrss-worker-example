import { format_bytes } from "../utils.js";
import { format_datetime } from "../../server/lib/datetime.js";

export function StorageModel() {
  const { ref, computed } = window.FindRSSAdminUI;
  const rows = ref([]), busy = ref(false), usage_busy = ref(false), error = ref(""), usage_error = ref("");
  const usage = ref(null), active_key = ref(null), preview = ref(null);
  const root = { key: "", folder: true, expanded: true, children: [], loaded: false };
  const nodes = new Map([["", root]]);
  let generation = 0, disposed = false, preview_request = null;

  async function request(path, options = {}) {
    const response = await window.FindRSSAdminAuth.fetch("/admin/api/storage" + path, {
      credentials: "same-origin", cache: "no-store", ...options,
    });
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      throw new Error(result.error || "读取失败：HTTP " + response.status);
    }
    return response;
  }

  function render() {
    const visible = [];
    function append(directory, depth) {
      for (const key of directory.children) {
        const node = nodes.get(key);
        visible.push({ ...node, id: "node:" + key, children: undefined, depth, parent: directory.key });
        if (node.folder && node.expanded) append(node, depth + 1);
      }
      if (directory.busy || directory.error || directory.cursor || !directory.loaded) visible.push({
        id: "more:" + directory.key, key: "more:" + directory.key, parent: directory.key, depth, more: true, busy: directory.busy,
        title: directory.busy ? "正在读取…" : directory.error ? directory.error + " · 点击重试" : "加载更多",
      });
    }
    append(root, 0);
    rows.as(visible);
    if (!visible.some(row => row.id === active_key.value)) active_key.as(visible[0]?.id ?? null);
  }

  async function load_directory(directory, append = false) {
    if (disposed || directory.busy) return;
    const version = generation;
    directory.busy = true;
    directory.error = "";
    render();
    try {
      const params = new URLSearchParams({ prefix: directory.key });
      if (append && directory.cursor) params.set("cursor", directory.cursor);
      const result = await (await request("?" + params)).json();
      if (disposed || version !== generation) return;
      const children = append ? new Set(directory.children) : new Set();
      for (const key of result.delimited_prefixes) {
        if (!nodes.has(key)) nodes.set(key, { key, title: key.slice(0, -1).split("/").at(-1), folder: true, children: [], loaded: false, expanded: true });
        children.add(key);
      }
      for (const file of result.objects) {
        nodes.set(file.key, { ...file, title: file.key.split("/").at(-1), folder: false,
          size_label: format_bytes(file.size), uploaded_label: format_datetime(file.uploaded, { fallback: "—" }),
        });
        children.add(file.key);
      }
      directory.children = [...children].sort((left, right) => Number(nodes.get(right).folder) - Number(nodes.get(left).folder) || left.localeCompare(right));
      directory.cursor = result.truncated ? result.cursor : null;
      directory.loaded = true;
      if (directory === root) error.as("");
      return true;
    } catch (failure) {
      if (disposed || version !== generation) return;
      directory.error = failure.message || String(failure);
      if (directory === root) error.as(directory.error);
    } finally {
      if (!disposed && version === generation) { directory.busy = false; render(); }
    }
  }

  async function load_tree(directory = root) {
    const version = generation, queue = [directory], scheduled = new Set([directory.key]);
    while (queue.length && !disposed && version === generation) {
      await Promise.all(queue.splice(0, 4).map(async parent => {
        if (!await load_directory(parent, parent.loaded) || disposed || version !== generation) return;
        if (parent.cursor) queue.push(parent);
        for (const key of parent.children) {
          const child = nodes.get(key);
          if (child.folder && !scheduled.has(key)) { scheduled.add(key); queue.push(child); }
        }
      }));
    }
  }

  function close_preview() {
    preview_request?.abort();
    preview_request = null;
    preview.as(null);
  }

  async function open_preview(node) {
    close_preview();
    const controller = new AbortController();
    preview_request = controller;
    const value = { ...node, loading: true, text: "", kind: "", error: "", truncated: false };
    preview.as(value);
    const current = () => !disposed && preview_request === controller;
    const path = "/file?key=" + encodeURIComponent(node.key);
    try {
      const head = await request(path, { method: "HEAD", signal: controller.signal });
      if (!current()) return;
      const content_type = head.headers.get("Content-Type") || "";
      if (/^image\//i.test(content_type)) {
        preview.as({ ...value, loading: false, kind: "image", src: "/admin/api/storage" + path });
        return;
      }
      if (!/^(text\/|application\/json)/i.test(content_type)) {
        preview.as({ ...value, loading: false, kind: "unsupported" });
        return;
      }
      const response = await request(path, { signal: controller.signal });
      if (!current()) { await response.body?.cancel(); return; }
      const reader = response.body.getReader(), decoder = new TextDecoder();
      const limit = 1024 * 1024;
      let bytes = 0, text = "", truncated = false;
      // 只预览前 1 MiB，解压后的响应也受限，避免大快照占满页面内存。
      try {
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          const remaining = limit - bytes;
          text += decoder.decode(chunk.value.subarray(0, remaining), { stream: true });
          bytes += chunk.value.byteLength;
          if (bytes > limit) { truncated = true; await reader.cancel(); break; }
        }
        text += decoder.decode();
      } finally { reader.releaseLock(); }
      if (current()) preview.as({ ...value, loading: false, kind: "text", text, truncated });
    } catch (failure) {
      if (current()) preview.as({ ...value, loading: false, error: failure.message || String(failure) });
    }
  }

  async function activate(id) {
    if (disposed) return;
    const row = rows.value.find(row => row.id === id);
    if (!row) return;
    active_key.as(id);
    if (row.more) return load_tree(nodes.get(row.parent));
    const node = nodes.get(row.key);
    if (!node.folder) return open_preview(node);
    node.expanded = !node.expanded;
    render();
    if (node.expanded && !node.loaded) return load_tree(node);
  }

  async function load_usage() {
    if (usage_busy.value || disposed) return;
    usage_busy.as(true); usage_error.as("");
    try {
      const result = await (await request("/usage")).json();
      if (!disposed) usage.as(result);
    } catch (failure) {
      if (!disposed) usage_error.as(failure.message || String(failure));
    } finally { if (!disposed) usage_busy.as(false); }
  }

  return {
    state: { rows, busy, usage_busy, error, usage_error, preview, active_key,
      usage_label: computed(usage, value => value ? (value.truncated ? "≥ " : "") + format_bytes(value.bytes) : "—"),
      count_label: computed(usage, value => value ? (value.truncated ? "≥ " : "") + value.objects + " 个文件" : "—"),
      usage_status: computed(usage, value => !value ? "" : value.truncated ? "文件较多，当前显示已扫描部分的用量下限。" : "统计时间：" + format_datetime(value.generated_at, { fallback: "—" })),
    },
    methods: {
      async refresh() {
        if (busy.value || disposed) return;
        busy.as(true); generation++; close_preview();
        nodes.clear(); nodes.set("", root);
        Object.assign(root, { children: [], loaded: false, cursor: null, busy: false, error: "" });
        try { await Promise.all([load_tree(), load_usage()]); }
        finally { if (!disposed) busy.as(false); }
      },
      activate,
      close_preview,
      preview_error(key) { if (preview.value?.key === key) preview.as({ ...preview.value, error: "图片预览失败，请重试", loading: false }); },
      keydown(event) {
        const index = rows.value.findIndex(row => row.id === active_key.value);
        const row = rows.value[index];
        if (!row || !["ArrowDown", "ArrowUp", "ArrowRight", "ArrowLeft", "Home", "End", "Enter", " "].includes(event.key)) return;
        event.preventDefault();
        let next = index;
        if (event.key === "ArrowDown") next++;
        if (event.key === "ArrowUp") next--;
        if (event.key === "Home") next = 0;
        if (event.key === "End") next = rows.value.length - 1;
        if (event.key === "Enter" || event.key === " ") void activate(row.id);
        if (event.key === "ArrowRight" && row.folder) {
          if (!row.expanded) void activate(row.id); else if (rows.value[index + 1]?.parent === row.key) next++;
        }
        if (event.key === "ArrowLeft") {
          if (row.folder && row.expanded) void activate(row.id);
          else { const parent = rows.value.findIndex(item => item.key === row.parent); if (parent >= 0) next = parent; }
        }
        const target = rows.value[Math.max(0, Math.min(rows.value.length - 1, next))];
        active_key.as(target?.id ?? null);
        return rows.value.indexOf(target);
      },
      dispose() { disposed = true; generation++; close_preview(); },
    },
  };
}
