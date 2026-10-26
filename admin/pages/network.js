import { NetworkTestModel } from "./network.model.js";
import { ScriptMediaPreviewView } from "../components/script_media.js";
import { Checkbox } from "../components/frui/checkbox.js";
import { IconButton } from "../components/frui/icon-button.js";
import { Popconfirm } from "../components/frui/popconfirm.js";

const { View, Badge, Button, Input, Select, For, Show, CodeEditor, computed, combine } = window.FindRSSAdminUI;

function NetworkTestPage({ view } = {}) {
  const model = NetworkTestModel();
  const { state, methods, user_agent_options } = model;
  let stop_show, stop_hide;
  const cookie_disabled = combine({ busy: state.busy, loading: state.cookies_loading }, state => state.busy || state.loading);
  const copy_label = combine({ copying: state.copying, copied: state.copied }, state => state.copying ? "正在复制…" : state.copied ? "已复制 curl 命令" : "复制 curl 命令");
  const status_badge = (status, name, text) => Badge({
    tone: status == null || status >= 400 ? "danger" : status >= 300 ? "warning" : status >= 200 ? "success" : "brand",
    attributes: { n: name },
  }, [text || (status == null ? "无响应" : `HTTP ${status}`)]);
  const output = (name, label, value) => View({ class: "grid min-w-0 gap-space-2", attributes: { n: "network-" + name } }, [
    View({ as: "h2", class: "m-0 text-sm", attributes: { n: "network-" + name + "-label" } }, [label]),
    View({ as: "pre", class: "box-border m-0 overflow-auto whitespace-pre-wrap break-anywhere bg-surface-raised rounded-control",
      style: { padding: "12px", "max-height": "420px", "font-size": "12px", "line-height": "1.7" },
      attributes: { n: "network-" + name + "-value" } }, [value]),
  ]);
  return window.FindRSSAdminShell.Page({ page_id: "network", title: "网络测试" }, [
    View({ class: "grid min-w-0 gap-space-3", attributes: { n: "network-test", "aria-busy": computed(state.busy, String) },
      onMounted() {
        stop_show = view?.onShow(methods.load_cookie_domains);
        stop_hide = view?.onBeforeHide(methods.leave);
        void methods.load_cookie_domains();
      },
      onUnmounted() { stop_show?.(); stop_hide?.(); methods.leave(); } }, [
      View({ class: "text-muted text-sm", attributes: { n: "network-description" } }, [
        "可选择入口 Worker 或脚本宿主发起 GET 请求，默认使用桌面浏览器 User-Agent。复现脚本请求时，请填写相同网址和请求头。",
      ]),
      Input({ label: "目标网址", value: state.url, disabled: state.busy, placeholder: "https://example.com/",
        help: "修改网址后会自动填入 Referer，仍可在下方手动编辑。",
        attributes: { n: "network-url", type: "url", spellcheck: "false" },
        onInput: event => methods.set("url", event.target.value), onEnter: methods.run }),
      Input({ label: "超时（秒）", value: state.timeout, disabled: state.busy,
        attributes: { n: "network-timeout", type: "number", min: "1", max: "60", step: "1" },
        onInput: event => methods.set("timeout", event.target.value) }),
      View({ class: "grid min-w-0 gap-space-2", attributes: { n: "network-transport-field" } }, [
        View({ class: "text-sm", attributes: { n: "network-transport-label", id: "network-transport-label" } }, ["传输方式"]),
        Select({ value: state.transport, disabled: state.busy,
          options: [{ value: "fetch", label: "Fetch（默认）" }, { value: "tcp", label: "TCP（与脚本 transport: tcp 相同）" }],
          attributes: { n: "network-transport", "aria-labelledby": "network-transport-label" },
          onChange: event => methods.set("transport", event.target.value) }),
        View({ class: "text-muted text-sm", attributes: { n: "network-transport-help" } }, [
          "TCP 与 Bilibili 脚本使用相同传输：HTTP/1.1，响应及解压后最多 2MB。复现脚本请求时，请同时填写相同网址、请求头并选择对应 Cookie。",
        ]),
      ]),
      View({ class: "grid min-w-0 gap-space-2", attributes: { n: "network-execution-field" } }, [
        View({ class: "text-sm", attributes: { n: "network-execution-label", id: "network-execution-label" } }, ["执行位置"]),
        Select({ value: state.execution, disabled: state.busy,
          options: [{ value: "worker", label: "入口 Worker（默认）" }, { value: "script", label: "脚本宿主（DO）" }],
          attributes: { n: "network-execution", "aria-labelledby": "network-execution-label" },
          onChange: event => methods.set("execution", event.target.value) }),
        View({ class: "text-muted text-sm", attributes: { n: "network-execution-help" } }, [
          "选择脚本宿主后，由运行脚本的同一个 Durable Object 发起请求，可对比两个执行位置的访问结果。此模式不运行 QuickJS 脚本。",
        ]),
      ]),
      View({ class: "grid min-w-0 gap-space-2", attributes: { n: "network-cookies" } }, [
        View({ class: "flex items-center justify-between gap-space-2", attributes: { n: "network-cookies-header" } }, [
          View({ class: "text-sm", attributes: { n: "network-cookies-label", id: "network-cookies-label" } }, ["已有 Cookie 域名（可选）"]),
          Button({ size: "small", disabled: cookie_disabled, attributes: { n: "network-cookies-refresh" }, onClick: methods.load_cookie_domains }, ["刷新域名"]),
        ]),
        View({ class: "text-muted text-sm", attributes: { n: "network-cookies-help" } }, ["根据目标网址筛选并默认勾选匹配的 Cookie 域名，可手动取消。每次请求按域名、路径、HTTPS 和有效期匹配；未勾选时匿名访问。"]),
        Show({ when: state.cookies_loading, ok: () => View({ class: "text-muted text-sm", attributes: { n: "network-cookies-loading", role: "status" } }, ["正在读取 Cookie 域名…"]) }),
        View({ class: "text-danger text-sm", attributes: { n: "network-cookies-error", role: "alert" } }, [state.cookies_error]),
        Show({ when: combine({ loading: state.cookies_loading, error: state.cookies_error, domains: state.cookie_domains }, state => !state.loading && !state.error && !state.domains.length),
          ok: () => View({ class: "text-muted text-sm", attributes: { n: "network-cookies-empty" } }, ["尚未保存 Cookie，请先在 Cookie 管理中导入。"]) }),
        Show({ when: combine({ loading: state.cookies_loading, error: state.cookies_error, domains: state.cookie_domains, matching: state.matching_domains }, state => !state.loading && !state.error && state.domains.length > 0 && !state.matching.length),
          ok: () => View({ class: "text-muted text-sm", attributes: { n: "network-cookies-no-match" } }, ["没有与目标网址域名匹配的 Cookie。请检查目标网址，或先在 Cookie 管理中导入。"]) }),
        View({ class: "box-border grid min-w-0 gap-space-2 overflow-auto", style: { "max-height": "200px" },
          attributes: { n: "network-cookie-domains", role: "group", "aria-labelledby": "network-cookies-label" } }, [
          For({ each: state.matching_domains, key: "domain", render(value) {
            const entry = value?.__is_ref ? value.value : value;
            return Checkbox({ label: `${entry.domain}（${entry.count} 条）`, disabled: cookie_disabled,
              checked: computed(state.selected_domains, selected => selected.includes(entry.domain)),
              attributes: { n: "network-cookie-domain-" + entry.domain, "aria-label": entry.domain, tabindex: "0" },
              onChange: checked => methods.toggle_cookie_domain(entry.domain, checked),
              onKeyDown(event) {
                if (event.key === " " || event.key === "Enter") { event.preventDefault(); methods.toggle_cookie_domain(entry.domain); }
              } });
          } }),
        ]),
      ]),
      View({ class: "grid min-w-0 gap-space-2", attributes: { n: "network-headers", role: "group", "aria-labelledby": "network-headers-label" } }, [
        View({ class: "flex items-center justify-between gap-space-2", attributes: { n: "network-headers-heading" } }, [
          View({ class: "text-sm", attributes: { n: "network-headers-label", id: "network-headers-label" } }, ["请求头"]),
          Button({ size: "small", disabled: state.busy, attributes: { n: "network-header-add" }, onClick: () => methods.add_header() }, ["添加请求头"]),
        ]),
        For({ each: state.headers, key: "id", render(value) {
          const row = value?.__is_ref ? value.value : value;
          return View({ class: "grid min-w-0 gap-space-2 items-center", style: { "grid-template-columns": "minmax(0, 1fr) minmax(0, 2fr) auto" },
            attributes: { n: "network-header-row-" + row.id } }, [
            Input({ value: row.key, disabled: state.busy, placeholder: "请求头名称，如 User-Agent",
              attributes: { n: "network-header-key-" + row.id, "aria-label": "请求头名称", spellcheck: "false" },
              onInput: event => methods.update_header(row.id, "key", event.target.value) }),
            View({ class: "grid min-w-0 gap-space-2", attributes: { n: "network-header-value-field-" + row.id } }, [
              Input({ value: row.value, disabled: state.busy, placeholder: "请求头值",
                attributes: { n: "network-header-value-" + row.id, "aria-label": "请求头值", spellcheck: "false" },
                onInput: event => methods.update_header(row.id, "value", event.target.value) }),
              Show({ when: computed(row.key, key => key.trim().toLowerCase() === "user-agent"), ok: () =>
                Select({ value: "", disabled: state.busy, options: user_agent_options, placeholder: "选择内置 User-Agent",
                  attributes: { n: "network-user-agent-preset-" + row.id, "aria-label": "选择内置 User-Agent" },
                  onChange: event => methods.update_header(row.id, "value", event.target.value) }) }),
            ]),
            Popconfirm({ title: "确认删除此请求头？", disabled: state.busy,
              attributes: { n: "network-header-remove-confirm-" + row.id },
              onConfirm: () => methods.remove_header(row.id),
              trigger: IconButton({ icon: "trash", label: "删除此请求头", size: "small", disabled: state.busy,
                attributes: { n: "network-header-remove-" + row.id } }),
            }),
          ]);
        } }),
        View({ class: "text-muted text-sm", attributes: { n: "network-headers-help" } }, [
          "可添加、删除或编辑请求头，完全空白的行不参与请求；Cookie 请从上方已有域名中勾选。",
        ]),
      ]),
      View({ class: "flex flex-wrap items-center gap-space-2", attributes: { n: "network-actions" } }, [
        Button({ disabled: state.busy, attributes: { n: "network-test-start" }, onClick: methods.run },
          [combine({ busy: state.busy, copying: state.copying }, state => state.busy && !state.copying ? "正在请求…" : "开始测试")]),
        Button({ disabled: cookie_disabled, attributes: { n: "network-copy-curl", "aria-label": copy_label }, onClick: methods.copy_curl }, [copy_label]),
      ]),
      View({ class: "text-muted text-sm", attributes: { n: "network-curl-help" } }, [
        "curl 包含当前请求头、超时和匹配的已选 Cookie，TCP 模式使用 HTTP/1.1；可在本机终端运行并查看响应头，仅复现首个请求，不自动跟随重定向。命令含登录凭证，请勿公开分享。",
      ]),
      View({ class: "text-danger whitespace-pre-wrap break-anywhere", attributes: { n: "network-error", role: "alert" } }, [state.error]),
      Show({ when: computed(state.result, Boolean), ok: () => View({ class: "grid min-w-0 gap-space-3", attributes: { n: "network-result" } }, [
        View({ class: "flex flex-wrap items-center gap-space-2 text-sm break-anywhere", attributes: { n: "network-summary", role: "status" } }, [
          For({ each: computed(state.result, result => result ? [result] : []), key: "status", render(value) {
            const result = value?.__is_ref ? value.value : value;
            return status_badge(result.status, "network-status", result.status == null ? "未收到 HTTP 响应" : `HTTP ${result.status} ${result.status_text || ""}`.trim());
          } }),
          computed(state.result, result => result ? [
            result.execution ? `执行 ${result.execution === "script" ? "脚本宿主（DO）" : "入口 Worker"}` : "",
            result.transport ? `传输 ${result.transport === "tcp" ? "TCP" : "Fetch"}` : "",
            `总耗时 ${result.elapsed_ms} ms`,
            result.headers_ms == null ? "" : `${result.transport === "tcp" ? "传输完成" : "收到响应头"} ${result.headers_ms} ms`,
            result.colo ? `Worker 入口 ${result.colo}` : "",
          ].filter(Boolean).join(" · ") : ""),
        ]),
        View({ class: "grid min-w-0 gap-space-2", attributes: { n: "network-trace" } }, [
          View({ as: "h2", class: "m-0 text-sm", attributes: { n: "network-trace-label" } }, ["请求过程"]),
          View({ class: "grid min-w-0 gap-space-2 overflow-auto bg-surface-raised rounded-control", style: { padding: "12px", "max-height": "420px" },
            attributes: { n: "network-trace-value" } }, [
            For({ each: computed(state.result, result => result?.requests || []), render(value) {
              const entry = value?.__is_ref ? value.value : value;
              return View({ class: "flex flex-wrap items-center gap-space-2 text-sm break-anywhere", attributes: { n: "network-trace-entry" } }, [
                status_badge(entry.status, "network-trace-status"),
                View({ attributes: { n: "network-trace-time" } }, [`${entry.elapsed_ms} ms`]),
                View({ attributes: { n: "network-trace-url" } }, [entry.url]),
              ]);
            } }),
          ]),
        ]),
        output("response-headers", "响应头", computed(state.result, result => JSON.stringify(result?.headers || {}, null, 2))),
        View({ class: "grid min-w-0 gap-space-2", attributes: { n: "network-response-body" } }, [
          View({ as: "h2", class: "m-0 text-sm", attributes: { n: "network-response-body-label" } }, ["响应正文"]),
          Show({ when: computed(state.preview, preview => preview.kind === "text"), ok: () => CodeEditor({
            value: computed(state.preview, preview => preview.formatted), readOnly: true,
            mode: computed(state.preview, preview => preview.mode),
            attributes: { n: "network-response-code", "aria-label": "响应正文" },
            wrapperStyle: { height: "420px", "max-height": "60dvh", width: "100%" },
          }) }),
          Show({ when: computed(state.preview, preview => ["img", "video", "audio"].includes(preview.kind)),
            ok: () => ScriptMediaPreviewView(window.FindRSSAdminUI, { preview: state.preview, name: "network-response" }) }),
          Show({ when: computed(state.preview, preview => Boolean(preview.file) && preview.kind !== "text"), ok: () =>
            View({ class: "grid gap-space-2 break-anywhere", attributes: { n: "network-response-file" } }, [
              View({ attributes: { n: "network-response-file-name" } }, [computed(state.preview, preview => preview.file?.name || "")]),
              View({ class: "text-muted text-sm", attributes: { n: "network-response-file-type" } }, [computed(state.preview, preview => preview.file?.type || "")]),
              View({ class: "text-muted text-sm", attributes: { n: "network-response-file-size" } }, [computed(state.preview, preview =>
                preview.file?.size_bytes == null ? "大小未知（上游未提供 Content-Length）" : `${preview.file.size_bytes.toLocaleString()} 字节`)]),
            ]) }),
          View({ class: "text-muted text-sm", attributes: { n: "network-response-message", role: "status" } }, [computed(state.preview, preview => preview.message)]),
        ]),
        View({ class: "text-muted text-sm", attributes: { n: "network-body-size" } }, [
          computed(state.result, result => result ? `已读取 ${result.body_bytes} 字节${result.truncated ? "，正文已截断" : ""}；文本预览最多 64KB，媒体预览最多 16MB` : ""),
        ]),
      ]) }),
    ]),
  ]);
}

export { NetworkTestPage };
