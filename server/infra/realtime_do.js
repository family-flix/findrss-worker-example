import { DurableObject } from "cloudflare:workers";

// Connections only: business decisions and persistent data belong to the application Worker.
export class RealtimeHubDO extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.waiters = new Map();
    this.runs = new Map();
  }
  socket(id) {
    return this.ctx.getWebSockets().find(socket => socket.deserializeAttachment()?.connection_id === id);
  }
  connections() {
    return this.ctx.getWebSockets('device').map(socket => socket.deserializeAttachment());
  }
  send(id, message) {
    const socket = this.socket(id);
    if (!socket) throw new Error('设备连接已断开');
    socket.send(message);
  }
  update(id, attachment) {
    this.socket(id)?.serializeAttachment(attachment);
  }
  close_connection(id, code = 1000, reason = '') {
    this.socket(id)?.close(code, reason);
  }
  broadcast(type, id = null) {
    for (const socket of this.ctx.getWebSockets('admin')) {
      const state = socket.deserializeAttachment();
      if (state.topics?.includes(type)) socket.send(JSON.stringify({
        type: 'admin.changed',
        events: [{
          type,
          ids: id ? [id] : []
        }]
      }));
      if (state.legacy_messages && type === 'messages.changed') socket.send(JSON.stringify({
        type: 'messages.changed'
      }));
    }
  }
  async wait(id, timeout, waiter_id = crypto.randomUUID()) {
    if (timeout <= 0) return null;
    let resolve;
    const promise = new Promise(done => {
      resolve = done;
    });
    const waiter = {
      id: waiter_id,
      resolve,
      timer: setTimeout(() => resolve(null), timeout)
    };
    const group = this.waiters.get(id) || new Set();
    group.add(waiter);
    this.waiters.set(id, group);
    try {
      const current = await this.env.APPLICATION_SERVICE.task_status(id);
      if (!current || ['completed', 'failed'].includes(current.status)) return current;
      return await promise;
    } finally {
      clearTimeout(waiter.timer);
      group.delete(waiter);
      if (!group.size) this.waiters.delete(id);
    }
  }
  cancel_wait(id, waiter_id) {
    for (const waiter of this.waiters.get(id) || []) if (waiter.id === waiter_id) waiter.resolve(null);
  }
  resolve(id, row) {
    for (const waiter of this.waiters.get(id) || []) waiter.resolve(row);
  }
  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (!['/connect', '/_admin/events/ws', '/_admin/messages/ws', '/_admin/agent/ws', '/_admin/scripts/agent/ws'].includes(path)) return new Response('not found', {
      status: 404
    });
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('websocket upgrade required', {
      status: 426
    });
    let attachment;
    try {
      attachment = path === '/connect' ? await this.env.APPLICATION_SERVICE.device_connect([...request.headers]) : {
        kind: 'admin',
        connection_id: crypto.randomUUID(),
        topics: [],
        channels: {},
        legacy_messages: path === '/_admin/messages/ws',
        agent: path === '/_admin/agent/ws' ? 'admin-agent' : path === '/_admin/scripts/agent/ws' ? 'script-agent' : ''
      };
    } catch (error) {
      return Response.json({
        error: error.message
      }, {
        status: error.status || 403
      });
    }
    if (path === '/connect') for (const socket of this.ctx.getWebSockets(`client:${attachment.device_id}`)) socket.close(1000, 'replaced');
    const [client, server] = Object.values(new WebSocketPair());
    server.serializeAttachment(attachment);
    this.ctx.acceptWebSocket(server, attachment.kind === 'admin' ? ['admin'] : ['device', `client:${attachment.device_id}`, ...attachment.methods.map(method => `method:${method}`)]);
    if (path === '/connect') {
      server.send(JSON.stringify({
        type: 'device.connected',
        ...attachment,
        at: Date.now()
      }));
      this.ctx.waitUntil(this.env.APPLICATION_SERVICE.device_ready());
    } else if (attachment.legacy_messages) server.send(JSON.stringify({
      type: 'messages.changed'
    }));else if (attachment.agent) server.send(JSON.stringify({
      type: 'ready',
      settings: await this.env.APPLICATION_SERVICE.agent_settings()
    }));
    return new Response(null, {
      status: 101,
      webSocket: client
    });
  }
  async webSocketMessage(socket, message) {
    const state = socket.deserializeAttachment();
    if (state.kind !== 'admin') {
      if (typeof message === 'string' && message.length < 512) {
        try {
          if (JSON.parse(message).type === 'client.heartbeat') {
            state.last_seen_at = Date.now();
            socket.serializeAttachment(state);
            socket.send(JSON.stringify({
              type: 'client.heartbeat.ack',
              at: Date.now()
            }));
            return;
          }
        } catch {}
      }
      return this.env.APPLICATION_SERVICE.device_message(state, message);
    }
    let command;
    try {
      if (typeof message !== 'string' || new TextEncoder().encode(message).length > 1024 * 1024) throw new Error('实时消息过大');
      command = JSON.parse(message);
      if (command.type === 'subscribe') {
        if (!Array.isArray(command.topics) || command.topics.length > 20 || command.topics.some(topic => typeof topic !== 'string' || topic.length > 64)) throw new Error('无效的订阅主题');
        state.topics = command.topics;
        socket.serializeAttachment(state);
        return;
      }
      const channel = command.channel || 'legacy';
      if (!/^[a-zA-Z0-9-]{1,128}$/.test(channel)) throw new Error('无效的通道');
      const key = state.connection_id + ':' + channel;
      if (command.type === 'channel.open') {
        if (!['admin-agent', 'script-agent'].includes(command.name) || Object.keys(state.channels).length >= 8) throw new Error('无效的 Agent 通道');
        state.channels[channel] = command.name;
        socket.serializeAttachment(state);
        socket.send(JSON.stringify({
          type: 'channel.ready',
          channel
        }));
        socket.send(JSON.stringify({
          type: 'channel.message',
          channel,
          data: {
            type: 'ready',
            settings: await this.env.APPLICATION_SERVICE.agent_settings()
          }
        }));
        return;
      }
      const data = command.type === 'channel.message' ? command.data : command;
      if (data.type === 'cancel' || command.type === 'channel.close') {
        await this.runs.get(key)?.cancel?.();
        this.runs.delete(key);
        if (command.type === 'channel.close') {
          delete state.channels[channel];
          socket.serializeAttachment(state);
        }
        return;
      }
      if (data.type !== 'run' || !(state.channels[channel] || state.agent)) throw new Error('无效的 Agent 请求');
      if (this.runs.has(key) || this.runs.size >= 4) throw new Error('对话并发已满，请稍后重试');
      const reservation = {};
      this.runs.set(key, reservation);
      let stream;
      try {
        stream = await this.env.APPLICATION_SERVICE.agent_run(data, state.channels[channel] || state.agent);
      } catch (error) {
        if (this.runs.get(key) === reservation) this.runs.delete(key);
        throw error;
      }
      if (this.runs.get(key) !== reservation) {
        await stream.cancel();
        return;
      }
      const reader = stream.getReader();
      this.runs.set(key, reader);
      const send = data => socket.send(JSON.stringify(channel === 'legacy' ? data : {
        type: 'channel.message',
        channel,
        data
      }));
      this.ctx.waitUntil((async () => {
        try {
          const decoder = new TextDecoder();
          let buffered = '';
          while (true) {
            const {
              value,
              done
            } = await reader.read();
            if (done) break;
            buffered += decoder.decode(value, {
              stream: true
            });
            let end;
            while ((end = buffered.indexOf('\n')) >= 0) {
              const line = buffered.slice(0, end);
              buffered = buffered.slice(end + 1);
              if (line) send(JSON.parse(line));
            }
          }
        } catch (error) {
          send({
            type: 'error',
            run_id: data.run_id || '',
            error: error.message
          });
        } finally {
          if (this.runs.get(key) === reader) this.runs.delete(key);
          reader.releaseLock();
        }
      })());
    } catch (error) {
      const data = {
        type: 'error',
        error: error.message,
        run_id: command?.run_id || command?.data?.run_id || ''
      };
      socket.send(JSON.stringify(command?.channel && /^[a-zA-Z0-9-]{1,128}$/.test(command.channel) ? {
        type: 'channel.message',
        channel: command.channel,
        data
      } : data));
    }
  }
  async webSocketClose(socket, code, reason, clean) {
    const state = socket.deserializeAttachment();
    if (state.kind !== 'admin') return this.env.APPLICATION_SERVICE.device_closed(state, code, reason, clean);
    for (const [key, reader] of this.runs) if (key.startsWith(state.connection_id + ':')) {
      await reader?.cancel?.();
      this.runs.delete(key);
    }
  }
  webSocketError(socket) {
    return this.webSocketClose(socket, 1011, 'websocket error', false);
  }
}
