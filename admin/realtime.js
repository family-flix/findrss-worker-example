// One physical connection per admin tab. Pages subscribe to changes; agent panels
// use independent logical channels so closing a panel never closes other pages.
export function create_admin_realtime({ location = () => window.location.href,
  create_socket = url => new window.WebSocket(url), timers = globalThis,
  random = Math.random, new_id = () => crypto.randomUUID() } = {}) {
  const subscriptions = new Set(), channels = new Map();
  let socket = null, retry = null, connection_timer = null, attempts = 0, connected_before = false, stopped = false;
  const notify = event => {
    for (const entry of [...subscriptions]) {
      if (event.type.startsWith("realtime.") || entry.topics.includes(event.type)) {
        try { entry.receive(event); } catch (error) { console.error("Admin realtime listener failed", error); }
      }
    }
  };
  const send = value => { if (socket?.readyState === 1) socket.send(JSON.stringify(value)); };
  const subscribe_topics = () => send({ type: "subscribe", topics: [...new Set([...subscriptions].flatMap(entry => entry.topics))] });
  function connect() {
    if (stopped || socket || retry !== null || (!subscriptions.size && !channels.size)) return;
    const url = new URL("/admin/api/events/ws", location());
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    let current;
    try { current = create_socket(url.href); } catch { reconnect(); return; }
    socket = current;
    connection_timer = timers.setTimeout(() => { if (socket === current && current.readyState !== 1) current.close(); }, 10000);
    current.onopen = () => {
      if (socket !== current) return;
      timers.clearTimeout(connection_timer); connection_timer = null;
      attempts = 0;
      subscribe_topics();
      for (const channel of channels.values()) channel.open();
      notify({ type: "realtime.connected", reconnected: connected_before });
      connected_before = true;
    };
    current.onmessage = event => {
      if (socket !== current) return;
      let value;
      try { value = JSON.parse(event.data); } catch { return; }
      if (!value || typeof value !== "object") return;
      if (value.type === "channel.ready") channels.get(value.channel)?.ready();
      else if (value.type === "channel.message") channels.get(value.channel)?.receive(value.data);
      else if (value.type === "channel.closed") channels.get(value.channel)?.close(false);
      else if (value.type === "admin.changed" && Array.isArray(value.events)) {
        for (const change of value.events) if (typeof change?.type === "string") notify(change);
      }
    };
    current.onclose = () => {
      if (socket !== current) return;
      timers.clearTimeout(connection_timer); connection_timer = null;
      socket = null;
      // A disconnected agent run is never replayed automatically.
      for (const channel of [...channels.values()]) channel.close(false, 1006);
      notify({ type: "realtime.disconnected" });
      reconnect();
    };
    current.onerror = () => { if (socket === current) current.close(); };
  }
  function reconnect() {
    if (stopped || retry !== null || (!subscriptions.size && !channels.size)) return;
    const delay = Math.min(30000, 1000 * 2 ** Math.min(attempts++, 5)) + Math.floor(random() * 500);
    retry = timers.setTimeout(() => { retry = null; connect(); }, delay);
  }
  function release() {
    if (subscriptions.size || channels.size) return;
    timers.clearTimeout(retry); retry = null;
    timers.clearTimeout(connection_timer); connection_timer = null;
    const previous = socket; socket = null; previous?.close();
  }
  return {
    subscribe(topics, receive) {
      const entry = { topics: Array.isArray(topics) ? topics : [topics], receive };
      subscriptions.add(entry); stopped = false; connect(); subscribe_topics();
      if (socket?.readyState === 1) receive({ type: "realtime.connected", reconnected: false });
      return () => { subscriptions.delete(entry); subscribe_topics(); release(); };
    },
    socket(url) {
      const path = new URL(url, location()).pathname;
      const name = ({ "/admin/api/agent/ws": "admin-agent", "/admin/api/scripts/agent/ws": "script-agent",
        "/admin/api/loadtest/ws": "loadtest" })[path];
      if (!name) throw new Error("Unsupported admin channel");
      const id = new_id();
      const facade = { readyState: 0, onopen: null, onmessage: null, onclose: null, onerror: null,
        open() { send({ type: "channel.open", channel: id, name }); },
        ready() { if (facade.readyState === 0) { facade.readyState = 1; facade.onopen?.({}); } },
        receive(value) { facade.onmessage?.({ data: JSON.stringify(value) }); },
        send(data) {
          if (facade.readyState !== 1) throw new Error("Admin channel is not connected");
          send({ type: "channel.message", channel: id, data: JSON.parse(data) });
        },
        close(remote = true, code = remote ? 1000 : 1008) {
          if (facade.readyState === 3) return;
          if (remote) send({ type: "channel.close", channel: id });
          channels.delete(id); facade.readyState = 3; facade.onclose?.({ code }); release();
        },
      };
      channels.set(id, facade); stopped = false;
      if (socket?.readyState === 1) facade.open(); else connect();
      return facade;
    },
    stop() {
      stopped = true; subscriptions.clear();
      for (const channel of [...channels.values()]) channel.close();
      release();
    },
    suspend() {
      stopped = true;
      timers.clearTimeout(retry); retry = null;
      timers.clearTimeout(connection_timer); connection_timer = null;
      const previous = socket; socket = null;
      for (const channel of [...channels.values()]) channel.close(false, 1006);
      previous?.close();
      notify({ type: "realtime.disconnected" });
    },
    resume() { stopped = false; connect(); },
  };
}
