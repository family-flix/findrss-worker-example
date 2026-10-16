function NetworkTestModel({ ui = window.FindRSSAdminUI, fetch_impl = (...args) => window.FindRSSAdminAuth.fetch(...args) } = {}) {
  const state = {
    url: ui.ref("https://m.qidian.com/book/1036526469/catalog/"),
    timeout: ui.ref("10"),
    headers: ui.ref(JSON.stringify({
      Referer: "https://m.qidian.com/book/1036526469/",
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "zh-CN,zh;q=0.9",
      "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
    }, null, 2)),
    busy: ui.ref(false), error: ui.ref(""), result: ui.ref(null),
  };
  let controller;
  const methods = {
    set(key, value) { if (["url", "timeout", "headers"].includes(key)) state[key].as(value); },
    async run() {
      if (state.busy.value) return;
      state.error.as(""); state.result.as(null);
      let url, headers;
      try {
        url = new URL(state.url.value.trim());
        if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error();
      } catch { state.error.as("请输入完整的 HTTP(S) 网址"); return; }
      const timeout_ms = Number(state.timeout.value) * 1000;
      if (!Number.isInteger(timeout_ms) || timeout_ms < 1000 || timeout_ms > 60000) {
        state.error.as("超时须为 1–60 秒"); return;
      }
      try {
        headers = JSON.parse(state.headers.value.trim() || "{}");
        if (!headers || typeof headers !== "object" || Array.isArray(headers) || Object.values(headers).some(value => typeof value !== "string")) throw new Error();
      } catch { state.error.as("请求头须为 JSON 对象，值须为字符串"); return; }
      const active = new AbortController();
      controller = active;
      state.busy.as(true);
      try {
        const response = await fetch_impl("/admin/api/network-test", {
          method: "POST", credentials: "same-origin", cache: "no-store", signal: active.signal,
          headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: url.href, timeout_ms, headers }),
        });
        const result = await response.json();
        if (active.signal.aborted) return;
        if (!response.ok) throw new Error(result.error || "测试失败：HTTP " + response.status);
        state.result.as(result);
        state.error.as(result.error || "");
      } catch (failure) {
        if (!active.signal.aborted) state.error.as(failure.message || "测试请求失败");
      } finally {
        if (controller === active) { controller = null; state.busy.as(false); }
      }
    },
    leave() { controller?.abort(); controller = null; state.busy.as(false); },
  };
  return { state, methods };
}

export { NetworkTestModel };
