import assert from "node:assert/strict";
import test from "node:test";
import { ScriptAgentModel } from "../components/script_agent.js";

function ref(value) {
  return { __is_ref: true, value, set(next) { this.value = next; }, as(next) { this.value = next; } };
}
const ui = { ref, refobj: ref, refarr: ref };
function fixture(request_json = async () => ({ base_url: "https://models.example/v1", model: "m", configured: true, has_api_key: true })) {
  const sockets = [], edits = [], debug = [];
  let revision = 4, ids = 0;
  const model = ScriptAgentModel({ ui, request_json, location: () => "http://localhost:8787/admin/scripts", new_id: () => "id-" + ++ids,
    get_context: () => ({ ready: true, script: "current", revision, request_url: "/debug/sample/1", route: "script-id" }),
    apply_script: event => { if (event.expected_revision !== revision) return false; revision = event.revision; edits.push(event.script); return true; },
    apply_debug: event => debug.push(event.result),
    create_socket(url) {
      const socket = { url, readyState: 0, sent: [], send(value) { this.sent.push(JSON.parse(value)); },
        open() { this.readyState = 1; this.onopen(); }, receive(value) { this.onmessage({ data: JSON.stringify(value) }); },
        close() { this.readyState = 3; this.onclose?.(); } };
      sockets.push(socket); return socket;
    },
  });
  return { model, sockets, edits, debug, manual_edit: () => revision++ };
}

test("对话携带当前草稿、版本、链接和历史，流式回答与代码/Debug 分别实时更新", async t => {
  const { model, sockets, edits, debug } = fixture();
  t.after(model.methods.close);
  await model.methods.start();
  model.methods.set_prompt("修改脚本并调试"); model.methods.send();
  assert.equal(model.state.busy.value, true);
  sockets[0].open();
  const command = sockets[0].sent[0];
  assert.equal(command.script, "current"); assert.equal(command.revision, 4);
  assert.equal(command.request_url, "/debug/sample/1");
  assert.deepEqual(command.messages, [{ role: "user", content: "修改脚本并调试" }]);
  assert.equal(command.ready, undefined);
  const emit = value => sockets[0].receive({ ...value, run_id: command.run_id });
  emit({ type: "delta", text: "先修改" });
  assert.equal(model.state.streaming.value, "先修改");
  emit({ type: "tool_start", tool: "edit_script_draft" });
  emit({ type: "draft", expected_revision: 4, revision: 5, script: "new code" });
  assert.deepEqual(edits, ["new code"]);
  emit({ type: "debug", revision: 5, result: { status: 200 } }); assert.deepEqual(debug, [{ status: 200 }]);
  emit({ type: "delta", text: "验证成" });
  emit({ type: "done", content: "验证成功" });
  assert.equal(model.state.busy.value, false);
  assert.deepEqual(model.state.messages.value.map(row => row.content), ["修改脚本并调试", "先修改", "验证成功"]);
});

test("手动修改版本后拒绝迟到代码，停止当前运行，下一轮不接收旧事件", async t => {
  const { model, sockets, edits, manual_edit } = fixture(); t.after(model.methods.close);
  await model.methods.start(); model.methods.set_prompt("edit"); model.methods.send(); sockets[0].open();
  const run_id = sockets[0].sent[0].run_id;
  manual_edit();
  sockets[0].receive({ type: "draft", run_id, expected_revision: 4, revision: 5, script: "stale" });
  assert.deepEqual(edits, []); assert.equal(model.state.busy.value, false);
  assert.equal(sockets[0].sent.at(-1).type, "cancel");
  model.methods.set_prompt("try again"); model.methods.send(); sockets[1].open();
  sockets[0].receive({ type: "draft", run_id, expected_revision: 5, revision: 6, script: "old channel" });
  sockets[1].receive({ type: "delta", run_id, text: "old run" });
  assert.deepEqual(edits, []); assert.equal(model.state.streaming.value, "");
});

test("关闭表单不接受迟到模型配置，重新加载可恢复设置", async () => {
  let finish;
  const { model } = fixture(() => new Promise(resolve => { finish = resolve; }));
  const pending = model.methods.start(); model.methods.close();
  finish({ configured: true, providers: [{ id: "late" }] }); await pending;
  assert.equal(model.state.settings.value.configured, false);
  assert.equal(model.state.config.value.open, false);
  assert.equal(model.state.config.value.loading, false);
});

test("缺配置不会连接；连接中止和模型错误保留已收到的部分回答并允许继续", async t => {
  const { model, sockets } = fixture(async () => ({ configured: false })); t.after(model.methods.close);
  await model.methods.start(); model.methods.set_prompt("create"); model.methods.send();
  assert.equal(sockets.length, 0); assert.equal(model.state.config.value.open, true);
  model.state.settings.as({ configured: true }); model.methods.send(); sockets[0].open();
  const run_id = sockets[0].sent[0].run_id;
  sockets[0].receive({ type: "delta", run_id, text: "部分答案" }); sockets[0].close();
  assert.equal(model.state.messages.value.at(-1).content, "部分答案");
  assert.equal(model.state.busy.value, false); assert.match(model.state.error.value, /断开/);
});
