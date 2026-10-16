import { ScriptDebugOutputModel } from "../components/script_output.js";

const empty_preview = Object.freeze({ kind: "text", mode: "text/plain", formatted: "", src: "", file: null, message: "" });

function NetworkTestModel({ ui = window.FindRSSAdminUI, fetch_impl = (...args) => window.FindRSSAdminAuth.fetch(...args), object_urls = URL } = {}) {
  const state = {
    url: ui.ref("https://m.qidian.com/book/1036526469/catalog/"),
    timeout: ui.ref("10"),
    cookie_domains: ui.ref([]), matching_domains: ui.ref([]), selected_domains: ui.ref([]), cookies_loading: ui.ref(false), cookies_error: ui.ref(""),
    headers: ui.ref(JSON.stringify({
      Referer: "https://m.qidian.com/book/1036526469/",
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "zh-CN,zh;q=0.9",
      "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
    }, null, 2)),
    busy: ui.ref(false), error: ui.ref(""), result: ui.ref(null), preview: ui.ref(empty_preview),
  };
  let controller, cookies_controller;
  let cookie_hostname = "";
  function match_cookie_domains() {
    let hostname = "";
    try {
      const target = new URL(state.url.value.trim());
      if (["http:", "https:"].includes(target.protocol) && !target.username && !target.password) hostname = target.hostname;
    } catch {}
    const matching = state.cookie_domains.value.filter(entry => {
      const domain = entry.domain.replace(/^(?:\*\.|\.)/, "").toLowerCase();
      return hostname && domain && (hostname === domain || hostname.endsWith("." + domain));
    });
    const previous = new Set(state.matching_domains.value.map(entry => entry.domain));
    state.selected_domains.as(matching.filter(entry => hostname !== cookie_hostname || !previous.has(entry.domain) ||
      state.selected_domains.value.includes(entry.domain)).map(entry => entry.domain));
    state.matching_domains.as(matching);
    cookie_hostname = hostname;
  }
  function clear_preview() {
    if (state.preview.value.src) object_urls.revokeObjectURL(state.preview.value.src);
    state.preview.as(empty_preview);
  }
  const methods = {
    set(key, value) {
      if (["url", "timeout", "headers"].includes(key)) state[key].as(value);
      if (key === "url") match_cookie_domains();
    },
    toggle_cookie_domain(domain, checked) {
      if (state.busy.value || state.cookies_loading.value || !state.matching_domains.value.some(entry => entry.domain === domain)) return;
      const selected = new Set(state.selected_domains.value);
      if (checked ?? !selected.has(domain)) selected.add(domain); else selected.delete(domain);
      state.selected_domains.as([...selected]);
    },
    async load_cookie_domains() {
      if (state.cookies_loading.value || state.busy.value) return;
      const active = new AbortController();
      cookies_controller = active;
      state.cookies_loading.as(true); state.cookies_error.as("");
      try {
        const response = await fetch_impl("/admin/api/network-test/cookie-domains", {
          credentials: "same-origin", cache: "no-store", signal: active.signal,
        });
        const result = await response.json();
        if (active.signal.aborted) return;
        if (!response.ok) throw new Error(result.error || "读取 Cookie 域名失败");
        if (!Array.isArray(result.domains)) throw new Error("Cookie 域名接口返回格式不正确");
        state.cookie_domains.as(result.domains);
        match_cookie_domains();
      } catch (failure) {
        if (!active.signal.aborted) state.cookies_error.as(failure.message || "读取 Cookie 域名失败");
      } finally {
        if (cookies_controller === active) { cookies_controller = null; state.cookies_loading.as(false); }
      }
    },
    async run() {
      if (state.busy.value) return;
      state.error.as(""); state.result.as(null);
      clear_preview();
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
      if (Object.keys(headers).some(name => name.toLowerCase() === "cookie")) {
        state.error.as("请勾选已保存的 Cookie 域名，不要在请求头中填写 Cookie"); return;
      }
      const active = new AbortController();
      controller = active;
      state.busy.as(true);
      try {
        const response = await fetch_impl("/admin/api/network-test", {
          method: "POST", credentials: "same-origin", cache: "no-store", signal: active.signal,
          headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: url.href, timeout_ms, headers, cookie_domains: state.selected_domains.value }),
        });
        let result, media;
        if (response.headers.get("Content-Type")?.startsWith("multipart/form-data")) {
          const form = await response.formData();
          result = JSON.parse(form.get("result"));
          media = form.get("media");
        } else { result = await response.json(); }
        if (active.signal.aborted) return;
        if (!response.ok) throw new Error(result.error || "测试失败：HTTP " + response.status);
        const kind = result.body_kind || "text";
        let mode = "text/plain", formatted = result.body || "";
        if (kind === "text") {
          const output = ScriptDebugOutputModel(JSON.stringify({ body: formatted,
            content_type: result.content_type || result.headers?.["content-type"] || "text/plain" }));
          if (output.mode !== "application/xml") { mode = output.mode; formatted = output.formatted; }
        }
        state.preview.as({ kind, mode, formatted, file: result.file || null, message: result.preview_message || "",
          src: media instanceof Blob && ["img", "video", "audio"].includes(kind) ? object_urls.createObjectURL(media) : "" });
        state.result.as(result);
        state.error.as(result.error || "");
      } catch (failure) {
        if (!active.signal.aborted) state.error.as(failure.message || "测试请求失败");
      } finally {
        if (controller === active) { controller = null; state.busy.as(false); }
      }
    },
    leave() {
      controller?.abort(); controller = null; state.busy.as(false);
      cookies_controller?.abort(); cookies_controller = null; state.cookies_loading.as(false); state.cookies_error.as("");
      state.selected_domains.as([]); state.cookie_domains.as([]); state.matching_domains.as([]); cookie_hostname = "";
      state.result.as(null); clear_preview();
    },
  };
  return { state, methods };
}

export { NetworkTestModel };
