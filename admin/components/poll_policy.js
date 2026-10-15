const labels = {
  inherit: "继承默认",
  interval: "按间隔",
  adaptive: "智能刷新",
  daily: "每天指定时间",
  times: "多个时间点",
  windows: "分时段",
  cron: "自定义 Cron",
  manual: "仅手动",
};

export function poll_policy_label(policy) {
  if (!policy || policy.mode === "inherit") return "继承默认";
  if (policy.mode === "interval") return `每 ${policy.interval / 60} 分钟`;
  if (policy.mode === "times")
    return `${policy.times.join("、")}（${policy.timezone}）`;
  return labels[policy.mode] || policy.mode;
}

export function PollPolicyView(
  model,
  {
    ui = model.ui || window.FindRSSAdminUI,
    name = "poll-policy",
    disabled = false,
  } = {},
) {
  const { View, Select, Input, Textarea, Show, computed, combine } = ui;
  const { state, methods } = model;
  const field = (key, label, help, attributes = {}) =>
    Input({
      class: "box-border",
      label,
      help,
      disabled,
      value: state[key],
      attributes: { n: name + "-" + key, ...attributes },
      onInput: (event) => methods.set(key, event.target.value),
    });
  const when = (modes, content) =>
    Show({
      when: computed(state.mode, (mode) => modes.includes(mode)),
      ok: content,
    });
  return View(
    { class: "box-border grid min-w-0 gap-space-3", attributes: { n: name } },
    [
      Select({
        value: state.mode,
        disabled,
        options: Object.entries(labels)
          .filter(([mode]) => model.inherit || mode !== "inherit")
          .map(([value, label]) => ({ value, label })),
        attributes: { n: name + "-mode", "aria-label": "抓取方式" },
        onChange: (event) => methods.set("mode", event.target.value),
      }),
      when(["interval"], () =>
        field("interval", "抓取间隔（分钟）", "5 分钟至 24 小时。", {
          type: "number",
          min: 5,
          max: 1440,
          step: 1,
        }),
      ),
      when(["adaptive"], () =>
        View({ class: "grid gap-space-3" }, [
          field("min_interval", "最快间隔（分钟）", "有新文章时缩短间隔。", {
            type: "number",
            min: 5,
            max: 1440,
          }),
          field(
            "max_interval",
            "最慢间隔（分钟）",
            "无新文章时逐步延长，范围为 5 至 1440 分钟。",
            { type: "number", min: 5, max: 1440 },
          ),
        ]),
      ),
      when(["daily"], () =>
        field("time", "每天抓取时间", undefined, { type: "time" }),
      ),
      when(["times"], () =>
        field(
          "times",
          "抓取时间点",
          "使用 24 小时制，逗号分隔，例如 08:00, 12:30, 18:00。",
        ),
      ),
      when(["daily", "times"], () =>
        field("days", "星期", "0 为周日，1 至 6 为周一至周六，逗号分隔。"),
      ),
      when(["windows"], () =>
        View({ class: "grid min-w-0 gap-space-3" }, [
          Textarea({
            label: "抓取时段",
            value: state.windows,
            disabled,
            attributes: {
              n: name + "-windows",
              "aria-label": "抓取时段",
              rows: "4",
            },
            onInput: (event) => methods.set("windows", event.target.value),
          }),
          View({ class: "text-muted" }, [
            "每行：星期 开始时间-结束时间 间隔分钟。例如 1,2,3,4,5 08:00-18:00 10。0 为周日，支持跨午夜，最多 8 个时段且不能重叠。",
          ]),
          field(
            "outside_interval",
            "时段外间隔（分钟）",
            "填 0 表示时段外不抓取；其他值为 5 至 1440。",
            { type: "number", min: 0, max: 1440 },
          ),
        ]),
      ),
      when(["cron"], () =>
        field(
          "cron",
          "Cron 表达式",
          "五段：分 时 日 月 星期。例如 0 8 * * 1-5 表示工作日 08:00。",
        ),
      ),
      when(["interval", "adaptive", "daily", "times", "windows", "cron"], () =>
        field("timezone", "时区", "例如 Asia/Shanghai 或 UTC。"),
      ),
      View(
        {
          class: "box-border text-muted",
          attributes: { n: name + "-preview", role: "status" },
        },
        [combine(state, () => methods.preview())],
      ),
    ],
  );
}
