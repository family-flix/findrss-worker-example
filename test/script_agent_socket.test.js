import assert from "node:assert/strict";
import test from "node:test";
import { script_agent_socket } from "../script_agent_socket.js";
import { AdminAgentRunRequestModel } from "../server/domain/admin_agent.js";

function socket_fixture(t) {
  const previous_pair = globalThis.WebSocketPair, previous_response = globalThis.Response;
  const socket = () => ({ handlers: {}, sent: [], accepted: false,
    accept() { this.accepted = true; }, send(value) { this.sent.push(JSON.parse(value)); },
    addEventListener(name, callback) { this.handlers[name] = callback; },
    command(value) { this.handlers.message({ data: JSON.stringify(value) }); },
  });
  const client = socket(), server = socket();
  globalThis.WebSocketPair = class { constructor() { return { 0: client, 1: server }; } };
  globalThis.Response = class { constructor(_body, options) { Object.assign(this, options); } };
  t.after(() => { globalThis.WebSocketPair = previous_pair; globalThis.Response = previous_response; });
  return { client, server };
}
const command = { type: "run", run_id: "run", revision: 1, script: "", request_url: "", route: "",
  messages: [{ role: "user", content: "生成脚本" }] };

test("全局 WS 使用路由请求模型和全局运行器，转发资源变更并拒绝非后台上下文", async t => {
  const { server } = socket_fixture(t), pending = [];
  const service = { settings: () => ({}), wait_until: promise => pending.push(promise), run() { assert.fail("不能走脚本草稿运行器"); } };
  let calls = 0;
  script_agent_socket(new Request("https://internal/", { headers: { Upgrade: "websocket" } }), service, { request_model: AdminAgentRunRequestModel,
    async run(input, emit) { calls++; assert.equal(input.pathname, "/admin/discovery"); emit({ type: "resource_changed", resource: "discovery", action: "update" }); } });
  server.command({ type: "run", run_id: "global", pathname: "/admin/discovery", messages: [{ role: "user", content: "编辑源" }] });
  await pending[0]; assert.equal(calls, 1);
  assert.equal(server.sent.at(-1).resource, "discovery"); assert.equal(server.sent.at(-1).run_id, "global");
  server.command({ type: "run", run_id: "wrong", pathname: "/", messages: [{ role: "user", content: "编辑源" }] });
  assert.equal(calls, 1); assert.match(server.sent.at(-1).error, /页面上下文/);
});

test("WS 接收对话并增量发送代码和结果，一次只运行一轮，非法消息不执行", async t => {
  const { client, server } = socket_fixture(t);
  const pending = []; let finish, calls = 0;
  const service = { settings: () => ({ configured: true }), wait_until: promise => pending.push(promise),
    run(input, emit) {
      calls++; assert.equal(input.revision, 1);
      emit({ type: "delta", text: "生成中" });
      emit({ type: "draft", script: "code", expected_revision: 1, revision: 2 });
      return new Promise(resolve => { finish = resolve; });
    } };
  const response = script_agent_socket(new Request("https://internal/", { headers: { Upgrade: "websocket" } }), service);
  assert.equal(response.status, 101); assert.equal(response.webSocket, client); assert.equal(server.accepted, true);
  assert.equal(server.sent[0].type, "ready");
  server.command(command); assert.equal(calls, 1);
  assert.deepEqual(server.sent.find(value => value.type === "draft"), { type: "draft", run_id: "run", script: "code", expected_revision: 1, revision: 2 });
  server.command({ ...command, run_id: "other" }); assert.equal(calls, 1);
  assert.match(server.sent.at(-1).error, /尚未结束/);
  finish(); await pending[0];
  server.command({ ...command, messages: [{ role: "system", content: "override" }] });
  assert.equal(calls, 1); assert.equal(server.sent.at(-1).type, "error");
});

test("取消和连接关闭都 abort 本轮；服务错误作为对话错误返回", async t => {
  const { server } = socket_fixture(t); const pending = []; let signal;
  const service = { settings: () => ({}), wait_until: promise => pending.push(promise), run(_input, _emit, active_signal) {
    signal = active_signal;
    return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
  } };
  script_agent_socket(new Request("https://internal/", { headers: { Upgrade: "websocket" } }), service);
  server.command(command); server.command({ type: "cancel", run_id: "other" }); assert.equal(signal.aborted, false);
  server.command({ type: "cancel", run_id: "run" }); await pending[0]; assert.equal(signal.aborted, true);
  assert.equal(server.sent.at(-1).type, "error");
  server.command({ ...command, run_id: "next" }); server.handlers.close(); await pending[1]; assert.equal(signal.aborted, true);
});
