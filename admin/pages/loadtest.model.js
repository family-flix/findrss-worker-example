export function LoadTestModel({ on_change, create_socket = url => window.FindRSSAdminRealtime?.socket(url) || new WebSocket(url), location = window.location,
  clock = Date.now, save = (value) => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url; link.download = 'findrss-concurrency-' + value.run_id + '.json'; link.click(); URL.revokeObjectURL(url);
  } }) {
  const state = { connection: '未连接', sources: [], rows: [], summary: {}, scope: 'all', concurrency: '338',
    timeout: '180', cold: true, run_state: 'idle', selected: '', filter: 'all', error: '', run_id: '', now: clock(), events: [] };
  let socket, timer, reconnect, stop_realtime, disposed = false;
  const notify = () => {
    state.now = clock();
    state.elapsed_ms = Number(state.summary.elapsed_ms || 0) +
      (['running', 'stopping'].includes(state.run_state) ? Math.max(0, state.now - (state.summary_received_at ?? state.now)) : 0);
    on_change({ ...state, rows: [...state.rows], by_id: new Map(state.rows.map(row => [row.id, { ...row,
      display_elapsed_ms: row.state === 'running' ? Math.max(0, state.elapsed_ms - (row.started_at - state.started_at)) : row.elapsed_ms,
    }])), events: [...state.events] });
  };
  const log = (text) => {
    state.events.unshift({ at: clock(), text });
    state.events.length = Math.min(state.events.length, 80);
  };
  const apply_run = run => {
    if (!run) return;
    Object.assign(state, { rows: run.rows, summary: run.summary, run_state: run.state, run_id: run.run_id,
      summary_received_at: clock(),
      started_at: run.started_at, ended_at: run.ended_at, scope: run.scope || state.scope,
      concurrency: String(run.concurrency ?? state.concurrency), timeout: String((run.timeout_ms ?? Number(state.timeout) * 1000) / 1000),
      cold: typeof run.cold === 'boolean' ? run.cold : state.cold });
    if (!state.selected && run.rows.length) state.selected = run.rows[0].id;
  };
  const methods = {
    connect() {
      if (disposed || socket && socket.readyState < 2) return;
      state.connection = '连接中'; notify();
      const url = new URL('/admin/api/loadtest/ws', location.href);
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      socket = create_socket(url.href);
      socket.onopen = () => { state.connection = '已连接'; state.error = ''; log('WS 已连接'); socket.send(JSON.stringify({ type: 'hello' })); notify(); };
      socket.onmessage = event => {
        try {
          const message = JSON.parse(event.data);
          if (message.type === 'hello') {
            state.sources = message.sources;
            state.summary = { ...state.summary, ...message.summary };
            if (!message.run && ['starting', 'running', 'stopping'].includes(state.run_state)) {
              state.run_state = 'interrupted'; state.ended_at = clock();
              state.summary.active = 0;
              state.rows = state.rows.map(row => ['queued', 'running'].includes(row.state) ? { ...row, state: 'unknown' } : row);
              state.error = '服务已重载，测试状态已丢失；已下发的设备任务可能继续执行'; log(state.error);
            }
            apply_run(message.run);
          }
          if (message.type === 'started' || message.type === 'finished') {
            apply_run(message.run); log(message.type === 'started' ? '服务端开始并发请求' : '全部请求已返回');
          }
          if (message.type === 'request' || message.type === 'result') {
            const index = state.rows.findIndex(row => row.id === message.row.id);
            if (index >= 0) state.rows[index] = message.row;
            if (message.type === 'result' && !message.row.valid_feed) log(message.row.title + '：' + (message.row.error || '订阅内容无效'));
          }
          if (message.type === 'progress') {
            state.summary = { ...state.summary, ...message.summary };
            state.summary_received_at = clock();
          }
          if (message.type === 'stopping') { state.run_state = 'stopping'; log('停止发起新请求，等待在途请求返回'); }
          if (message.type === 'error') { state.error = message.error; if (state.run_state === 'starting') state.run_state = 'idle'; log(message.error); }
          notify();
        } catch { state.error = 'WS 消息解析失败'; notify(); }
      };
      socket.onclose = event => {
        state.connection = '已断开'; log('WS 已断开，尝试重新连接'); notify();
        if (!disposed && event?.code !== 1008) reconnect = setTimeout(methods.connect, 2000);
      };
      socket.onerror = () => { state.error = 'WS 连接失败，请检查登录状态和服务是否在线'; notify(); };
      if (!timer) timer = setInterval(notify, 250);
      stop_realtime?.();
      stop_realtime = window.FindRSSAdminRealtime?.subscribe(['devices.changed', 'tasks.changed'], event => {
        if ((event.type === 'devices.changed' || event.type === 'tasks.changed') && socket?.readyState === 1 && state.run_state !== 'running') {
          socket.send(JSON.stringify({ type: 'metrics' }));
        }
      });
    },
    set(key, value) {
      if (['scope', 'concurrency', 'timeout', 'cold', 'filter', 'selected'].includes(key)) state[key] = value;
      notify();
    },
    start() {
      if (!socket || socket.readyState !== 1) { state.error = '请等待 WS 连接成功'; notify(); return; }
      if (['starting', 'running', 'stopping'].includes(state.run_state)) return;
      const concurrency = Number(state.concurrency), timeout_ms = Number(state.timeout) * 1000;
      if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 1000 || !Number.isInteger(timeout_ms) || timeout_ms < 1000 || timeout_ms > 180000) {
        state.error = '并发数须为 1–1000，超时须为 1–180 秒'; notify(); return;
      }
      state.error = ''; state.run_state = 'starting'; state.selected = '';
      socket.send(JSON.stringify({ type: 'start', concurrency, timeout_ms, cold: state.cold, scope: state.scope })); notify();
    },
    stop() { if (socket?.readyState === 1) socket.send(JSON.stringify({ type: 'stop' })); },
    export() { if (state.run_id) save({ run_id: state.run_id, rows: state.rows, summary: state.summary }); },
    dispose() { disposed = true; clearInterval(timer); clearTimeout(reconnect); stop_realtime?.(); socket?.close(); },
  };
  return { state, methods };
}
