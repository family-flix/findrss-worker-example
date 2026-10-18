import assert from "node:assert/strict";
import test from "node:test";
import { create_admin_realtime } from "../realtime.js";

function fixture() {
  const sockets = [], timers = new Map(); let next = 0;
  const transport = create_admin_realtime({ location: () => "https://example.com/admin/overview", random: () => 0,
    new_id: () => "channel-" + ++next,
    timers: { setTimeout(callback, delay) { const id = ++next; timers.set(id, { callback, delay }); return id; }, clearTimeout(id) { timers.delete(id); } },
    create_socket(url) {
      const socket = { url, readyState: 0, sent: [], closes: 0,
        send(value) { this.sent.push(JSON.parse(value)); },
        open() { this.readyState = 1; this.onopen(); },
        receive(value) { this.onmessage({ data: JSON.stringify(value) }); },
        close() { this.closes++; this.readyState = 3; this.onclose?.(); },
      };
      sockets.push(socket); return socket;
    },
  });
  return { transport, sockets, timers };
}

test("消息、页面和多个助手共用一条连接，关闭一个通道不影响其他订阅", () => {
  const { transport, sockets, timers } = fixture(), received = [], agent_events = [];
  const stop_messages = transport.subscribe("messages.changed", value => received.push(value));
  const stop_devices = transport.subscribe(["devices.changed", "tasks.changed"], value => received.push(value));
  const agent = transport.socket("/admin/api/agent/ws"), editor = transport.socket("/admin/api/scripts/agent/ws");
  agent.onopen = () => agent.send(JSON.stringify({ type: "run", run_id: "one" }));
  editor.onmessage = event => agent_events.push(JSON.parse(event.data));
  assert.equal(sockets.length, 1);
  const socket = sockets[0]; socket.open();
  assert.equal(socket.url, "wss://example.com/admin/api/events/ws");
  assert.deepEqual(socket.sent[0], { type: "subscribe", topics: ["messages.changed", "devices.changed", "tasks.changed"] });
  const channels = socket.sent.filter(value => value.type === "channel.open");
  for (const channel of channels) socket.receive({ type: "channel.ready", channel: channel.channel });
  assert.equal(agent.readyState, 1); assert.equal(editor.readyState, 1);
  assert.ok(socket.sent.some(value => value.type === "channel.message" && value.channel === channels[0].channel && value.data.run_id === "one"));
  socket.receive({ type: "channel.message", channel: channels[1].channel, data: { type: "delta", text: "code" } });
  assert.deepEqual(agent_events, [{ type: "delta", text: "code" }]);
  socket.receive({ type: "admin.changed", events: [{ type: "messages.changed", ids: [] }, { type: "clips.changed", ids: [] }] });
  assert.equal(received.filter(value => value.type === "messages.changed").length, 1);
  agent.close(); stop_devices();
  assert.equal(socket.closes, 0); assert.equal(editor.readyState, 1);
  assert.equal(timers.size, 0); // No timer requests while connected and idle.
  stop_messages(); assert.equal(socket.closes, 0);
  editor.close(); assert.equal(socket.closes, 1);
});

test("断线统一退避重连，恢复订阅、通知补同步，进行中的助手请求不会自动重放", () => {
  const { transport, sockets, timers } = fixture(), events = [];
  const stop = transport.subscribe("tasks.changed", value => events.push(value));
  const agent = transport.socket("/admin/api/agent/ws");
  let closed = 0; agent.onclose = () => closed++;
  sockets[0].open(); sockets[0].close();
  assert.equal(closed, 1); assert.equal(timers.size, 1);
  const [id, timer] = [...timers][0]; timers.delete(id); timer.callback();
  assert.equal(sockets.length, 2); sockets[1].open();
  assert.deepEqual(sockets[1].sent, [{ type: "subscribe", topics: ["tasks.changed"] }]);
  assert.equal(events.filter(value => value.type === "realtime.connected").at(-1).reconnected, true);
  sockets[1].close(); assert.equal(timers.size, 1);
  stop(); assert.equal(timers.size, 0);
});

test("页面进入往返缓存时释放连接，返回后恢复原订阅并补同步", () => {
  const { transport, sockets, timers } = fixture(), events = [];
  transport.subscribe("clips.changed", event => events.push(event)); sockets[0].open();
  transport.suspend(); assert.equal(sockets[0].closes, 1); assert.equal(timers.size, 0);
  transport.resume(); sockets[1].open();
  assert.deepEqual(sockets[1].sent[0].topics, ["clips.changed"]);
  assert.equal(events.at(-1).reconnected, true);
  transport.stop();
});
