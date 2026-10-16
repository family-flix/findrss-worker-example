import { NetworkTestModel } from "./network.model.js";

const { View, Button, Input, Textarea, Show, computed } = window.FindRSSAdminUI;

function NetworkTestPage({ view } = {}) {
  const model = NetworkTestModel();
  const { state, methods } = model;
  let stop_hide;
  const output = (name, label, value) => View({ class: "grid min-w-0 gap-space-2", attributes: { n: "network-" + name } }, [
    View({ as: "h2", class: "m-0 text-sm", attributes: { n: "network-" + name + "-label" } }, [label]),
    View({ as: "pre", class: "box-border m-0 overflow-auto whitespace-pre-wrap break-anywhere bg-surface-raised rounded-control",
      style: { padding: "12px", "max-height": "420px", "font-size": "12px", "line-height": "1.7" },
      attributes: { n: "network-" + name + "-value" } }, [value]),
  ]);
  return window.FindRSSAdminShell.Page({ page_id: "network", title: "网络测试" }, [
    View({ class: "grid min-w-0 gap-space-4", attributes: { n: "network-test", "aria-busy": computed(state.busy, String) },
      onMounted() { stop_hide = view?.onBeforeHide(methods.leave); },
      onUnmounted() { stop_hide?.(); methods.leave(); } }, [
      View({ class: "text-muted text-sm", attributes: { n: "network-description" } }, [
        "由当前 Worker 发起 GET 请求，默认使用起点示例的请求头。可修改网址和请求头，比较不同网站的访问结果。",
      ]),
      Input({ label: "目标网址", value: state.url, disabled: state.busy, placeholder: "https://example.com/",
        attributes: { n: "network-url", type: "url", spellcheck: "false" },
        onInput: event => methods.set("url", event.target.value), onEnter: methods.run }),
      Input({ label: "超时（秒）", value: state.timeout, disabled: state.busy,
        attributes: { n: "network-timeout", type: "number", min: "1", max: "60", step: "1" },
        onInput: event => methods.set("timeout", event.target.value) }),
      Textarea({ label: "请求头（JSON）", value: state.headers, disabled: state.busy, rows: 7,
        attributes: { n: "network-headers", spellcheck: "false" },
        help: "可设置 User-Agent、Referer、Accept 等脚本支持的请求头；不会自动携带后台或站点 Cookie。",
        onInput: event => methods.set("headers", event.target.value) }),
      Button({ class: "justify-self-start", disabled: state.busy, attributes: { n: "network-test-start" }, onClick: methods.run },
        [computed(state.busy, busy => busy ? "正在请求…" : "开始测试")]),
      View({ class: "text-danger whitespace-pre-wrap break-anywhere", attributes: { n: "network-error", role: "alert" } }, [state.error]),
      Show({ when: computed(state.result, Boolean), ok: () => View({ class: "grid min-w-0 gap-space-4", attributes: { n: "network-result" } }, [
        View({ class: "text-sm whitespace-pre-wrap break-anywhere", attributes: { n: "network-summary", role: "status" } }, [
          computed(state.result, result => result ? [
            result.status == null ? "未收到 HTTP 响应" : `HTTP ${result.status} ${result.status_text}`.trim(),
            `总耗时 ${result.elapsed_ms} ms`,
            result.headers_ms == null ? "" : `收到响应头 ${result.headers_ms} ms`,
            result.colo ? `Worker 入口 ${result.colo}` : "",
          ].filter(Boolean).join(" · ") : ""),
        ]),
        output("trace", "请求过程", computed(state.result, result => (result?.requests || []).map(entry =>
          `${entry.status ?? "无响应"}  ${entry.elapsed_ms} ms  ${entry.url}`).join("\n"))),
        output("response-headers", "响应头", computed(state.result, result => JSON.stringify(result?.headers || {}, null, 2))),
        output("response-body", "响应正文（最多 64KB，按纯文本显示）", computed(state.result, result => result?.body || "（空）")),
        View({ class: "text-muted text-sm", attributes: { n: "network-body-size" } }, [
          computed(state.result, result => result ? `已读取 ${result.body_bytes} 字节${result.truncated ? "，正文已截断" : ""}` : ""),
        ]),
      ]) }),
    ]),
  ]);
}

export { NetworkTestPage };
