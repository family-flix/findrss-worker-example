import { ScriptDebugOutputModel } from "../components/script_output.js";

const empty_preview = Object.freeze({ kind: "text", mode: "text/plain", formatted: "", src: "", file: null, message: "" });

function NetworkTestModel({ ui = window.FindRSSAdminUI, fetch_impl = (...args) => window.FindRSSAdminAuth.fetch(...args), object_urls = URL, clipboard = globalThis.navigator?.clipboard } = {}) {
  let next_header_id = 0;
  const header_row = (key = "", value = "") => ({ id: next_header_id++, key: ui.ref(key), value: ui.ref(value) });
  const state = {
    url: ui.ref("https://m.qidian.com/book/1036526469/catalog/"),
    timeout: ui.ref("10"),
    cookie_domains: ui.ref([]), matching_domains: ui.ref([]), selected_domains: ui.ref([]), cookies_loading: ui.ref(false), cookies_error: ui.ref(""),
    headers: ui.ref(Object.entries({
      Referer: "https://m.qidian.com/book/1036526469/",
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "zh-CN,zh;q=0.9",
      "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
    }).map(([key, value]) => header_row(key, value))),
    busy: ui.ref(false), copying: ui.ref(false), copied: ui.ref(false), error: ui.ref(""), result: ui.ref(null), preview: ui.ref(empty_preview),
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
      if (state.busy.value) return;
      if (["url", "timeout"].includes(key)) { state[key].as(value); state.copied.as(false); }
      if (key === "url") {
        match_cookie_domains();
        let target;
        try { target = new URL(value.trim()); } catch { return; }
        if (!["http:", "https:"].includes(target.protocol) || target.username || target.password) return;
        target.hash = "";
        const referer = state.headers.value.find(row => row.key.value.trim().toLowerCase() === "referer");
        if (referer) methods.update_header(referer.id, "value", target.href);
        else methods.add_header("Referer", target.href);
      }
    },
    add_header(key = "", value = "") {
      if (state.busy.value) return;
      state.headers.as([...state.headers.value, header_row(key, value)]); state.copied.as(false);
    },
    update_header(id, field, value) {
      if (state.busy.value || !["key", "value"].includes(field)) return;
      const row = state.headers.value.find(row => row.id === id);
      if (row) { row[field].as(value); state.copied.as(false); }
    },
    remove_header(id) {
      if (state.busy.value) return;
      state.headers.as(state.headers.value.filter(row => row.id !== id)); state.copied.as(false);
    },
    toggle_cookie_domain(domain, checked) {
      if (state.busy.value || state.cookies_loading.value || !state.matching_domains.value.some(entry => entry.domain === domain)) return;
      const selected = new Set(state.selected_domains.value);
      if (checked ?? !selected.has(domain)) selected.add(domain); else selected.delete(domain);
      state.selected_domains.as([...selected]); state.copied.as(false);
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
    run() { return submit(); },
    copy_curl() { return submit(true); },
    leave() {
      controller?.abort(); controller = null; state.busy.as(false); state.copying.as(false); state.copied.as(false);
      cookies_controller?.abort(); cookies_controller = null; state.cookies_loading.as(false); state.cookies_error.as("");
      state.selected_domains.as([]); state.cookie_domains.as([]); state.matching_domains.as([]); cookie_hostname = "";
      state.result.as(null); clear_preview();
    },
  };
  async function submit(export_curl = false) {
    if (state.busy.value) return;
    state.error.as(""); state.copied.as(false);
    if (!export_curl) { state.result.as(null); clear_preview(); }
    let url;
    try {
      url = new URL(state.url.value.trim());
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error();
    } catch { state.error.as("请输入完整的 HTTP(S) 网址"); return; }
    const timeout_ms = Number(state.timeout.value) * 1000;
    if (!Number.isInteger(timeout_ms) || timeout_ms < 1000 || timeout_ms > 60000) {
      state.error.as("超时须为 1–60 秒"); return;
    }
    const entries = [], names = new Set();
    for (const row of state.headers.value) {
      const name = row.key.value.trim(), value = row.value.value;
      if (!name && !value) continue;
      if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name)) { state.error.as("请填写有效的请求头名称"); return; }
      if (names.has(name.toLowerCase())) { state.error.as("请求头名称重复：" + name); return; }
      if (/[\r\n\0]/.test(value)) { state.error.as("请求头值不能包含换行或空字符：" + name); return; }
      names.add(name.toLowerCase()); entries.push([name, value]);
    }
    const headers = Object.fromEntries(entries);
    if (Object.keys(headers).some(name => name.toLowerCase() === "cookie")) {
      state.error.as("请勾选已保存的 Cookie 域名，不要在请求头中填写 Cookie"); return;
    }
    const active = new AbortController();
    controller = active;
    state.busy.as(true); state.copying.as(export_curl);
    try {
      const response = await fetch_impl("/admin/api/network-test" + (export_curl ? "/curl" : ""), {
        method: "POST", credentials: "same-origin", cache: "no-store", signal: active.signal,
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: url.href, timeout_ms, headers, cookie_domains: state.selected_domains.value }),
      });
      if (export_curl) {
        const result = await response.json();
        if (active.signal.aborted) return;
        if (!response.ok) throw new Error(result.error || "生成 curl 命令失败");
        if (typeof result.command !== "string" || !result.command) throw new Error("curl 命令接口返回格式不正确");
        if (!clipboard?.writeText) throw new Error("当前浏览器不支持复制，请使用 HTTPS 或本地地址访问");
        await clipboard.writeText(result.command);
        if (!active.signal.aborted) state.copied.as(true);
        return;
      }
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
      if (!active.signal.aborted) state.error.as(failure.message || (export_curl ? "复制 curl 命令失败" : "测试请求失败"));
    } finally {
      if (controller === active) { controller = null; state.busy.as(false); state.copying.as(false); }
    }
  }
  return { state, methods };
}

export { NetworkTestModel };
