import { create_script_agent_session } from "./script_agent_socket.js";
import { ScriptAgentRunRequestModel } from "./server/domain/script_agent.js";
import { AdminAgentRunRequestModel } from "./server/domain/admin_agent.js";

const topics = new Set(["messages.changed", "devices.changed", "device.logs", "tasks.changed",
  "background-tasks.changed", "discovery.changed", "clips.changed", "detections.changed", "overview.changed", "tokens.changed"]);

// Idle admin connections use DO hibernation. Subscriptions and channel names are
// serialized so they survive eviction; only active agent runs live in memory.
export class AdminSocketHub {
  constructor(ctx, { set_timeout = setTimeout } = {}) {
    this.ctx = ctx;
    this.set_timeout = (...args) => set_timeout(...args);
    this.pending = new Map();
    this.timer = null;
    this.sessions = new Map();
  }
  owns(socket) { return socket.deserializeAttachment()?.kind === "admin"; }
  send(socket, value) {
    try { socket.send(JSON.stringify(value)); }
    catch { this.close(socket); try { socket.close(1011, "send failed"); } catch {} }
  }
  connect(request) {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") return new Response("websocket upgrade required", { status: 426 });
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server, ["admin"]);
    server.serializeAttachment({ kind: "admin", topics: [], channels: {} });
    return new Response(null, { status: 101, webSocket: client });
  }
  invalidate(type, id = null) {
    if (!topics.has(type) || !this.ctx.getWebSockets("admin").length) return;
    let change = this.pending.get(type);
    if (!change) { change = { type, ids: new Set(), all: false }; this.pending.set(type, change); }
    if (typeof id === "string" && id && change.ids.size < 100) change.ids.add(id);
    else change.all = true;
    if (this.timer === null) this.timer = this.set_timeout(() => this.flush(), 200);
  }
  flush() {
    this.timer = null;
    const changes = [...this.pending.values()].map(change => ({ type: change.type, ids: change.all ? [] : [...change.ids] }));
    this.pending.clear();
    for (const socket of this.ctx.getWebSockets("admin")) {
      const selected = new Set(socket.deserializeAttachment()?.topics || []);
      const events = changes.filter(change => selected.has(change.type));
      if (events.length) this.send(socket, { type: "admin.changed", events });
    }
  }
  session(socket, id, name, app) {
    let sessions = this.sessions.get(socket);
    if (!sessions) { sessions = new Map(); this.sessions.set(socket, sessions); }
    if (sessions.has(id)) return sessions.get(id);
    if (!["script-agent", "admin-agent"].includes(name)) throw new Error("此实时通道暂不可用");
    const options = name === "admin-agent" ? { request_model: AdminAgentRunRequestModel,
      run: (input, emit, signal) => app.script_agent.run_admin(input, emit, signal) } : {};
    const session = create_script_agent_session(app.script_agent,
      data => this.send(socket, { type: "channel.message", channel: id, data }), options);
    sessions.set(id, session);
    return session;
  }
  receive(socket, message, app) {
    let command;
    try {
      if (typeof message !== "string" || new TextEncoder().encode(message).length > ScriptAgentRunRequestModel.MAX_MESSAGE_BYTES + 8192) throw new Error("实时消息过大或格式无效");
      command = JSON.parse(message);
      const state = socket.deserializeAttachment();
      if (command.type === "subscribe") {
        if (!Array.isArray(command.topics) || command.topics.length > topics.size || command.topics.some(topic => !topics.has(topic))) throw new Error("无效的实时订阅");
        state.topics = [...new Set(command.topics)]; socket.serializeAttachment(state); return;
      }
      const id = command.channel;
      if (typeof id !== "string" || !/^[a-zA-Z0-9-]{1,128}$/.test(id)) throw new Error("无效的实时通道");
      if (command.type === "channel.close") {
        this.sessions.get(socket)?.get(id)?.close(); this.sessions.get(socket)?.delete(id);
        delete state.channels[id]; socket.serializeAttachment(state); return;
      }
      if (command.type === "channel.open") {
        if (Object.keys(state.channels).length >= 8 && !state.channels[id]) throw new Error("实时通道过多");
        if (!["admin-agent", "script-agent"].includes(command.name)) throw new Error("此实时通道暂不可用");
        state.channels[id] = command.name; socket.serializeAttachment(state);
        this.send(socket, { type: "channel.ready", channel: id });
        this.session(socket, id, command.name, app); return;
      }
      if (command.type !== "channel.message" || !state.channels[id]) throw new Error("实时通道未打开");
      this.session(socket, id, state.channels[id], app).receive(JSON.stringify(command.data));
    } catch (error) {
      this.send(socket, { type: "channel.message", channel: command?.channel,
        data: { type: "error", run_id: command?.data?.run_id || "", error: error.message } });
      if (command?.type === "channel.open") this.send(socket, { type: "channel.closed", channel: command.channel });
    }
  }
  close(socket) {
    for (const session of this.sessions.get(socket)?.values() || []) session.close();
    this.sessions.delete(socket);
  }
}
