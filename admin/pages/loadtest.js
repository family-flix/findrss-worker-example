import { format_datetime } from "../../server/lib/datetime.js";
import { LoadTestModel } from "./loadtest.model.js";

const { View, Button, Input, Select, Icon, For, computed, ref } =
  window.FindRSSAdminUI;
const seconds = (ms) => (Number(ms || 0) / 1000).toFixed(2) + " s";
const types = {
  all: "全部源",
  wxmp: "公众号",
  wxchannels: "视频号",
  website: "网站",
};
const unwrap = (value) => (value?.__is_ref ? value.value : value);
const status = (row) =>
  row.state === "done"
    ? row.valid_feed
      ? "成功"
      : "失败"
    : {
        queued: "待发起",
        running: "请求中",
        skipped: "已跳过",
        unknown: "状态未知",
      }[row.state] || "待发起";

function LoadTestPage() {
  const state = ref({
    rows: [],
    by_id: new Map(),
    events: [],
    summary: {},
    sources: [],
  });
  const model = LoadTestModel({ on_change: (next) => state.as(next) });
  state.as({ ...model.state, by_id: new Map() });
  const read = (fn) => computed(state, fn);
  const busy = read((s) =>
    ["starting", "running", "stopping"].includes(s.run_state),
  );
  const field = (name, label, control) =>
    View(
      {
        class: "box-border grid",
        style: {
          gap: "8px",
          "font-size": "12px",
        },
        attributes: { n: "loadtest-" + name + "-field" },
      },
      [
        View(
          {
            class: "box-border",
            attributes: { n: "loadtest-" + name + "-label" },
          },
          [label],
        ),
        control,
      ],
    );
  const metric = (name, label, value) =>
    View(
      {
        class: "box-border max-750-padding",
        style: {
          "border-right": "1px solid var(--frui-color-border)",
          padding: "8px 12px",
          "--max-750-padding": "4px",
        },
        attributes: { n: "loadtest-" + name },
      },
      [
        View(
          {
            class: "box-border tabular-nums max-750-font-size",
            style: {
              "font-size": "24px",
              "font-weight": "700",
              "--max-750-font-size": "20px",
            },
            attributes: { n: "loadtest-" + name + "-value" },
          },
          [read(value)],
        ),
        View(
          {
            class: "box-border text-muted",
            style: {
              "font-size": "12px",
              "line-height": "1.6",
            },
            attributes: { n: "loadtest-" + name + "-label" },
          },
          [label],
        ),
      ],
    );
  const selected = read((s) => s.by_id.get(s.selected));
  const content = View(
    {
      class: "box-border grid",
      style: {
        gap: "20px",
      },
      onMounted: model.methods.connect,
      onUnmounted: model.methods.dispose,
      attributes: { n: "loadtest-content" },
    },
    [
      View(
        {
          class: "box-border flex items-center flex-wrap",
          style: {
            gap: "14px",
          },
          attributes: { n: "loadtest-connection-line" },
        },
        [
          View(
            {
              class: "box-border",
              style: {
                "border-left": "3px solid var(--frui-color-link)",
                "padding-left": "10px",
                "font-weight": "650",
              },
              attributes: { n: "loadtest-connection", role: "status" },
            },
            [read((s) => "WS " + s.connection)],
          ),
          View(
            {
              class: "box-border text-muted",
              style: {
                "font-size": "12px",
                "line-height": "1.6",
              },
              attributes: { n: "loadtest-catalog-count" },
            },
            [read((s) => s.sources.length + " 个启用源")],
          ),
          Button(
            {
              class: "box-border",
              attributes: { n: "loadtest-reconnect" },
              onClick: model.methods.connect,
            },
            ["重新连接"],
          ),
        ],
      ),
      View(
        {
          class: "box-border flex items-end flex-wrap rounded-card bg-surface",
          style: {
            gap: "12px",
            padding: "18px",
            border: "1px solid var(--frui-color-border)",
          },
          attributes: { n: "loadtest-controls" },
        },
        [
          field(
            "scope",
            "测试范围",
            Select({
              class: "box-border",
              value: read((s) => s.scope),
              options: Object.entries(types).map(([value, label]) => ({
                value,
                label,
              })),
              disabled: busy,
              attributes: { n: "loadtest-scope", "aria-label": "测试范围" },
              onChange: (event) =>
                model.methods.set("scope", event.target.value),
            }),
          ),
          field(
            "concurrency",
            "同时请求数",
            Input({
              class: "box-border",
              value: read((s) => s.concurrency),
              disabled: busy,
              attributes: {
                n: "loadtest-concurrency",
                type: "number",
                min: "1",
                max: "1000",
                "aria-label": "同时请求数",
              },
              onInput: (event) =>
                model.methods.set("concurrency", event.target.value),
            }),
          ),
          field(
            "timeout",
            "超时（秒）",
            Input({
              class: "box-border",
              value: read((s) => s.timeout),
              disabled: busy,
              attributes: {
                n: "loadtest-timeout",
                type: "number",
                min: "1",
                max: "180",
                "aria-label": "超时秒数",
              },
              onInput: (event) =>
                model.methods.set("timeout", event.target.value),
            }),
          ),
          field(
            "mode",
            "缓存模式",
            Select({
              class: "box-border",
              value: read((s) => (s.cold ? "cold" : "normal")),
              disabled: busy,
              options: [
                { value: "cold", label: "冷请求 · 新缓存键" },
                { value: "normal", label: "正常请求 · 可命中快照" },
              ],
              attributes: { n: "loadtest-mode", "aria-label": "缓存模式" },
              onChange: (event) =>
                model.methods.set("cold", event.target.value === "cold"),
            }),
          ),
          Button(
            {
              variant: "primary",
              disabled: read(
                (s) =>
                  s.connection !== "已连接" ||
                  ["starting", "running", "stopping"].includes(s.run_state),
              ),
              class: "box-border flex-none",
              attributes: { n: "loadtest-start" },
              onClick: model.methods.start,
            },
            ["开始并发请求"],
          ),
          Button(
            {
              class: "box-border",
              disabled: read((s) => s.run_state !== "running"),
              attributes: { n: "loadtest-stop" },
              onClick: model.methods.stop,
            },
            ["停止发起"],
          ),
        ],
      ),
      View(
        {
          class: computed(
            state,
            (s) =>
              "box-border " +
              ("text-danger whitespace-pre-wrap " +
                (Boolean(s.error) ? "block" : "hidden")),
          ),
          style: {},
          attributes: { n: "loadtest-error", role: "alert" },
        },
        [read((s) => s.error)],
      ),
      View(
        {
          class: "box-border grid max-1100-grid-template-columns",
          style: {
            "grid-template-columns": "repeat(6, minmax(0, 1fr))",
            gap: "12px",
            "--max-1100-grid-template-columns": "repeat(3, minmax(0, 1fr))",
          },
          attributes: { n: "loadtest-metrics" },
        },
        [
          metric(
            "completed",
            "已返回 / 总请求",
            (s) => (s.summary.completed || 0) + " / " + (s.summary.total || 0),
          ),
          metric("active", "请求在途", (s) => s.summary.active || 0),
          metric("elapsed", "整批耗时", (s) => seconds(s.elapsed_ms)),
          metric(
            "success",
            "有效订阅 / 失败",
            (s) => (s.summary.success || 0) + " / " + (s.summary.failed || 0),
          ),
          metric("p95", "P95 耗时", (s) => seconds(s.summary.p95)),
          metric("hits", "缓存命中", (s) => s.summary.cache_hits || 0),
        ],
      ),
      View(
        {
          class:
            "box-border rounded-control bg-linear-gradient-to-right-var-frui-color-link-var-progress-var-frui-color-surface-raised-var-progress",
          attributes: {
            n: "loadtest-progress",
            role: "progressbar",
            "aria-label": "请求完成进度",
            "aria-valuemin": "0",
            "aria-valuemax": read((s) => s.summary.total || 0),
            "aria-valuenow": read((s) => s.summary.completed || 0),
          },
          style: {
            height: "6px",
            "--progress": read(
              (s) =>
                (s.summary.total
                  ? ((s.summary.completed + (s.summary.skipped || 0)) /
                      s.summary.total) *
                    100
                  : 0) + "%",
            ),
          },
        },
        [],
      ),
      View(
        {
          class: "box-border text-muted",
          style: {
            "font-size": "12px",
            "line-height": "1.6",
            "margin-top": "-10px",
          },
          attributes: { n: "loadtest-device-status" },
        },
        [
          read((s) => {
            const online = (s.summary.devices || []).filter((d) =>
              ["online", "busy"].includes(d.status),
            );
            const active = online.reduce((n, d) => n + d.active_tasks, 0),
              capacity = online.reduce((n, d) => n + d.max_concurrency, 0);
            const queued =
              (s.summary.task_counts || []).find((t) => t.status === "queued")
                ?.count || 0;
            return (
              "设备执行中 " +
              active +
              " / " +
              capacity +
              " 槽位 · 全局排队 " +
              queued +
              " · 请求并发峰值 " +
              (s.summary.peak_active || 0) +
              " · " +
              Number(s.summary.rps || 0).toFixed(2) +
              " 请求/秒 · P50 " +
              seconds(s.summary.p50) +
              " · P99 " +
              seconds(s.summary.p99)
            );
          }),
        ],
      ),
      View(
        {
          class:
            "box-border grid max-1100-grid-template-columns max-750-grid-template-columns",
          style: {
            "grid-template-columns": "minmax(0, 1fr) 320px",
            gap: "24px",
            "--max-1100-grid-template-columns": "minmax(0, 1fr) 260px",
            "--max-750-grid-template-columns": "minmax(0, 1fr)",
          },
          attributes: { n: "loadtest-workspace" },
        },
        [
          View(
            {
              class: "box-border min-w-0 rounded-card bg-surface",
              style: {
                padding: "18px",
                border: "1px solid var(--frui-color-border)",
              },
              attributes: { n: "loadtest-requests" },
            },
            [
              View(
                {
                  class: "box-border flex items-center flex-wrap",
                  style: {
                    gap: "14px",
                    "margin-bottom": "10px",
                  },
                  attributes: { n: "loadtest-grid-toolbar" },
                },
                [
                  View(
                    {
                      class: "box-border",
                      style: {
                        "margin-right": "auto",
                        "font-size": "15px",
                        "font-weight": "650",
                      },
                      attributes: { n: "loadtest-grid-heading" },
                    },
                    ["每个方块代表一个请求"],
                  ),
                  Select({
                    class: "box-border",
                    value: read((s) => s.filter),
                    options: [
                      { value: "all", label: "全部结果" },
                      { value: "failed", label: "仅失败" },
                      { value: "running", label: "正在请求" },
                    ],
                    attributes: {
                      n: "loadtest-filter",
                      "aria-label": "结果筛选",
                    },
                    onChange: (event) =>
                      model.methods.set("filter", event.target.value),
                  }),
                  Button(
                    {
                      class: "box-border",
                      disabled: read((s) => !s.run_id),
                      attributes: { n: "loadtest-export" },
                      onClick: model.methods.export,
                    },
                    ["导出 JSON"],
                  ),
                ],
              ),
              View(
                {
                  class: "box-border text-muted flex items-center flex-wrap",
                  style: {
                    "font-size": "12px",
                    "line-height": "1.6",
                    gap: "16px",
                  },
                  attributes: { n: "loadtest-legend" },
                },
                [
                  View(
                    {
                      class: "box-border",
                      attributes: { n: "loadtest-legend-circle" },
                    },
                    [Icon("circle", 14), "待发起"],
                  ),
                  View(
                    {
                      class: "box-border",
                      attributes: { n: "loadtest-legend-refresh-cw" },
                    },
                    [Icon("refresh-cw", 14), "请求中"],
                  ),
                  View(
                    {
                      class: "box-border",
                      attributes: { n: "loadtest-legend-check" },
                    },
                    [Icon("check", 14), "有效订阅"],
                  ),
                  View(
                    {
                      class: "box-border",
                      attributes: { n: "loadtest-legend-circle-alert" },
                    },
                    [Icon("circle-alert", 14), "失败"],
                  ),
                  View(
                    {
                      class: "box-border",
                      attributes: { n: "loadtest-legend-minus" },
                    },
                    [Icon("minus", 14), "跳过"],
                  ),
                ],
              ),
              View(
                {
                  class: "box-border grid",
                  style: {
                    "grid-template-columns":
                      "repeat(auto-fill, minmax(90px, 1fr))",
                    gap: "6px",
                    margin: "14px 0",
                  },
                  attributes: { n: "loadtest-grid" },
                },
                [
                  For({
                    key: "id",
                    each: read((s) =>
                      s.rows.filter(
                        (row) =>
                          s.filter === "all" ||
                          (s.filter === "failed" &&
                            row.state === "done" &&
                            !row.valid_feed) ||
                          (s.filter === "running" && row.state === "running"),
                      ),
                    ),
                    render(value) {
                      const id = unwrap(value).id,
                        row = (s) => s.by_id.get(id) || unwrap(value);
                      return Button(
                        {
                          contentProps: {
                            class: "box-border grid justify-items-start w-full",
                          },
                          class: computed(
                            state,
                            (s) =>
                              "box-border " +
                              ("min-w-0 rounded-control text-left border-color-border " +
                                (row(s).state === "done" && row(s).valid_feed
                                  ? "bg-success-bg text-success"
                                  : row(s).state === "done" &&
                                      !row(s).valid_feed
                                    ? "bg-danger-bg text-danger"
                                    : row(s).state === "running"
                                      ? "bg-surface-raised text-link"
                                      : row(s).state === "skipped"
                                        ? "bg-surface"
                                        : "bg-surface")),
                          ),
                          style: computed(state, (s) => ({
                            padding: "9px 7px",
                            opacity: row(s).state === "skipped" ? ".55" : "",
                            outline:
                              s.selected === id
                                ? "2px solid var(--frui-color-text)"
                                : "none",
                            "outline-offset": "1px",
                          })),
                          attributes: {
                            n: "loadtest-request-" + id,
                            title: read(
                              (s) => row(s).title + " · " + status(row(s)),
                            ),
                            "aria-pressed": read((s) =>
                              s.selected === id ? "true" : "false",
                            ),
                          },
                          onClick: () => model.methods.set("selected", id),
                        },
                        [
                          View(
                            {
                              class: "box-border",
                              attributes: { n: "loadtest-cell-status-" + id },
                            },
                            [
                              Icon(
                                read((s) =>
                                  row(s).state === "done"
                                    ? row(s).valid_feed
                                      ? "check"
                                      : "circle-alert"
                                    : row(s).state === "running"
                                      ? "refresh-cw"
                                      : row(s).state === "skipped"
                                        ? "minus"
                                        : "circle",
                                ),
                                14,
                              ),
                            ],
                          ),
                          View(
                            {
                              class:
                                "box-border overflow-hidden whitespace-nowrap text-ellipsis",
                              style: {
                                "font-size": "11px",
                                margin: "4px 0",
                              },
                              attributes: { n: "loadtest-cell-name-" + id },
                            },
                            [read((s) => row(s).title)],
                          ),
                          View(
                            {
                              class: "box-border tabular-nums",
                              style: {
                                "font-size": "11px",
                              },
                              attributes: { n: "loadtest-cell-time-" + id },
                            },
                            [read((s) => seconds(row(s).display_elapsed_ms))],
                          ),
                        ],
                      );
                    },
                  }),
                ],
              ),
              View(
                {
                  class: "box-border text-muted",
                  style: {
                    "font-size": "12px",
                    "line-height": "1.6",
                  },
                  attributes: { n: "loadtest-empty" },
                },
                [
                  read((s) =>
                    s.rows.length
                      ? ""
                      : "连接成功后点击“开始并发请求”，实时查看每个源的返回情况。",
                  ),
                ],
              ),
            ],
          ),
          View(
            {
              class:
                "box-border min-w-0 rounded-card bg-surface align-self-start sticky grid max-750-position",
              style: {
                padding: "18px",
                border: "1px solid var(--frui-color-border)",
                top: "20px",
                gap: "12px",
                "--max-750-position": "static",
              },
              attributes: { n: "loadtest-detail" },
            },
            [
              View(
                {
                  class: "box-border",
                  style: {
                    "font-size": "15px",
                    "font-weight": "650",
                  },
                  attributes: { n: "loadtest-detail-title" },
                },
                [computed(selected, (row) => row?.title || "响应详情")],
              ),
              View(
                {
                  class: "box-border",
                  style: {
                    "font-size": "13px",
                  },
                  attributes: { n: "loadtest-detail-status" },
                },
                [
                  computed(selected, (row) =>
                    row
                      ? status(row) +
                        " · HTTP " +
                        (row.code || "—") +
                        " · " +
                        seconds(row.elapsed_ms)
                      : "点击任一请求查看详情",
                  ),
                ],
              ),
              View(
                {
                  class: "box-border break-anywhere text-muted",
                  style: {
                    "font-size": "11px",
                  },
                  attributes: { n: "loadtest-detail-url" },
                },
                [computed(selected, (row) => row?.url || "")],
              ),
              View(
                {
                  class: "box-border text-muted",
                  style: {
                    "font-size": "12px",
                    "line-height": "1.6",
                  },
                  attributes: { n: "loadtest-detail-feed" },
                },
                [
                  computed(selected, (row) =>
                    row?.valid_feed
                      ? row.feed_title +
                        " · " +
                        row.items +
                        " 篇内容 · " +
                        row.bytes +
                        " 字节 · 缓存 " +
                        (row.cache || "外部源")
                      : row?.error || "",
                  ),
                ],
              ),
              View(
                {
                  as: "pre",
                  class:
                    "box-border whitespace-pre-wrap break-anywhere overflow-auto m-0 rounded-control bg-canvas",
                  style: {
                    "font-size": "11px",
                    "line-height": "1.6",
                    "max-height": "260px",
                    padding: "12px",
                  },
                  attributes: { n: "loadtest-detail-body" },
                },
                [
                  computed(
                    selected,
                    (row) => row?.preview || "尚未返回响应内容",
                  ),
                ],
              ),
              View(
                {
                  class: "box-border text-muted",
                  style: {
                    "font-size": "12px",
                    "line-height": "1.6",
                  },
                  attributes: { n: "loadtest-detail-truncated" },
                },
                [
                  computed(selected, (row) =>
                    row?.truncated ? "仅展示响应前 2000 个字符" : "",
                  ),
                ],
              ),
              View(
                {
                  class: "box-border",
                  style: {
                    "font-size": "15px",
                    "font-weight": "650",
                  },
                  attributes: { n: "loadtest-events-title" },
                },
                ["WS 事件"],
              ),
              View(
                {
                  class: "box-border overflow-auto text-muted break-anywhere",
                  style: {
                    "max-height": "160px",
                    "font-size": "11px",
                    "line-height": "1.8",
                  },
                  attributes: { n: "loadtest-events" },
                },
                [
                  For({
                    each: read((s) => s.events),
                    render(value) {
                      const event = unwrap(value);
                      return View(
                        {
                          class: "box-border",
                          attributes: { n: "loadtest-event" },
                        },
                        [
                          format_datetime(event.at) +
                            " " +
                            event.text,
                        ],
                      );
                    },
                  }),
                ],
              ),
            ],
          ),
        ],
      ),
      View(
        {
          class: "box-border text-muted",
          style: {
            "font-size": "12px",
            "line-height": "1.6",
          },
          attributes: { n: "loadtest-stop-note" },
        },
        [
          "停止后不再发起新请求，已领取的设备任务会继续完成。刷新页面会通过 WS 恢复当前测试状态。",
        ],
      ),
    ],
  );
  return window.FindRSSAdminShell.Page(
    {
      page_id: "loadtest",
      title: "并发请求",
      eyebrow: "FindRSS",
      count: read((s) => String(s.summary.total || 0)),
    },
    [content],
  );
}

export { LoadTestPage };
