import { page_source } from "./page_source.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";

test("消息模型接收实时通知、标记已读、删除已读并在断线后重连", async () => {
  const element = (props, children = []) => ({ props, children });
  const ref = value => ({ __is_ref: true, value, set(next) { this.value = next; }, as(next) { this.value = next; } });
  const stored = new Map(), sockets = [], timers = [];
  let messages = [{ id: 1, error_text: "boom\n at handler (script-source.js:3:18)", params: { gh: "gh_e59ba9dfaa66" }, query: { offset: "20" }, created_at: Date.now(), source: "request" }];
  let request_error = false;
  const deleted_read_ids = [];
  const window = {
    location: { href: "http://localhost/messages" },
    localStorage: { getItem: key => stored.get(key), setItem: (key, value) => stored.set(key, value) },
    setTimeout: fn => { timers.push(fn); return timers.length; }, clearTimeout() {},
    WebSocket: class {
      constructor(url) { this.url = url; sockets.push(this); }
      close() { this.onclose?.(); }
    },
    FindRSSAdminAuth: { async fetch(url, options) {
      if (options?.method === "DELETE") {
        if (request_error) return { ok: false, json: async () => ({ error: "删除失败" }) };
        const read_id = Number(new URL(url, window.location.href).searchParams.get("read_id"));
        deleted_read_ids.push(read_id);
        messages = messages.filter(row => row.id > read_id);
        return { ok: true, json: async () => ({ ok: true }) };
      }
      return { ok: !request_error, status: 500, json: async () => request_error ? { error: "加载失败" } : { messages, next_before_id: url.includes("before_id") ? null : 1 } };
    } },
    FindRSSAdminShell: { Page: (options, children) => element(options, children) },
    Timeless: {
      View: element, Button: element, Link: element,
      For: props => element(props, props.each.value.map(props.render)),
      Show: props => element(props, (props.when?.value ?? props.when) ? [props.ok()] : []),
      ref, refarr: ref,
      computed: (source, fn) => ({ get value() { return fn(source.value); } }),
      combine: (sources, fn) => ({ get value() { return fn(Object.fromEntries(Object.entries(sources).map(([key, value]) => [key, value.value]))); } }),
    },
  };
  window.FindRSSAdminUI = window.Timeless;
  const context = { window, URL, URLSearchParams,
    ScriptViewModel: () => ({ state: { saving: ref(false), form_open: ref(false) }, methods: { destroy() {} } }),
    ScriptEditorView: () => element({ attributes: { n: "script-editor" } }),
  };
  vm.runInNewContext(page_source("messages.js"), context);
  const model = window.FindRSSAdminMessages;
  model.methods.start();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(sockets[0].url.protocol, "ws:");
  assert.equal(model.state.badge.value, "1");
  assert.match(model.state.rows.value[0].location, /第 3 行/);
  assert.match(model.state.rows.value[0].parameters, /gh_e59ba9dfaa66/);
  assert.equal(model.state.tab.value, "unread");
  assert.equal(model.state.visible_rows.value.length, 1);
  model.methods.mark_read();
  assert.equal(model.state.badge.value, "");
  assert.equal(model.state.visible_rows.value.length, 0);
  assert.equal(model.state.has_more.value, false);
  model.methods.set_tab("read");
  assert.equal(model.state.visible_rows.value.length, 1);
  assert.equal(model.state.has_more.value, true);
  assert.equal(stored.get("findrss_admin_messages_read"), "1");
  messages = [{ ...messages[0], id: 2 }, messages[0]];
  sockets[0].onmessage({ data: JSON.stringify({ type: "messages.changed" }) });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(model.state.rows.value[0].id, 2);
  assert.equal(model.state.badge.value, "1");
  assert.equal(model.state.visible_rows.value.length, 1);
  assert.equal(model.state.visible_rows.value[0].id, 1);
  model.methods.set_tab("unread");
  assert.equal(model.state.visible_rows.value.length, 1);
  assert.equal(model.state.visible_rows.value[0].id, 2);
  const page = context.MessagesPage();
  assert.equal(page.props.actions[0].props.when.value, false);
  function check_nodes(node) {
    assert.ok(node.props?.attributes?.n || node.props?.title || node.props?.when || node.props?.each);
    for (const child of node.children) if (child && typeof child === "object" && child.props) check_nodes(child);
  }
  check_nodes(page);
  const tabs = page.children[0].children.find(node => node.props?.attributes?.n === "admin-messages-tabs");
  tabs.children[1].props.onClick();
  assert.equal(model.state.tab.value, "read");
  assert.equal(tabs.children[1].props.attributes["aria-pressed"].value, "true");
  const read_page = context.MessagesPage();
  const delete_action = read_page.props.actions[0];
  assert.equal(delete_action.props.when.value, true);
  const delete_button = delete_action.children[0];
  assert.equal(delete_button.props.attributes.n, "admin-messages-delete-read");
  assert.equal(delete_button.children[0].value, "删除全部");
  request_error = true;
  await delete_button.props.onClick();
  assert.equal(model.state.error.value, "删除失败");
  assert.equal(model.state.visible_rows.value.length, 1);
  assert.equal(model.state.deleting.value, false);
  request_error = false;
  const deletion = delete_button.props.onClick();
  assert.equal(delete_button.props.disabled.value, true);
  await model.methods.delete_read();
  await deletion;
  assert.deepEqual(deleted_read_ids, [1]);
  assert.equal(model.state.visible_rows.value.length, 0);
  assert.equal(model.state.rows.value[0].id, 2);
  assert.equal(model.state.badge.value, "1");
  assert.equal(model.state.deleting.value, false);
  sockets[0].onclose();
  timers[0]();
  assert.equal(sockets.length, 2);
  request_error = true;
  await model.methods.load();
  assert.equal(model.state.error.value, "加载失败");
  assert.equal(model.state.rows.value[0].id, 2);
  model.methods.stop();
  assert.equal(model.state.connected.value, false);
});
