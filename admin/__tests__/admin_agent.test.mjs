import assert from "node:assert/strict";
import test from "node:test";
import { AdminAgentModel } from "../components/admin_agent.js";

const ref = value => ({ value, set(next) { this.value = next; }, as(next) { this.value = next; } });
const ui = { ref, refobj: ref, refarr: ref };
function fixture() {
  const sockets = []; let id = 0;
  const model = AdminAgentModel({ ui, new_id: () => "run-" + ++id, location: () => "https://example.com/admin/discovery", request_json: async () => ({ configured: true, providers: [] }),
    create_socket(url) {
      const socket = { url, readyState: 0, sent: [], send(value) { this.sent.push(JSON.parse(value)); }, close() { this.readyState = 3; this.onclose?.(); },
        open() { this.readyState = 1; this.onopen(); }, receive(value) { this.onmessage({ data: JSON.stringify(value) }); } };
      sockets.push(socket); return socket;
    },
  });
  return { model, sockets };
}

test("全局对话使用独立 WS，发送当前路由、筛选与最新表单上下文", async t => {
  const { model, sockets } = fixture(); t.after(model.methods.destroy);
  let selected = "first";
  model.methods.register_page("/admin/discovery", { read_context: () => ({ selected_source_id: selected, filters: { query: "科技" } }) });
  await model.agent.methods.start(); model.agent.methods.set_prompt("修改订阅源"); selected = "second"; model.agent.methods.send(); sockets[0].open();
  assert.equal(sockets[0].url, "wss://example.com/admin/api/agent/ws");
  assert.equal(sockets[0].sent[0].pathname, "/admin/discovery");
  assert.equal(sockets[0].sent[0].page_context.selected_source_id, "second");
  assert.equal(sockets[0].sent[0].script, undefined);
});

test("路由改变取消旧运行并清空旧历史，保持对话窗口开启，迟到事件不刷新或污染新页面", async t => {
  const { model, sockets } = fixture(); t.after(model.methods.destroy);
  let refreshed = 0;
  model.methods.register_page("/admin/discovery", { on_change: () => refreshed++ });
  model.methods.toggle(); await model.agent.methods.start(); model.agent.methods.set_prompt("删除源"); model.agent.methods.send(); sockets[0].open();
  const run_id = sockets[0].sent[0].run_id;
  model.methods.set_pathname("/admin/devices");
  assert.equal(sockets[0].sent.at(-1).type, "cancel");
  assert.equal(model.state.open.value, true); assert.equal(model.state.page.value.pathname, "/admin/devices");
  assert.deepEqual(model.agent.state.messages.value, []);
  sockets[0].receive({ type: "delta", run_id, text: "旧页面回复" });
  sockets[0].receive({ type: "resource_changed", run_id, resource: "discovery", action: "delete" });
  await Promise.resolve(); assert.equal(refreshed, 0); assert.equal(model.agent.state.streaming.value, "");
  await Promise.resolve(); model.agent.methods.set_prompt("查看设备"); model.agent.methods.send(); sockets[1].open();
  assert.equal(sockets[1].sent[0].pathname, "/admin/devices");
  assert.deepEqual(sockets[1].sent[0].messages, [{ role: "user", content: "查看设备" }]);
});

test("资源变更刷新对应页面，旧注册者卸载不会移除新注册者，关闭对话停止更新", async t => {
  const { model, sockets } = fixture(); t.after(model.methods.destroy);
  const events = [];
  const detach = model.methods.register_page("/admin/discovery", { on_change: () => assert.fail("旧组件不该收到事件") });
  model.methods.register_page("/admin/discovery", { on_change: event => events.push(event.action) }); detach();
  await model.agent.methods.start(); model.agent.methods.set_prompt("新增源"); model.agent.methods.send(); sockets[0].open();
  const run_id = sockets[0].sent[0].run_id;
  sockets[0].receive({ type: "resource_changed", run_id, resource: "discovery", action: "create" });
  await new Promise(setImmediate); assert.deepEqual(events, ["create"]);
  model.methods.close(); assert.equal(model.agent.state.busy.value, false);
  sockets[0].receive({ type: "resource_changed", run_id, resource: "discovery", action: "delete" });
  await new Promise(setImmediate); assert.deepEqual(events, ["create"]);
});
