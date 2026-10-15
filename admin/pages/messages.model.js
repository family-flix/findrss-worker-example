import { ScriptViewModel } from "./script.model.js";

const { ref, refarr } = window.FindRSSAdminUI;

function message_value(value) {
  const row = value?.__is_ref ? value.value : value;
  const error_text = String(row.error_text || row.message || "").replaceAll("\\n", "\n");
  const location = error_text.match(/(?:script-source\.js|mock-ctx\.js):(\d+)(?::(\d+))?/);
  return {
    ...row,
    error_text,
    location: location ? "第 " + location[1] + " 行" + (location[2] ? "，第 " + location[2] + " 列" : "") + " · " + location[0] : (error_text.includes("script.js:") ? "历史记录：堆栈为沙箱行号" : "未提供源码位置"),
    parameters: JSON.stringify({ params: row.params || {}, query: row.query || {} }, null, 2),
    time: new Date(Number(row.created_at)).toLocaleString(),
    source_label: ({ request: "订阅请求", test: "测试运行", save: "保存校验" })[row.source] || row.source,
  };
}

function AdminMessagesModel() {
  const rows = refarr([]);
  const error = ref("");
  const loading = ref(false);
  const deleting = ref(false);
  const opening_script = ref(false);
  const editor = ScriptViewModel();
  const connected = ref(false);
  const cursor = ref(null);
  const tab = ref("unread");
  let stored_read = 0;
  try { stored_read = Number(window.localStorage.getItem("findrss_admin_messages_read")) || 0; } catch {}
  const read_id = ref(stored_read);
  const visible_rows = window.Timeless.combine({ rows, read_id, tab }, state =>
    state.rows.filter(value => (message_value(value).id > state.read_id) === (state.tab === "unread")));
  const has_more = window.Timeless.combine({ rows, read_id, tab, cursor }, state =>
    Boolean(state.cursor) && (state.tab === "read" ? state.read_id > 0 :
      state.rows.length > 0 && Math.min(...state.rows.map(value => message_value(value).id)) > state.read_id));
  // 两个 ref 都参与订阅，标记已读也要更新导航徽标。
  // ponytail: 徽标只统计已加载的消息，50+ 封顶；需要精确总数时再加服务端 count。
  const badge = window.Timeless.combine({ rows, read_id }, state => {
    const count = state.rows.filter(row => message_value(row).id > state.read_id).length;
    return count >= 50 ? "50+" : count ? String(count) : "";
  });
  let socket = null;
  let retry_timer = null;
  let started = false;
  let refresh_pending = false;

  async function load(older = false) {
    if (loading.value) { if (!older) refresh_pending = true; return; }
    if (older && !cursor.value) return;
    loading.set(true);
    error.set("");
    try {
      const query = new URLSearchParams({ limit: "50" });
      if (older) query.set("before_id", String(cursor.value));
      const response = await window.FindRSSAdminAuth.fetch("/admin/api/messages?" + query, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "消息加载失败：HTTP " + response.status);
      if (!Array.isArray(payload.messages)) throw new Error("消息接口返回格式不正确");
      const next = payload.messages.map(message_value);
      rows.as(older ? rows.value.concat(next) : next);
      cursor.set(payload.next_before_id || null);
    } catch (failure) {
      error.set(failure instanceof Error ? failure.message : String(failure));
    } finally {
      loading.set(false);
      if (refresh_pending) { refresh_pending = false; void load(); }
    }
  }

  function connect() {
    if (!started) return;
    const url = new URL("/admin/api/messages/ws", window.location.href);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    socket = new window.WebSocket(url);
    socket.onopen = () => { connected.set(true); void load(); };
    socket.onmessage = event => {
      try { if (JSON.parse(event.data).type === "messages.changed") void load(); } catch {}
    };
    socket.onclose = () => {
      connected.set(false);
      if (started) retry_timer = window.setTimeout(connect, 3000);
    };
    socket.onerror = () => socket?.close();
  }

  const methods = {
    load,
    async edit_script(script_id) {
      if (opening_script.value || editor.state.saving.value || editor.state.form_open.value) return;
      error.set("");
      if (!script_id) { error.set("该消息没有关联已保存的脚本"); return; }
      opening_script.set(true);
      try {
        await editor.methods.start();
        if (editor.state.list_error.value) throw new Error(editor.state.list_error.value);
        if (!editor.state.scripts.value.some(script => script.id === script_id)) throw new Error("脚本已删除或不存在，无法编辑");
        editor.methods.edit_script(script_id);
      } catch (failure) {
        error.set(failure instanceof Error ? failure.message : String(failure));
      } finally {
        opening_script.set(false);
      }
    },
    async delete_read() {
      if (loading.value || deleting.value || read_id.value <= 0) return;
      deleting.set(true);
      error.set("");
      try {
        const response = await window.FindRSSAdminAuth.fetch("/admin/api/messages?read_id=" + read_id.value, { method: "DELETE" });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "消息删除失败：HTTP " + response.status);
        await load();
      } catch (failure) {
        error.set(failure instanceof Error ? failure.message : String(failure));
      } finally {
        deleting.set(false);
      }
    },
    set_tab(value) { tab.set(value === "read" ? "read" : "unread"); },
    start() {
      if (started) return;
      started = true;
      void load();
      connect();
    },
    stop() {
      started = false;
      window.clearTimeout(retry_timer);
      socket?.close();
      socket = null;
      connected.set(false);
      editor.methods.destroy();
    },
    mark_read() {
      const latest = Math.max(read_id.value, ...rows.value.map(row => message_value(row).id));
      read_id.set(latest);
      try { window.localStorage.setItem("findrss_admin_messages_read", String(latest)); } catch {}
    },
  };
  return { state: { rows, visible_rows, tab, has_more, error, loading, deleting, opening_script, connected, cursor, read_id, badge }, methods, editor };
}

const messages_model = AdminMessagesModel();

window.FindRSSAdminMessages = messages_model;

export { message_value, AdminMessagesModel, messages_model };
