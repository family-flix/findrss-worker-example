import { format_datetime as format_time } from "../../server/lib/datetime.js";
import { ScriptDebugOutputModel } from "../components/script_output.js";
import { ScriptFeedPreviewModel, ScriptFeedPreviewView } from "../components/script_feed.js";
import { ScriptDebugPreviewModel } from "../domain/script_preview.js";
import { ScriptMediaPreviewView } from "../components/script_media.js";
import { ScriptAgentPanelView } from "../components/script_agent.js";
import { PaginationView } from "../components/pagination.js";
import { discovery_platform_label, discovery_platform_icon_url } from "../components/discovery_platform.js";
import { ModalViewModel } from "../components/frui/modal.model.js";
import { ScriptConfigView } from "../components/script_config.js";
import { SourceFormView } from "./discovery.js";
import { DiscoveryAdminViewModel } from "./discovery.model.js";

import { normalize_log_lines, ScriptViewModel } from "./script.model.js";

const Timeless = window.FindRSSAdminUI;

if (!Timeless || !Timeless.DOM) {
  throw new Error("脚本源管理页无法启动：Timeless 运行时未加载");
}

if (!window.FindRSSAdminAuth) {
  throw new Error("脚本源管理页无法启动：认证模块未加载");
}

if (!window.FindRSSAdminShell) {
  throw new Error("脚本源管理页无法启动：管理 Shell 未加载");
}
const {
  Badge,
  Button,
  CodeEditor,
  Dialog,
  Field,
  For,
  Icon,
  Img,
  Input,
  Link,
  Popconfirm,
  Select,
  Show,
  Switch,
  TableField,
  Tabs,
  Textarea,
  View,
  combine,
  computed,
  notify,
} = Timeless;

/** @param {unknown} value */
function source_value(value) {
  return value && value.__is_ref ? value.value : value;
}

const source_labels = {
  request: "真实请求",
  test: "测试运行",
  save: "保存校验",
};

/** 单条日志的摘要行：时间 · 来源 · 状态/相位 · 耗时 · 请求。 */
function format_log_summary(log) {
  const parts = [
    format_time(log.created_at),
    source_labels[log.source] || log.source || "未知来源",
    log.phase === "ok" ? "成功" : (log.status || "error") + "/" + log.phase,
    log.elapsed_ms + "ms",
  ];
  if (log.invoked) parts.push("调用设备");
  if (log.method !== "" && log.pathname !== "")
    parts.push(log.method + " " + log.pathname);
  return parts.join(" · ");
}

function FieldView(
  { semantic_name, label, controlProps = {}, style = {} },
  children = [],
) {
  return Field(
    {
      controlProps: {
        class: "box-border grid min-w-0",
        style: {
          gap: "12px",
        },
        ...controlProps,
      },
      messageProps: { class: "box-border hidden" },
      class: "box-border min-w-0 m-0 grid text-muted",
      style: {
        gap: "6px",
        "font-size": "11px",
        ...style,
      },
      attributes: { n: semantic_name },
      label,
    },
    children,
  );
}

function ScriptCookieConsentView({ store: vm$ }) {
  const read = (map) => computed(vm$.state.cookie_consent, map);
  return Dialog(
    {
      headerProps: {
        class: "box-border flex-none m-0",
        style: { padding: "20px 24px" },
      },
      bodyProps: {
        class: "box-border flex-1 min-h-0 overflow-auto p-0",
        style: {},
      },
      footerProps: {
        class: "box-border flex-none m-0",
        style: {
          padding: "16px 24px",
          "border-top": "1px solid var(--frui-color-border-soft)",
        },
      },
      overlayProps: {
        style: {
          "z-index": "10004",
        },
      },
      open: read((value) => value.open),
      title: "确认脚本 Cookie 权限",
      closable: false,
      maskClosable: false,
      class: "box-border flex flex-col overflow-hidden p-0",
      style: {
        "z-index": "10005",
        width: "min(640px, calc(100vw - 32px))",
        "max-height": "calc(100dvh - 32px)",
      },
      attributes: {
        n: "script-cookie-consent",
        "aria-label": "确认脚本 Cookie 权限",
      },
      onClose: vm$.methods.cancel_cookie_consent,
      footer: [
        Button(
          {
            class: "box-border",
            variant: "ghost",
            disabled: read((value) => value.busy),
            attributes: { n: "script-cookie-cancel" },
            onClick: vm$.methods.cancel_cookie_consent,
          },
          ["取消"],
        ),
        Button(
          {
            class: "box-border",
            disabled: read((value) => value.busy),
            attributes: { n: "script-cookie-confirm" },
            onClick: vm$.methods.confirm_cookie_consent,
          },
          [read((value) => (value.busy ? "授权中…" : "确认授权并继续"))],
        ),
      ],
    },
    [
      View(
        {
          class: "box-border",
          style: {
            margin: "0",
            padding: "10px 24px",
            "overflow-wrap": "anywhere",
            "white-space": "pre-wrap",
          },
          as: "p",
          attributes: { n: "script-cookie-source" },
        },
        [read((value) => value.info?.source || "")],
      ),
      View(
        {
          class: "box-border",
          style: {
            margin: "0",
            padding: "10px 24px",
            "overflow-wrap": "anywhere",
            "white-space": "pre-wrap",
          },
          as: "p",
          attributes: { n: "script-cookie-audience" },
        },
        [read((value) => value.info?.audience || "")],
      ),
      View(
        {
          class: "box-border",
          style: {
            margin: "0",
            padding: "10px 24px",
            "overflow-wrap": "anywhere",
            "white-space": "pre-wrap",
          },
          as: "pre",
          attributes: { n: "script-cookie-permissions" },
        },
        [
          read((value) =>
            JSON.stringify(value.info?.permissions || {}, null, 2),
          ),
        ],
      ),
      View(
        {
          class: "box-border",
          style: {
            margin: "0",
            padding: "10px 24px",
            "overflow-wrap": "anywhere",
            "white-space": "pre-wrap",
          },
          as: "pre",
          attributes: { n: "script-cookie-visibility" },
        },
        [
          read(
            (value) =>
              "输出访问范围：\n" +
              JSON.stringify(value.info?.visibility || {}, null, 2),
          ),
        ],
      ),
      View(
        {
          class: "box-border",
          style: {
            margin: "0",
            padding: "10px 24px",
            "overflow-wrap": "anywhere",
            "white-space": "pre-wrap",
          },
          as: "p",
          attributes: { n: "script-cookie-version" },
        },
        [read((value) => "版本：" + (value.info?.version || "未编号草稿"))],
      ),
      View(
        {
          class: "box-border",
          style: {
            margin: "0",
            padding: "10px 24px",
            "overflow-wrap": "anywhere",
            "white-space": "pre-wrap",
          },
          as: "p",
          attributes: { n: "script-cookie-hash" },
        },
        [read((value) => "源码 SHA-256：" + (value.info?.script_hash || ""))],
      ),
      View(
        {
          class: "box-border",
          style: {
            margin: "0",
            padding: "10px 24px",
            "overflow-wrap": "anywhere",
            "white-space": "pre-wrap",
          },
          as: "p",
          attributes: { n: "script-cookie-policy" },
        },
        [
          "授权仅适用于此版本号、源码哈希和权限范围；代码或版本号修改后需重新确认。Cookie 值不会提供给脚本。",
        ],
      ),
      View(
        {
          class: "box-border",
          style: {
            margin: "0",
            padding: "10px 24px",
            "overflow-wrap": "anywhere",
            "white-space": "pre-wrap",
          },
          as: "p",
          attributes: { n: "script-cookie-error" },
        },
        [read((value) => value.error)],
      ),
    ],
  );
}

function ScriptDebugResultView({ store: vm$, route }) {
  const preview = computed(vm$.state.debug_result, result => ScriptDebugPreviewModel(result.rss_debug,
    vm$.state.draft_type.value === "rss" && !route?.image_proxy ? "rss" : ""));
  return For({ each: computed(preview, value => [{ key: value.kind, kind: value.kind }]), key: "key",
    render(value) { return ScriptDebugResultContentView({ store: vm$, kind: source_value(value).kind, preview }); } });
}

function ScriptDebugResultContentView({ store: vm$, kind, preview }) {
  const read = (map) => computed(vm$.state.debug_result, map);
  const output = read((result) =>
    ScriptDebugOutputModel(result.rss_debug?.output),
  );
  const is_rss = kind === "rss";
  let preview_cache;
  const feed_preview = combine({ output, result: vm$.state.debug_result }, ({ output, result }) => {
    const debug = result.rss_debug;
    let self_url = "";
    if (debug?.request?.public_origin) {
      const url = new URL(String(debug.request.pathname || "/").replace(/^\/debug(?=\/)/, "/rss"), debug.request.public_origin);
      url.search = new URLSearchParams(Object.entries(debug.request.query || {}).sort()).toString();
      self_url = url.href;
    }
    const source = typeof debug?.output === "string" ? output.source : "";
    const assets = debug?.preview_assets;
    if (preview_cache?.source !== source || preview_cache?.self_url !== self_url || preview_cache?.assets !== assets) {
      preview_cache = { source, self_url, assets, value: ScriptFeedPreviewModel(source, self_url, assets) };
    }
    return preview_cache.value;
  });
  const xml_output = computed(feed_preview, result => ScriptDebugOutputModel(JSON.stringify({
    body: result.xml, content_type: "application/xml",
  })));
  const block = (name, title, value) =>
    View(
      {
        as: "section",
        class:
          "box-border " +
          ("p-var-frui-space-4-0 " + (name === "stack" ? "text-danger" : "")),
        style: {
          "border-bottom": "1px solid var(--frui-color-border-soft)",
        },
        attributes: { n: "script-debug-" + name },
      },
      [
        View(
          {
            class: "box-border",
            style: {
              margin: "0 0 var(--frui-space-2)",
              "font-size": "var(--frui-font-size-sm)",
            },
            as: "h3",
            attributes: { n: "script-debug-" + name + "-title" },
          },
          [title],
        ),
        View(
          {
            class: "box-border m-0 whitespace-pre-wrap break-anywhere",
            style: {
              font: "12px/1.7 ui-monospace, SFMono-Regular, Menlo, monospace",
            },
            as: "pre",
            attributes: { n: "script-debug-" + name + "-content" },
          },
          [value],
        ),
      ],
    );
  const panel = (name, children) =>
    View(
      {
        class: "box-border flex-1 min-w-0 min-h-0 overflow-auto p-space-5",
        attributes: {
          n: "script-debug-" + name + "-panel",
          id: "script-debug-" + name + "-panel",
          tabindex: "0",
          role: "region",
          "aria-label": {
            output: "调试输出",
            context: "调试上下文",
            logs: "调试日志",
            xml: "XML 预览",
            feed: "预览",
            preview: "媒体预览",
          }[name],
        },
      },
      children,
    );
  return View(
    {
      class: "box-border flex-1 min-h-0 flex flex-col overflow-hidden",
      attributes: {
        n: "script-debug-content",
        role: "region",
        "aria-label": "调试详情",
      },
    },
    [
      View(
        {
          class: "box-border text-danger whitespace-pre-wrap break-anywhere",
          attributes: { n: "script-debug-error", role: "alert" },
        },
        [read((result) => result.error)],
      ),
      Show({
        when: read((result) => Boolean(result.rss_debug)),
        ok: () =>
          View(
            {
              class: "box-border flex-none p-var-frui-space-3-var-frui-space-5",
              attributes: { n: "script-debug-details" },
            },
            [
              View(
                {
                  class: "box-border text-muted text-sm break-anywhere",
                  attributes: { n: "script-debug-summary", role: "status" },
                },
                [
                  read(({ status, rss_debug: debug, stale }) =>
                    debug
                      ? `HTTP ${status} · ${debug.phase} · ${debug.elapsed_ms} ms${debug.invoked ? " · 已调用设备" : ""}${stale ? " · 代码或链接已修改，等待重新调试" : ""}`
                      : "",
                  ),
                ],
              ),
            ],
          ),
      }),
      Tabs({
        listProps: {
          class: "box-border flex-none",
          style: {
            padding: "0 var(--frui-space-5)",
          },
        },
        panelProps: { class: "box-border flex-1 min-h-0 flex overflow-hidden" },
        class: "box-border flex-1 min-h-0 flex flex-col gap-0",
        attributes: { n: "script-debug-tabs", "aria-label": "调试数据" },
        items: [
          {
            id: "output",
            label: "输出",
            panel_id: "script-debug-output-panel",
            get content() {
              return [
                panel("output", [
                  Show({
                    when: read((result) =>
                      Boolean(result.rss_debug?.error_text),
                    ),
                    ok: () =>
                      block(
                        "stack",
                        "错误详情与堆栈",
                        read((result) => result.rss_debug?.error_text || ""),
                      ),
                  }),
                  Show({
                    when: read((result) => Boolean(result.rss_debug)),
                    ok: () =>
                      View(
                        {
                          as: "section",
                          class: "box-border p-var-frui-space-4-0",
                          style: {
                            "border-bottom":
                              "1px solid var(--frui-color-border-soft)",
                          },
                          attributes: { n: "script-debug-output" },
                        },
                        [
                          View(
                            {
                              class: "box-border",
                              style: {
                                margin: "0 0 var(--frui-space-2)",
                                "font-size": "var(--frui-font-size-sm)",
                              },
                              as: "h3",
                              attributes: {
                                n: "script-debug-output-title",
                              },
                            },
                            [
                              computed(
                                output,
                                (result) => "路由输出 · " + result.label,
                              ),
                            ],
                          ),
                          View(
                            {
                              class:
                                "box-border min-w-0 overflow-hidden rounded-control",
                              style: {
                                border:
                                  "1px solid var(--frui-color-border-soft)",
                              },
                              attributes: {
                                n: "script-debug-output-editor",
                              },
                            },
                            [
                              CodeEditor({
                                rootStyle: { "min-width": "0" },
                                wrapperStyle: {
                                  height: "clamp(240px, 45dvh, 640px)",
                                  font: "13px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace",
                                },
                                style: {
                                  "min-height": "240px",
                                },
                                value: computed(
                                  output,
                                  (result) => result.formatted,
                                ),
                                mode: computed(output, (result) => result.mode),
                                readOnly: true,
                                attributes: {
                                  n: "script-debug-output-content",
                                  "aria-label": "格式化路由输出",
                                  readonly: "",
                                  spellcheck: "false",
                                },
                              }),
                            ],
                          ),
                        ],
                      ),
                  }),
                ]),
              ];
            },
          },
          {
            id: "context",
            label: "上下文",
            panel_id: "script-debug-context-panel",
            get content() {
              return [
                panel("context", [
                  block(
                    "request",
                    "请求上下文",
                    read((result) =>
                      JSON.stringify(result.rss_debug?.request || {}, null, 2),
                    ),
                  ),
                  block(
                    "cookies",
                    "Cookie 使用（不含值）",
                    read((result) =>
                      JSON.stringify(
                        result.rss_debug?.cookie_accesses || [],
                        null,
                        2,
                      ),
                    ),
                  ),
                  block(
                    "upstream",
                    "上游请求",
                    read((result) =>
                      JSON.stringify(
                        result.rss_debug?.upstream_requests || [],
                        null,
                        2,
                      ),
                    ),
                  ),
                  block(
                    "route",
                    "脚本路由",
                    read((result) =>
                      JSON.stringify(result.rss_debug?.script || {}, null, 2),
                    ),
                  ),
                ]),
              ];
            },
          },
          {
            id: "logs",
            label: "日志",
            panel_id: "script-debug-logs-panel",
            get content() {
              return [
                panel("logs", [
                  block(
                    "logs",
                    "执行日志",
                    read(
                      (result) =>
                        normalize_log_lines(result.rss_debug?.lines)
                          .map(format_log_line)
                          .join("\n") || "无执行日志",
                    ),
                  ),

                ]),
              ];
            },
          },
          ...(is_rss ? [
            {
              id: "xml", label: "XML预览", panel_id: "script-debug-xml-panel",
              get content() {
                return [panel("xml", [Show({
                  when: computed(feed_preview, result => !result.empty),
                  ok: () => CodeEditor({
                    rootStyle: { "min-width": "0", width: "100%" },
                    wrapperStyle: { height: "clamp(240px, 55dvh, 800px)" },
                    value: computed(xml_output, result => result.formatted),
                    mode: "application/xml", readOnly: true,
                    attributes: { n: "script-debug-xml-content", "aria-label": "XML 响应预览", readonly: "", spellcheck: "false" },
                  }),
                  fail: () => View({ class: "box-border text-muted", attributes: { role: "status" } }, ["运行调试后查看 XML 响应"]),
                })])];
              },
            },
            {
              id: "feed", label: "预览", panel_id: "script-debug-feed-panel",
              get content() {
                return [panel("feed", [ScriptFeedPreviewView(Timeless, { preview: feed_preview })])];
              },
            },
          ] : []),
          ...(["img", "video", "audio"].includes(kind) ? [{
            id: "preview", label: "预览", panel_id: "script-debug-preview-panel",
            get content() { return [panel("preview", [ScriptMediaPreviewView(Timeless, { preview })])]; },
          }] : []),
        ],
      }),
    ],
  );
}

function ScriptDebugRouteView({ store: vm$, route, panel_id }) {
  const url = computed(vm$.state.debug_routes, rows => rows.find(row => row.path === route.path)?.url || "");
  return View({
    class: "box-border flex-1 min-h-0 flex flex-col overflow-hidden",
    attributes: { n: "script-debug-route-panel", id: panel_id },
  }, [
    View({
      class: "box-border flex-none grid gap-space-2 p-space-5",
      style: { "border-bottom": "1px solid var(--frui-color-border-soft)" },
      attributes: { n: "script-debug-toolbar" },
    }, [
      View({ class: "box-border text-muted text-sm break-anywhere", attributes: { n: "script-debug-route-path" } }, [route.path]),
      View({
        class: "box-border grid items-center gap-space-2",
        style: { "grid-template-columns": "minmax(0, 1fr) auto" },
        attributes: { n: "script-debug-route-row", role: "group", "aria-label": route.name },
      }, [
        Input({ value: url, disabled: vm$.state.saving, placeholder: route.path,
          attributes: { n: "script-debug-url", "aria-label": route.name + "调试地址", spellcheck: "false" },
          onInput: event => vm$.methods.set_debug_url(event.target.value, route.path),
        }),
        Button({ icon: Icon("play", 16),
          attributes: { n: "script-debug-run-button", "aria-label": "运行调试：" + route.name,
            title: "运行当前草稿（⌘/Ctrl + Enter）" },
          disabled: combine({ saving: vm$.state.saving, debugging: vm$.state.debugging,
            script: vm$.state.draft_script, url, agent_busy: vm$.agent.state.busy },
          deps => deps.saving || deps.debugging || deps.agent_busy || !deps.script.trim() || !deps.url.trim() || undefined),
          onClick: () => vm$.methods.debug_script(route.path),
        }, [computed(vm$.state.debugging, running => running ? "调试中…" : "运行调试")]),
      ]),
      View({ class: "box-border text-link text-sm", attributes: { n: "script-debug-progress", role: "status" } }, [
        computed(vm$.state.debugging, running => running ? "正在执行当前草稿，可继续编辑…" : ""),
      ]),
    ]),
    ScriptDebugResultView({ store: vm$, route }),
  ]);
}

function ScriptDebugRoutesView({ store: vm$ }) {
  // 路由列表变化时重建 Tab，编辑地址只更新对应输入，不重建编辑器。
  const groups = computed(vm$.state.debug_routes, routes => [{
    key: JSON.stringify(routes.map(({ path, name, image_proxy }) => [path, name, image_proxy])), routes,
  }]);
  return View({
    class: "box-border flex flex-col min-w-0 min-h-0 overflow-hidden max-1100-grid-column max-1100-height max-1100-border-top max-760-min-height",
    style: { "--max-1100-grid-column": "1 / -1", "--max-1100-height": "70dvh",
      "--max-1100-border-top": "1px solid var(--frui-color-border-soft)", "--max-760-min-height": "50dvh" },
    attributes: { n: "script-debug-pane" },
  }, [
    View({ class: "box-border text-danger whitespace-pre-wrap break-anywhere",
      attributes: { n: "script-debug-routes-error", role: "alert" } }, [vm$.state.debug_routes_error]),
    For({ each: groups, key: "key", render(group_value) {
      const group = source_value(group_value);
      return Tabs({
        value: computed(vm$.state.debug_route_path, path => path), onChange: vm$.methods.select_debug_route,
        class: "box-border flex-1 min-h-0 flex flex-col gap-0",
        listProps: { class: "box-border flex-none", style: { padding: "0 var(--frui-space-5)" } },
        panelProps: { class: "box-border flex-1 min-h-0 flex overflow-hidden" },
        attributes: { n: "script-debug-route-tabs", "aria-label": "调试路由" },
        items: group.routes.map((route, index) => ({
          id: route.path, label: route.name, panel_id: "script-debug-route-panel-" + index,
          attributes: { id: "script-debug-route-tab-" + index, title: route.path },
          get content() {
            return [Show({ when: computed(vm$.state.debug_route_path, path => path === route.path),
              ok: () => ScriptDebugRouteView({ store: vm$, route, panel_id: "script-debug-route-panel-" + index }),
            })];
          },
        })),
      });
    } }),
  ]);
}

function ScriptDiffView({ store: vm$ }) {
  const trigger = document.activeElement;
  const modal = ModalViewModel({ onClose: vm$.methods.close_diff });
  return Dialog({
    open: vm$.state.diff_open,
    title: "Diff变更",
    description: "正式版本 → 当前编辑（含未保存修改）· − 删除 · + 新增",
    attributes: { n: "script-diff-dialog", "aria-label": "脚本变更对比" },
    class: "box-border flex flex-col overflow-hidden",
    style: { width: "min(1200px, calc(100vw - 32px))", height: "80dvh", "z-index": "303" },
    overlayProps: { style: { "z-index": "302" } },
    bodyProps: { class: "box-border flex flex-col flex-1 min-h-0 overflow-hidden" },
    maskClosable: false,
    closable: false,
    onMounted: modal.mount,
    onUnmounted() {
      modal.unmount();
      if (trigger?.isConnected) trigger.focus();
    },
    onKeyDown: modal.keydown,
    footer: [Button({
      variant: "secondary", attributes: { n: "script-diff-close-button" },
      onClick: vm$.methods.close_diff,
    }, ["关闭"])],
  }, [Show({
    when: computed(vm$.state.diff_text, text => Boolean(text)),
    ok: () => CodeEditor({
      value: vm$.state.diff_text, mode: "diff", readOnly: true,
      attributes: { n: "script-diff-code", "aria-label": "正式版本与当前编辑的代码差异" },
      rootStyle: { display: "flex", flex: "1", "min-height": "0" },
      wrapperStyle: { flex: "1", "min-height": "0", height: "100%", font: "13px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace" },
    }),
    else: () => View({
      class: "box-border text-muted", attributes: { n: "script-diff-empty", role: "status" },
    }, ["与正式版本一致，暂无变更。"]),
  })]);
}

function ScriptHistoryView({ store: vm$ }) {
  const read = map => computed(vm$.state.history, map);
  const busy = read(value => value.busy);
  const modal = ModalViewModel({ onClose: vm$.methods.close_history, busy });
  return Dialog({ open: read(value => value.open), title: "版本历史",
    description: "查看已发布源码，或回退到历史版本。未发布草稿会保留。",
    attributes: { n: "script-history-dialog", "aria-label": "版本历史" },
    class: "box-border flex flex-col overflow-hidden", style: { width: "min(760px, calc(100vw - 32px))", "max-height": "calc(100dvh - 32px)" },
    bodyProps: { class: "box-border overflow-auto min-h-0" }, maskClosable: false, closable: false,
    onMounted: modal.mount, onUnmounted: modal.unmount, onKeyDown: modal.keydown, onClose: vm$.methods.close_history,
    footer: [Button({ variant: "secondary", disabled: busy, onClick: vm$.methods.close_history,
      attributes: { n: "script-history-close" } }, ["关闭"])],
  }, [View({ class: "box-border grid gap-space-4" }, [
    Show({ when: busy, ok: () => View({ class: "box-border text-muted", attributes: { role: "status" } }, ["处理中…"]) }),
    Show({ when: read(value => !value.busy && !value.versions.length), ok: () =>
      View({ class: "box-border text-muted" }, ["暂无已保存的正式版本。迁移前已被覆盖的版本无法恢复。"]) }),
    For({ each: read(value => value.versions), key: "id", render(raw) {
      const release = source_value(raw);
      return View({ class: "box-border flex flex-wrap items-center justify-between gap-space-3",
        attributes: { n: "script-history-version" } }, [
        View({ class: "box-border grid gap-space-2 min-w-0" }, [
          View({ class: "box-border break-anywhere", attributes: { n: "script-history-version-name" } },
            [(release.version || "未编号版本") + (release.current ? " · 当前使用" : "")]),
          View({ class: "box-border text-muted text-sm break-anywhere" },
            [format_time(release.created_at) + " · " + Math.ceil(release.bytes / 1024) + " KB"]),
        ]),
        View({ class: "box-border flex gap-space-2" }, [
          Button({ variant: "secondary", disabled: busy, attributes: { n: "script-history-view" },
            onClick: () => vm$.methods.view_version(release.id) }, ["查看源码"]),
          ...(!release.current ? [Button({ variant: "secondary", disabled: busy, attributes: { n: "script-history-rollback" },
            onClick: () => vm$.methods.rollback_version(release.id) }, ["回退到此版本"])] : []),
        ]),
      ]);
    } }),
    Show({ when: read(value => Boolean(value.selected_id)), ok: () => Textarea({ value: read(value => value.source), rows: 12,
      readOnly: true, attributes: { n: "script-history-source", readonly: true, "aria-label": "历史版本源码" } }) }),
    View({ class: "box-border text-danger whitespace-pre-wrap text-sm", attributes: { n: "script-history-error", role: "alert" } }, [read(value => value.error)]),
  ])]);
}

function ScriptInstallView({ store: vm$ }) {
  const busy = combine({ parsing: vm$.state.install_busy, saving: vm$.state.saving, consent: vm$.state.cookie_consent },
    ({ parsing, saving, consent }) => parsing || saving || consent.open);
  const read = map => computed(vm$.state.install_preview, value => map(value?.metadata || {}, value));
  const modal = ModalViewModel({ onClose: vm$.methods.close_install, busy });
  return Dialog({
    open: vm$.state.install_open,
    title: "安装脚本",
    description: "输入脚本直链或粘贴源码，解析预览后确认保存。",
    attributes: { n: "script-install-dialog", "aria-label": "安装脚本" },
    class: "box-border flex flex-col overflow-hidden",
    style: { width: "min(760px, calc(100vw - 32px))", "max-height": "calc(100dvh - 32px)" },
    bodyProps: { class: "box-border overflow-auto min-h-0" },
    maskClosable: false, closable: false,
    onMounted: modal.mount, onUnmounted: modal.unmount, onKeyDown: modal.keydown,
    onClose: vm$.methods.close_install,
    footer: [
      Button({ variant: "secondary", disabled: busy, attributes: { n: "script-install-cancel" },
        onClick: vm$.methods.close_install }, ["取消"]),
      Show({ when: computed(vm$.state.install_preview, value => !value), ok: () =>
        Button({ disabled: busy, attributes: { n: "script-install-parse" }, onClick: vm$.methods.preview_install },
          [computed(vm$.state.install_busy, value => value ? "下载、解析中…" : "保存并预览")]),
      }),
      Show({ when: vm$.state.install_preview, ok: () => View({ class: "box-border flex gap-space-2", attributes: { n: "script-install-save-actions" } }, [
        Button({ variant: "secondary", disabled: busy, attributes: { n: "script-install-save" },
          onClick: () => vm$.methods.save_install("draft") }, ["保存草稿"]),
        Button({ disabled: busy, attributes: { n: "script-install-publish" },
          onClick: () => vm$.methods.save_install("published") }, [computed(vm$.state.saving, value => value ? "保存中…" : "发布安装")]),
      ]) }),
    ],
  }, [
    View({ class: "box-border grid gap-space-4", attributes: { n: "script-install-body" } }, [
      Field({ label: "脚本 URL 或脚本内容", control_id: "script-install-input", attributes: { n: "script-install-input-field" } }, [
        Textarea({ value: vm$.state.install_input, disabled: busy, rows: 7,
          placeholder: "https://example.com/script.js\n或粘贴完整 JavaScript 脚本",
          attributes: { n: "script-install-input", id: "script-install-input", "aria-label": "脚本 URL 或脚本内容" },
          onInput: event => vm$.methods.set_install_input(event.target.value) }),
      ]),
      Show({ when: vm$.state.install_preview, ok: () => View({ class: "box-border grid gap-space-4", attributes: { n: "script-install-preview" } }, [
        View({
          class: "box-border flex items-center gap-space-2 min-w-0 text-text text-base",
          attributes: { n: "script-install-platform", "aria-label": "来源" },
        }, [
          Img({
            src: read(metadata => discovery_platform_icon_url(metadata.platform)),
            class: "box-border block flex-none object-fit-contain width-space-5 height-space-5",
            attributes: { n: "script-install-platform-icon", alt: "", "aria-hidden": "true",
              width: "20", height: "20", referrerpolicy: "no-referrer" },
          }),
          View({ class: "box-border min-w-0 break-anywhere", attributes: { n: "script-install-platform-name" } }, [
            read(metadata => discovery_platform_label(metadata.platform || { name: "网页", icon: "" })),
          ]),
        ]),
        ...[
          ["name", "脚本名称", metadata => metadata.name],
          ["kind", "脚本类型", metadata => metadata.kind === "hot" ? "热榜" : "RSS"],
          ["website", "网站", metadata => metadata.url || "未声明"],
          ["tags", "标签", metadata => metadata.tags?.join("、") || "无"],
          ["maintainers", "维护者", metadata => metadata.maintainers?.map(value => typeof value === "string" ? value : value.nickname).join("、") || "未声明"],
          ["source", "下载来源", (_metadata, value) => value?.source_url || "粘贴的脚本内容"],
        ].map(([name, label, render]) => FieldView({ semantic_name: "script-install-" + name + "-field", label }, [
          View({ class: "box-border whitespace-pre-wrap break-anywhere text-sm", attributes: { n: "script-install-" + name } }, [read(render)]),
        ])),
        FieldView({ semantic_name: "script-install-routes-field", label: "路由与可见范围" }, [
          For({ each: read(metadata => metadata.routes || []), key: "path", render(raw) {
            const route = source_value(raw);
            return View({ class: "box-border grid gap-space-2 rounded-control", style: { padding: "12px", border: "1px solid var(--frui-color-border-soft)" }, attributes: { n: "script-install-route" } }, [
              View({ class: "box-border", style: { "font-weight": "600" }, attributes: { n: "script-install-route-name" } }, [route.name]),
              View({ class: "box-border break-anywhere font-mono text-sm", attributes: { n: "script-install-route-path" } }, [route.path]),
              View({ class: "box-border whitespace-pre-wrap text-sm", attributes: { n: "script-install-route-description" } }, [route.description || "无描述"]),
              View({ class: "box-border break-anywhere text-sm", attributes: { n: "script-install-route-example" } }, ["示例：" + route.example]),
              View({ class: "box-border text-sm", attributes: { n: "script-install-route-visibility" } }, [route.public ? "公开访问（无需 token）" : "持有效访问 token 的订阅者可访问"]),
              View({ as: "pre", class: "box-border m-0 whitespace-pre-wrap break-anywhere text-sm", attributes: { n: "script-install-route-parameters" } }, ["参数：" + JSON.stringify(route.parameters, null, 2)]),
              ...(route.allowed_hosts?.length ? [View({ class: "box-border break-anywhere text-sm", attributes: { n: "script-install-route-hosts" } }, ["图片代理域名：" + route.allowed_hosts.join("、")])] : []),
            ]);
          } }),
        ]),
        FieldView({ semantic_name: "script-install-permissions-field", label: "申请的权限" }, [
          View({ as: "pre", class: "box-border m-0 whitespace-pre-wrap break-anywhere text-sm", attributes: { n: "script-install-permissions" } }, [
            read(metadata => metadata.permissions?.cookies?.length ? JSON.stringify(metadata.permissions, null, 2) : "未申请 Cookie 权限"),
          ]),
        ]),
        Show({ when: read(metadata => Boolean(metadata.config_schema)), ok: () =>
          FieldView({ semantic_name: "script-install-config-field", label: "配置声明（保存后可通过脚本的配置按钮填写）" }, [
            View({ as: "pre", class: "box-border m-0 whitespace-pre-wrap break-anywhere text-sm", attributes: { n: "script-install-config" } }, [read(metadata => JSON.stringify(metadata.config_schema, null, 2))]),
          ]),
        }),
        Field({ label: "源码预览", control_id: "script-install-source-code", attributes: { n: "script-install-code-field" } }, [
          Textarea({ value: read((_metadata, value) => value?.script || ""), rows: 8, readOnly: true,
            attributes: { n: "script-install-source-code", id: "script-install-source-code", readonly: true, "aria-label": "源码预览" } }),
        ]),
        Field({ label: "版本号（发布安装时必填）", control_id: "script-install-version", attributes: { n: "script-install-version-field" } }, [
          Input({ value: vm$.state.draft_version, disabled: busy, placeholder: "例如 1.0.0",
            attributes: { n: "script-install-version", id: "script-install-version" },
            onInput: event => vm$.methods.set_draft("version", event.target.value) }),
        ]),
      ]) }),
      View({ class: "box-border text-danger whitespace-pre-wrap text-sm", attributes: { n: "script-install-error", role: "alert" } }, [vm$.state.form_error]),
    ]),
  ]);
}

function ScriptFormView({ store: vm$ }) {
  const trigger = document.activeElement;
  const busy = vm$.state.saving;
  function handle_keydown(event) {
    if (vm$.state.diff_open.value || event.defaultPrevented) return;
    if (event.key === "Escape") {
      if (vm$.state.cookie_consent.value.open) return;
      event.stopPropagation();
      vm$.methods.close_form();
    }
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      vm$.methods.debug_script();
    }
    if (event.key !== "Tab") return;
    const dialog = document.querySelector('[n="script-form-dialog"]');
    const controls = Array.from(
      dialog?.querySelectorAll(
        'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), [tabindex="0"]',
      ) || [],
    ).filter((node) => node.getClientRects().length);
    const next = event.shiftKey ? controls.at(-1) : controls[0];
    const edge = event.shiftKey ? controls[0] : controls.at(-1);
    if (
      document.activeElement === edge ||
      !controls.includes(document.activeElement)
    ) {
      event.preventDefault();
      next?.focus();
    }
  }
  return Dialog(
    {
      headerProps: {
        class: "box-border flex-none m-0 p-var-frui-space-3-var-frui-space-5",
        style: {
          "border-bottom": "1px solid var(--frui-color-border-soft)",
          "padding-right": "64px",
        },
      },
      bodyProps: {
        class:
          "box-border flex-1 min-h-0 overflow-hidden p-0 bg-canvas flex max-1100-overflow max-1100-display max-760-overflow max-760-display",
        style: {
          "--max-1100-overflow": "auto",
          "--max-1100-display": "block",
          "--max-760-overflow": "auto",
          "--max-760-display": "block",
        },
      },
      footerProps: {
        class:
          "box-border flex-none flex-wrap m-0 p-var-frui-space-3-var-frui-space-5 items-center",
        style: { "border-top": "1px solid var(--frui-color-border-soft)" },
      },
      open: vm$.state.form_open,
      title: vm$.state.form_title,
      class:
        "box-border max-h-none flex flex-col overflow-hidden p-0 top-0 left-0 transform-none rounded-0 box-shadow-none",
      style: {
        width: "100vw",
        height: "100dvh",
      },
      closable: false,
      maskClosable: false,
      attributes: { n: "script-form-dialog", "aria-label": "脚本表单" },
      onMounted() {
        window.FindRSSAdminAgent?.set_editor_open?.(true);
      },
      onClose: vm$.methods.close_form,
      onUnmounted() {
        window.FindRSSAdminAgent?.set_editor_open?.(false);
        document.removeEventListener("keydown", handle_keydown);
        trigger?.focus?.();
      },
      footer: [
        Show({
          when: computed(vm$.state.editing_id, id => Boolean(id)),
          ok: () => Button({
            variant: "secondary", attributes: { n: "script-diff-button" },
            disabled: computed(vm$.state.diff_available, available => !available),
            onClick: vm$.methods.open_diff,
          }, ["Diff变更"]),
        }),
        Button(
          {
            class: "box-border",
            variant: "secondary",
            attributes: { n: "script-save-button" },
            icon: Show({
              when: vm$.state.draft_saved,
              ok: () => Icon("check", 16),
              else: () => Icon("save", 16),
            }),
            onMouseDown(event) {
              // Mouse saves keep the editor focused; keyboard focus stays native.
              if (event.button === 0) event.preventDefault();
            },
            disabled: combine(
              { busy, agent_busy: vm$.agent.state.busy },
              (value) => value.busy || value.agent_busy || undefined,
            ),
            onClick() {
              return vm$.methods.save_script("draft");
            },
          },
          [
            computed(vm$.state.saving, (saving) =>
              saving ? "保存中…" : "保存草稿",
            ),
          ],
        ),
        View({
          as: "span",
          class: "box-border flex-none text-muted text-sm whitespace-nowrap",
          attributes: { n: "script-draft-saved-at", role: "status" },
        }, [computed(vm$.state.draft_saved_at, timestamp => timestamp
          ? "最近保存：" + format_time(timestamp, { format: "YYYY-MM-DD HH:mm:ss" })
          : "尚未保存")]),
        View(
          {
            class:
              "box-border m-0 text-danger whitespace-pre-wrap flex-1 text-sm",
            attributes: { n: "script-form-error", role: "alert" },
          },
          [vm$.state.form_error],
        ),
        FieldView(
          {
            semantic_name: "script-version-field",
            label: "版本号",
            style: {
              display: "flex",
              "align-items": "center",
              gap: "var(--frui-space-2)",
              "margin-right": "auto",
            },
            controlProps: {
              style: {
                width: "100px",
              },
            },
          },
          [
            Input({
              class: "box-border",
              value: vm$.state.draft_version,
              disabled: busy,
              placeholder: "1.0.0",
              attributes: {
                n: "script-version-input",
                "aria-label": "脚本版本号",
                maxlength: "64",
                title: "发布正式时必填，并高于上次正式版本",
              },
              onInput(event) {
                vm$.methods.set_draft("version", event.target.value);
              },
            }),
          ],
        ),
        View(
          {
            class: "box-border flex items-center gap-space-2 whitespace-nowrap",
            attributes: { n: "script-debug-actions" },
          },
          [
            Switch({
              class: "box-border",
              checked: vm$.state.live_debug,
              label: "实时调试",
              disabled: vm$.state.saving,
              attributes: {
                n: "script-live-debug",
                "aria-label": "实时调试",
              },
              onChange: vm$.methods.set_live_debug,
            }),
            View(
              {
                class: "box-border",
                as: "button",
                onClick: () => notify("首次运行后，修改代码或链接会自动调试。使用真实抓取、Cookie 和在线设备；无需保存，不扣积分。"),
                attributes: {
                  n: "script-live-debug-help",
                  type: "button",
                  "aria-label": "实时调试说明",
                },
              },
              [Icon("circle-help", 16)],
            ),
          ],
        ),
        Button(
          {
            class: "box-border",
            variant: "secondary",
            attributes: { n: "script-cancel-button" },
            disabled: busy,
            onClick: vm$.methods.close_form,
          },
          ["取消"],
        ),
        Button(
          {
            class: "box-border",
            attributes: { n: "script-publish-button" },
            disabled: combine(
              { busy, agent_busy: vm$.agent.state.busy },
              (value) => value.busy || value.agent_busy || undefined,
            ),
            onClick() {
              return vm$.methods.save_script("published");
            },
          },
          ["发布正式"],
        ),
      ],
    },
    [
      Button(
        {
          variant: "ghost",
          size: "small",
          class: "box-border absolute flex-none",
          style: {
            top: "14px",
            right: "14px",
          },
          icon: Icon("x", 16),
          attributes: {
            n: "script-form-close-button",
            "aria-label": "关闭脚本表单",
          },
          disabled: busy,
          onClick: vm$.methods.close_form,
        },
        [],
      ),
      View(
        {
          class:
            "box-border grid gap-0 mt-0 flex-1 min-w-0 min-h-0 max-1100-grid-template-columns max-760-grid-template-columns",
          style: {
            "grid-template-columns":
              "minmax(0, 1.05fr) minmax(0, .85fr) minmax(0, 1.1fr)",
            "--max-1100-grid-template-columns": "minmax(0, 1fr) minmax(0, 1fr)",
            "--max-760-grid-template-columns": "minmax(0, 1fr)",
          },
          attributes: { n: "script-form" },
          onMounted() {
            document.addEventListener("keydown", handle_keydown);
          },
        },
        [
          View(
            {
              class:
                "box-border flex flex-col min-w-0 min-h-0 overflow-hidden p-0 max-1100-height max-760-min-height max-760-border-right max-760-border-bottom",
              style: {
                "border-right": "1px solid var(--frui-color-border-soft)",
                "--max-1100-height": "70dvh",
                "--max-760-min-height": "60dvh",
                "--max-760-border-right": "0",
                "--max-760-border-bottom":
                  "1px solid var(--frui-color-border-soft)",
              },
              attributes: { n: "script-code-pane" },
              onKeyDown(event) {
                if (event.defaultPrevented || vm$.state.diff_open.value || vm$.state.cookie_consent.value.open) return;
                if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "s") {
                  event.preventDefault();
                  return vm$.methods.save_script("draft");
                }
              },
            },
            [
              View(
                {
                  class:
                    "box-border col-span-full flex-1 min-h-0 flex flex-col",
                  attributes: { n: "script-code-field" },
                },
                [
                  View(
                    {
                      class:
                        "box-border relative min-w-0 flex-1 min-h-0 flex flex-col",
                      attributes: { n: "script-code-input" },
                    },
                    [
                      CodeEditor({
                        rootStyle: {
                          display: "flex",
                          "flex-direction": "column",
                          flex: "1",
                          "min-height": "0",
                        },
                        wrapperStyle: {
                          flex: "1",
                          "min-height": "0",
                          width: "100%",
                          height: "0",
                          border: "0",
                          "border-radius": "0",
                          font: "13px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace",
                        },
                        style: {
                          flex: "1",
                          "min-height": "160px",
                        },
                        value: vm$.state.draft_script,
                        readOnly: busy,
                        attributes: {
                          n: "script-code-textarea",
                          "aria-label": "脚本内容",
                          rows: "16",
                          spellcheck: "false",
                        },
                        onInput(event) {
                          vm$.methods.set_draft("script", event.target.value);
                        },
                      }),
                    ],
                  ),
                ],
              ),
            ],
          ),
          ScriptAgentPanelView({ ui: Timeless, agent: vm$.agent }),
          ScriptDebugRoutesView({ store: vm$ }),
        ],
      ),
    ],
  );
}

/** ctx.log/ctx.error 行的展示文本：卡片日志条目与测试结果块共用同一套前缀。 */
function format_log_line(line) {
  return (line.level === "error" ? "[error] " : "[log] ") + line.text;
}

/** 单条执行日志：摘要、params、错误全文（保留 stack 与换行）、ctx.log 行。 */
function ScriptLogEntryView({ log }) {
  return View(
    {
      class: "box-border grid rounded-card bg-surface",
      style: {
        gap: "8px",
        "border-left":
          "3px solid " +
          (log.level === "error"
            ? "var(--frui-color-danger)"
            : "var(--frui-color-border-soft)"),
        padding: "11px 12px",
      },
      attributes: { n: "script-log-entry" },
    },
    [
      View(
        {
          class: "box-border text-muted break-anywhere",
          style: {
            font: "10px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace",
          },
          attributes: { n: "script-log-meta" },
        },
        [format_log_summary(log)],
      ),
      Show({
        when: Object.keys(log.params).length > 0,
        ok() {
          return View(
            {
              class:
                "box-border m-0 overflow-auto rounded-control whitespace-pre-wrap break-anywhere bg-canvas text-muted",
              style: {
                "max-height": "300px",
                padding: "10px",
                font: "10px/1.55 ui-monospace, SFMono-Regular, Menlo, monospace",
                "font-size": "12px",
              },
              attributes: { n: "script-log-params" },
            },
            [JSON.stringify(log.params, null, 2)],
          );
        },
      }),
      Show({
        when: log.error_text !== "",
        ok() {
          return View(
            {
              class:
                "box-border m-0 overflow-auto rounded-control whitespace-pre-wrap break-anywhere bg-danger-bg text-danger",
              style: {
                "max-height": "300px",
                padding: "10px",
                font: "10px/1.55 ui-monospace, SFMono-Regular, Menlo, monospace",
                "font-size": "12px",
              },
              attributes: { n: "script-log-error" },
            },
            [log.error_text],
          );
        },
      }),
      Show({
        when: log.lines.length > 0,
        ok() {
          return View(
            {
              class:
                "box-border m-0 overflow-auto rounded-control whitespace-pre-wrap break-anywhere grid bg-canvas text-muted",
              style: {
                "max-height": "300px",
                padding: "10px",
                font: "10px/1.55 ui-monospace, SFMono-Regular, Menlo, monospace",
                gap: "4px",
                "font-size": "12px",
              },
              attributes: { n: "script-log-lines" },
            },
            log.lines.map((line) =>
              View(
                {
                  class:
                    line.level === "error"
                      ? "box-border text-danger"
                      : "box-border ",
                  style: {},
                  attributes: { n: "script-log-line" },
                },
                [format_log_line(line)],
              ),
            ),
          );
        },
      }),
    ],
  );
}

function ScriptLogsDialogView({ store: vm$ }) {
  const open = computed(vm$.state.script_logs_route, Boolean);
  const modal = ModalViewModel({ onClose: vm$.methods.close_script_logs });
  return Dialog({
    open,
    title: "执行日志",
    description: combine({ route: vm$.state.script_logs_route, scripts: vm$.state.scripts }, ({ route, scripts }) => {
      const script = scripts.find(script => script.id === route);
      return script ? `${script.name} · ${script.path}` : route;
    }),
    attributes: { n: "script-logs-dialog", "aria-label": "执行日志" },
    class: "box-border flex flex-col overflow-hidden",
    style: { width: "min(960px, calc(100vw - 32px))", "max-height": "calc(100dvh - 32px)" },
    bodyProps: { class: "box-border overflow-auto min-h-0" },
    onMounted: modal.mount,
    onUnmounted: modal.unmount,
    onKeyDown: modal.keydown,
    onClose: vm$.methods.close_script_logs,
    footer: [Button({
      variant: "secondary", attributes: { n: "script-logs-close-button" },
      onClick: vm$.methods.close_script_logs,
    }, ["关闭"])],
  }, [ScriptLogsPanelView({ store: vm$ })]);
}

/** 弹窗中的执行日志：最新一页 + before_id 翻页。 */
function ScriptLogsPanelView({ store }) {
  const vm$ = store;
  return View(
    {
      class: "box-border grid rounded-card bg-surface",
      style: {
        gap: "10px",
        padding: "16px",
        border: "1px solid var(--frui-color-border-soft)",
      },
      attributes: { n: "script-logs-panel" },
    },
    [
      View(
        {
          class: "box-border grid text-muted",
          style: {
            gap: "4px",
            "font-size": "11px",
          },
          attributes: { n: "script-logs-heading" },
        },
        [
          "执行日志（/rss 与 /atom 共用）",
          "只记失败的真实请求与每次测试运行，保留 7 天。",
        ],
      ),
      Show({
        when: computed(vm$.state.script_logs_error, Boolean),
        ok() {
          return View(
            {
              class: "box-border text-danger",
              style: {
                "font-size": "12px",
              },
              attributes: { n: "script-logs-error", role: "alert" },
            },
            [vm$.state.script_logs_error],
          );
        },
      }),
      Show({
        when: vm$.state.script_logs_loading,
        ok() {
          return View(
            {
              class: "box-border rounded-card text-muted text-center",
              style: {
                padding: "16px",
                "font-size": "12px",
              },
              attributes: { n: "script-logs-loading" },
            },
            ["正在加载执行日志…"],
          );
        },
      }),
      Show({
        when: combine(
          {
            loading: vm$.state.script_logs_loading,
            logs: vm$.state.script_logs,
          },
          (deps) => !deps.loading && deps.logs.length === 0,
        ),
        ok() {
          return View(
            {
              class: "box-border rounded-card text-muted text-center",
              style: {
                padding: "16px",
                "font-size": "12px",
              },
              attributes: { n: "script-logs-empty" },
            },
            ["还没有执行日志。"],
          );
        },
      }),
      View(
        {
          class: "box-border grid",
          style: {
            gap: "9px",
          },
          attributes: { n: "script-logs-list" },
        },
        [
          For({
            key: "id",
            each: vm$.state.script_logs,
            render(log_value_) {
              return ScriptLogEntryView({ log: source_value(log_value_) });
            },
          }),
        ],
      ),
      Show({
        when: vm$.state.script_logs_loading_more,
        ok() {
          return View(
            {
              class: "box-border rounded-card text-muted text-center",
              style: {
                padding: "16px",
                "font-size": "12px",
              },
              attributes: { n: "script-logs-loading-more" },
            },
            ["正在加载更早日志…"],
          );
        },
      }),
      Show({
        when: vm$.state.script_logs_has_more,
        ok() {
          return View(
            {
              class: "box-border flex justify-center",
              attributes: { n: "script-logs-older" },
            },
            [
              Button(
                {
                  class: "box-border flex-none justify-self-center",
                  attributes: { n: "script-logs-older-button" },
                  disabled: computed(
                    vm$.state.script_logs_loading_more,
                    (loading) => loading || undefined,
                  ),
                  onClick() {
                    return vm$.methods.load_older_script_logs();
                  },
                },
                ["加载更早日志"],
              ),
            ],
          );
        },
      }),
    ],
  );
}

function ScriptCardView({ store, script, discovery }) {
  const vm$ = store;
  const status_pending = computed(vm$.state.status_pending, pending => pending[script.id] || undefined);
  return View(
    {
      class: "box-border grid rounded-card bg-surface-raised min-w-0",
      style: {
        gap: "11px",
        padding: "15px",
        "grid-template-columns": "minmax(0, 1fr)",
      },
      attributes: { n: "script-card" },
    },
    [
      View(
        {
          class: "box-border flex flex-wrap items-flex-start justify-between",
          style: {
            gap: "15px",
          },
          attributes: { n: "script-card-header" },
        },
        [
          View(
            {
              class: "box-border flex-1 min-w-0",
              attributes: { n: "script-card-identity" },
            },
            [
              View({
                class: "box-border flex flex-wrap items-center gap-space-4 min-w-0 text-muted text-sm",
                attributes: { n: "script-card-metadata" },
              }, [
                View({
                  class: "box-border inline-flex flex-none items-center gap-space-2 text-text text-base whitespace-nowrap",
                  attributes: { n: "script-card-platform" },
                }, [
                  Img({
                    src: discovery_platform_icon_url(script.platform),
                    class: "box-border block flex-none object-fit-contain",
                    style: { width: "var(--frui-space-5)", height: "var(--frui-space-5)" },
                    attributes: { n: "script-card-platform-icon", alt: "", "aria-hidden": "true",
                      width: "20", height: "20", referrerpolicy: "no-referrer" },
                  }),
                  discovery_platform_label(script.platform),
                ]),
                View(
                  {
                    class: "box-border flex items-center min-w-0 break-anywhere",
                    style: {
                      gap: "5px",
                    },
                    attributes: {
                      n: "script-card-website",
                      "aria-label": "来源网站",
                      title: "来源网站",
                    },
                  },
                  [
                    Icon("globe", 14),
                    script.website_url
                      ? Link(
                          {
                            class: "box-border",
                            href: script.website_url,
                            target: "_blank",
                            attributes: {
                              n: "script-card-website-link",
                              rel: "noopener noreferrer",
                            },
                          },
                          [script.url],
                        )
                      : script.url || "未填写",
                  ],
                ),
                View(
                  {
                    class: "box-border flex items-center min-w-0 break-anywhere",
                    style: {
                      gap: "5px",
                    },
                    attributes: {
                      n: "script-card-maintainers",
                      "aria-label": "共享者",
                      title: "共享者",
                    },
                  },
                  [
                    Icon("users", 14),
                    View(
                      {
                        as: "span",
                        class: "box-border inline-flex items-center flex-wrap",
                        style: {
                          gap: "6px",
                        },
                        attributes: { n: "script-card-maintainers-value" },
                      },
                      script.maintainers.length
                        ? script.maintainers.flatMap((value, index) => [
                            ...(index ? [", "] : []),
                            typeof value === "string"
                              ? value
                              : View(
                                  {
                                    as: "span",
                                    class:
                                      "box-border inline-flex items-center flex-wrap",
                                    style: {
                                      gap: "6px",
                                    },
                                    attributes: { n: "script-maintainer" },
                                  },
                                  [
                                    ...(value.avatar
                                      ? [
                                          Img({
                                            src: value.avatar,
                                            class:
                                              "box-border rounded-full object-cover",
                                            style: {
                                              width: "20px",
                                              height: "20px",
                                            },
                                            attributes: {
                                              n: "script-maintainer-avatar",
                                              alt: "",
                                              loading: "lazy",
                                              referrerpolicy: "no-referrer",
                                            },
                                          }),
                                        ]
                                      : []),
                                    value.url
                                      ? Link(
                                          {
                                            class: "box-border",
                                            href: value.url,
                                            target: "_blank",
                                            attributes: {
                                              n: "script-maintainer-link",
                                              rel: "noopener noreferrer",
                                            },
                                          },
                                          [value.nickname],
                                        )
                                      : View(
                                          {
                                            class: "box-border",
                                            as: "span",
                                            attributes: {
                                              n: "script-maintainer-nickname",
                                            },
                                          },
                                          [value.nickname],
                                        ),
                                  ],
                                ),
                          ])
                        : ["未填写"],
                    ),
                  ],
                ),
                View(
                  { class: "box-border", attributes: { n: "script-card-size" } },
                  [Math.ceil(script.script_bytes / 1024) + " KB"],
                ),
              ]),
              View(
                {
                  class: "box-border text-muted break-anywhere",
                  style: {
                    "margin-top": "5px",
                    "font-size": "11px",
                  },
                  attributes: { n: "script-card-updated" },
                },
                ["更新于 " + format_time(script.updated_at)],
              ),
            ],
          ),
          View(
            {
              class: "box-border flex flex-wrap items-center justify-end min-w-0 max-w-full",
              style: {
                gap: "var(--frui-space-2)",
                "margin-left": "auto",
              },
              attributes: { n: "script-card-release" },
            },
            [
              ...(script.draft ? [Badge({
                tone: "warning",
                class: "box-border flex-none whitespace-nowrap",
                attributes: { n: "script-draft-status" },
              }, ["存在草稿版本"])] : []),
              ...(script.cookie_authorization.status !== "none"
                ? [Badge({
                    tone: script.cookie_authorization.status === "active" ? "success" : "danger",
                    class: "box-border flex-none whitespace-nowrap",
                    attributes: {
                      n: "script-cookie-status",
                      title: script.cookie_authorization.message,
                    },
                  }, [script.cookie_authorization.status === "active" ? "Cookie 已授权" : "Cookie 需要重新确认"])]
                : []),
              script.status === "draft" && !script.current_release_id ? Badge(
                { tone: "warning", class: "box-border flex-none whitespace-nowrap",
                  attributes: { n: "script-status", "aria-label": "草稿" } },
                ["草稿"],
              ) : Button(
                {
                  variant: "secondary",
                  size: "small",
                  icon: Icon("chevron-down", 14),
                  icon_position: "end",
                  class: "box-border flex-none whitespace-nowrap",
                  attributes: {
                    n: "script-status",
                    "aria-label": (script.status === "draft" ? "草稿" : "正式版本 " + (script.version || "未编号")) + "，查看版本历史",
                    "aria-haspopup": "dialog",
                    title: script.status !== "draft" && script.script_hash
                      ? "源码 SHA-256：" + script.script_hash
                      : "查看版本历史",
                  },
                  onClick: () => vm$.methods.open_history(script.id),
                },
                [script.status === "draft" ? "草稿" : script.version || "未编号"],
              ),
            ],
          ),
        ],
      ),
      View(
        {
          class: "box-border grid items-start",
          style: {
            "grid-template-columns":
              "repeat(auto-fit, minmax(min(280px, 100%), 1fr))",
            gap: "14px 24px",
          },
          attributes: { n: "script-card-routes" },
        },
        vm$.methods.script_routes(script).map((entry) =>
          View(
            {
              class: "box-border grid min-w-0 rounded-control bg-surface",
              style: {
                gap: "var(--frui-space-2)",
                padding: "var(--frui-space-3)",
                border: "1px solid var(--frui-color-border-soft)",
              },
              attributes: {
                n: "script-route-group",
                role: "group",
                "aria-label": entry.name || entry.path || "路由",
              },
            },
            [
              View(
                {
                  class: "box-border text-muted break-anywhere",
                  style: {
                    "font-size": "11px",
                  },
                  attributes: { n: "script-route-name" },
                },
                [entry.name],
              ),
              View(
                {
                  class: "box-border min-w-0",
                  attributes: { n: "script-route-address" },
                },
                [
                  View(
                    {
                      class: "box-border text-link break-anywhere",
                      style: {
                        font: "12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace",
                      },
                      attributes: { n: "script-card-route" },
                    },
                    [entry.path || "未声明路由"],
                  ),
                ],
              ),
              View(
                {
                  class: "box-border text-muted break-anywhere",
                  style: {
                    "font-size": "11px",
                  },
                  attributes: { n: "script-card-example" },
                },
                ["示例 " + entry.example],
              ),
              TableField({
                class: "box-border text-muted font-mono",
                labelProps: {
                  class: "box-border break-anywhere font-mono",
                  style: {
                    "max-width": "10rem",
                  },
                },
                attributes: { n: "script-route-parameters" },
                items: Object.entries(entry.parameters).map(
                  ([name, description]) => ({
                    key: name,
                    label: name,
                    value: description,
                  }),
                ),
              }),
            ],
          ),
        ),
      ),
      View(
        {
          class: "box-border flex flex-wrap",
          style: {
            gap: "7px",
          },
          attributes: { n: "script-card-actions" },
        },
        [
          Button(
            {
              class: "box-border flex-none justify-self-center",
              attributes: { n: "script-edit-button" },
              onClick() {
                return vm$.methods.edit_script(script.id);
              },
            },
            [script.draft ? "编辑草稿" : "编辑"],
          ),
          ...(script.config_schema ? [Button({
            class: "box-border", attributes: { n: "script-config-button" },
            onClick: () => vm$.config.methods.open(script),
          }, ["配置"])] : []),
          ...(script.kind === "rss" ? [Button({
            class: "box-border",
            attributes: { n: "script-source-create-button", "aria-haspopup": "dialog",
              "aria-expanded": discovery.state.form_open },
            disabled: discovery.state.saving,
            onClick() {
              discovery.methods.create_source();
              return discovery.methods.start();
            },
          }, ["新增订阅源"])] : []),
          ...(script.cookie_authorization.status === "required"
            ? [
                Button(
                  {
                    class: "box-border",
                    attributes: { n: "script-cookie-check" },
                    onClick() {
                      return vm$.methods.check_cookie_permissions(script.id);
                    },
                  },
                  ["重新确认 Cookie 权限"],
                ),
              ]
            : []),
          Button(
            {
              class: "box-border flex-none justify-self-center",
              attributes: {
                n: "script-logs-toggle-button",
                "aria-haspopup": "dialog",
                "aria-expanded": computed(vm$.state.script_logs_route, route => Boolean(route) && route === script.id),
              },
              onClick() {
                return vm$.methods.toggle_script_logs(script.id);
              },
            },
            ["执行日志"],
          ),
          View({
            class: "box-border flex flex-wrap justify-end gap-space-2",
            style: { "margin-inline-start": "auto" },
            attributes: { n: "script-card-management-actions" },
          }, [
            ...(script.cookie_grant_id ? [Popconfirm({
              title: `撤销脚本“${script.name}”的 Cookie 授权？脚本将无法使用这些 Cookie。`, confirmText: "确认撤销",
              attributes: { n: "script-cookie-revoke-confirmation" },
              onConfirm: () => vm$.methods.revoke_cookie_consent(script.id),
              trigger: props => Button({ ...props, class: "box-border",
                attributes: { ...props.attributes, n: "script-cookie-revoke" } }, ["撤销 Cookie 授权"]),
            })] : []),
            ...(script.status !== "draft" ? [Popconfirm({
              title: script.draft
                ? `脚本「${script.name}」存在草稿版本。退回草稿将用当前正式版本覆盖草稿，未发布的修改将丢失，正式路由也将停止服务。是否继续？`
                : `将脚本「${script.name}」退回草稿？该脚本的所有正式路由将停止服务。`,
              confirmText: "确认退回草稿", disabled: status_pending,
              attributes: { n: "script-status-confirmation" },
              onConfirm: () => vm$.methods.set_script_status(script.id, "draft"),
              trigger: props => Button({ ...props, class: "box-border", variant: "secondary", disabled: status_pending,
                attributes: { ...props.attributes, n: "script-status-button" } }, ["退回草稿"]),
            })] : []),
            Popconfirm({
              title: `删除脚本“${script.name}”？该脚本的所有路由将立即 404。`,
              attributes: { n: "script-delete-confirmation" },
              onConfirm: () => vm$.methods.remove_script(script.id),
              trigger: props => Button({ ...props, class: "box-border flex-none",
                attributes: { ...props.attributes, n: "script-delete-button" } }, ["删除"]),
            }),
          ]),
        ],
      ),
    ],
  );
}

function ScriptListView({ store, discovery }) {
  const vm$ = store;
  return View(
    {
      class: "box-border min-w-0",
      attributes: { n: "script-list-section" },
    },
    [
      View(
        {
          class:
            "box-border grid rounded-card bg-surface max-760-align-items max-760-flex-direction max-760-display max-760-grid-template-columns",
          style: {
            "grid-template-columns": "minmax(0, 1fr) minmax(120px, 200px) auto",
            gap: "13px",
            "margin-top": "16px",
            padding: "16px",
            border: "1px solid var(--frui-color-border-soft)",
            "--max-760-align-items": "stretch",
            "--max-760-flex-direction": "column",
            "--max-760-display": "grid",
            "--max-760-grid-template-columns": "1fr",
          },
          attributes: { n: "script-filter-form" },
        },
        [
          FieldView(
            { semantic_name: "script-filter-query-field", label: "搜索" },
            [
              Input({
                class: "box-border",
                value: vm$.state.query,
                placeholder: "名称、路由、来源网站或描述",
                attributes: {
                  n: "script-filter-query-input",
                  "aria-label": "搜索脚本",
                },
                onInput(event) {
                  return vm$.methods.set_filter("query", event.target.value);
                },
              }),
            ],
          ),
          FieldView(
            { semantic_name: "script-filter-status-field", label: "状态" },
            [
              Select({
                class: "box-border",
                value: vm$.state.filter_status,
                options: [
                  { value: "all", label: "全部" },
                  { value: "draft", label: "草稿" },
                  { value: "published", label: "正式" },
                  { value: "enabled", label: "启用" },
                  { value: "disabled", label: "停用" },
                ],
                attributes: {
                  n: "script-filter-status-select",
                  "aria-label": "筛选脚本状态",
                },
                onChange(event) {
                  return vm$.methods.set_filter("status", event.target.value);
                },
              }),
            ],
          ),
          Button({ disabled: vm$.state.loading, style: { "align-self": "end", "justify-self": "end" },
            attributes: { n: "script-list-refresh" }, onClick: vm$.methods.start }, ["刷新"]),
        ],
      ),
      Show({
        when: computed(vm$.state.list_error, Boolean),
        ok() {
          return View(
            {
              class: "box-border text-danger whitespace-pre-wrap",
              style: {
                margin: "12px 0 0",
              },
              attributes: { n: "script-list-error", role: "alert" },
            },
            [vm$.state.list_error],
          );
        },
      }),
      View(
        {
          class: "box-border grid",
          style: {
            gap: "14px",
            "margin-top": "16px",
          },
          attributes: { n: "script-list" },
        },
        [
          Show({
            when: vm$.state.loading,
            ok() {
              return View(
                {
                  class: "box-border m-0 rounded-card text-muted text-center",
                  style: {
                    padding: "22px",
                  },
                  attributes: { n: "script-list-loading" },
                },
                ["正在加载脚本…"],
              );
            },
          }),
          Show({
            when: combine(
              { loading: vm$.state.loading, visible: vm$.visible_scripts },
              (deps) => !deps.loading && deps.visible.length === 0,
            ),
            ok() {
              return View(
                {
                  class: "box-border m-0 rounded-card text-muted text-center",
                  style: {
                    padding: "22px",
                  },
                  attributes: { n: "script-list-empty" },
                },
                [
                  combine({ query: vm$.state.query, status: vm$.state.filter_status }, ({ query, status }) =>
                    query.trim() || status !== "all"
                      ? "没有匹配的脚本。"
                      : "还没有脚本。点击“新增脚本”，保存后路由即时生效。",
                  ),
                ],
              );
            },
          }),
          For({
            key: "render_key",
            each: vm$.paged_scripts,
            render(script_value_) {
              const script = source_value(script_value_);
              return ScriptCardView({ store: vm$, script, discovery });
            },
          }),
        ],
      ),
      PaginationView(Timeless, {
        model: vm$.pagination,
        name: "scripts-pagination",
        label: "脚本列表分页",
      }),
    ],
  );
}

function ScriptEditorView({ store }) {
  return View({ class: "box-border", attributes: { n: "script-editor" } }, [
    Show({ when: store.state.form_open, ok: () => ScriptFormView({ store }) }),
    Show({ when: store.state.install_open, ok: () => ScriptInstallView({ store }) }),
    Show({ when: computed(store.state.history, value => value.open), ok: () => ScriptHistoryView({ store }) }),
    Show({ when: store.state.diff_open, ok: () => ScriptDiffView({ store }) }),
    Show({ when: store.config.state.open, ok: () => ScriptConfigView({ model: store.config }) }),
    ScriptCookieConsentView({ store }),
  ]);
}

function ScriptApplicationView(embedded = false) {
  const vm$ = ScriptViewModel();
  const discovery = DiscoveryAdminViewModel();
  let detach_agent;
  const content = View(
    {
      class: "box-border min-w-0",
      attributes: { n: "scripts-content" },
      onMounted() {
        vm$.methods.start();
        detach_agent = window.FindRSSAdminAgent?.register_page(
          "/admin/scripts",
          {
            read_context: () => ({
              editor_open: vm$.state.form_open.value,
              script_id: vm$.state.editing_id.value,
              kind: vm$.state.script_type.value,
              query: vm$.state.query.value,
              filter_status: vm$.state.filter_status.value,
              debug_url: vm$.state.debug_url.value,
              draft_characters: vm$.state.draft_script.value.length,
            }),
          },
        );
      },
      onUnmounted() {
        detach_agent?.();
        vm$.methods.destroy();
        discovery.methods.close_form();
        discovery.pagination.destroy();
      },
    },
    [
      View(
        {
          class: "box-border text-success",
          style: {
            margin: "6px 0 0",
            "font-size": "12px",
          },
          attributes: { n: "script-form-status", role: "status" },
        },
        [vm$.state.form_message],
      ),
      ScriptEditorView({ store: vm$ }),
      Show({
        when: computed(vm$.state.script_logs_route, Boolean),
        ok: () => ScriptLogsDialogView({ store: vm$ }),
      }),
      View({ class: "box-border text-success", attributes: { n: "script-source-status", role: "status" } },
        [discovery.state.form_message]),
      Show({ when: discovery.state.form_open, ok: () => SourceFormView({ store: discovery }) }),
    ],
  );
  const page_options = {
    page_id: "scripts",
    eyebrow: "Scripts",
    title: "脚本管理",
    actions: [
      Button({ variant: "secondary", disabled: vm$.state.saving,
        attributes: { n: "script-install-button", "aria-haspopup": "dialog", "aria-expanded": vm$.state.install_open },
        onClick: vm$.methods.open_install }, ["安装脚本"]),
      Button(
        {
          class: "box-border",
          attributes: {
            n: "script-create-button",
            "aria-haspopup": "dialog",
            "aria-expanded": vm$.state.form_open,
          },
          disabled: vm$.state.saving,
          onClick: vm$.methods.create_script,
        },
        ["新增脚本"],
      ),
    ],
  };
  const script_tabs = View(
    {
      class: "box-border grid min-w-0 items-center gap-space-3",
      style: {
        "grid-template-columns": "minmax(0, 1fr)",
      },
      attributes: { n: "script-page-tabs" },
    },
    [
      Tabs({
        listProps: {
          class: "box-border justify-self-start",
          style: {
            "grid-column": "1",
            "grid-row": "1",
          },
        },
        panelProps: {
          class: "box-border min-w-0 col-span-full",
          style: {
            "grid-row": "2",
          },
        },
        class: "box-border contents",
        value: computed(vm$.state.script_type, (type) => type),
        attributes: { n: "script-type-tabs", "aria-label": "脚本类型" },
        onChange: vm$.methods.select_script_type,
        items: [
          { id: "rss", label: "RSS" },
          { id: "hot", label: "Hot" },
        ].map((item) => ({
          ...item,
          panel_id: "script-type-panel-" + item.id,
          get content() {
            return [
              Show({
                when: computed(
                  vm$.state.script_type,
                  (type) => type === item.id,
                ),
                ok: () =>
                  View(
                    {
                      class: "box-border",
                      attributes: {
                        n: "script-type-panel-" + item.id,
                        id: "script-type-panel-" + item.id,
                        "aria-labelledby": "script-type-tabs-" + item.id,
                      },
                    },
                    [ScriptListView({ store: vm$, discovery })],
                  ),
              }),
            ];
          },
        })),
      }),
    ],
  );
  return embedded
    ? window.FindRSSAdminShell.Page(page_options, [script_tabs, content])
    : window.FindRSSAdminShell.View(page_options, [script_tabs, content]);
}

function ScriptPage() {
  return ScriptApplicationView(true);
}

export { ScriptPage, ScriptEditorView };
