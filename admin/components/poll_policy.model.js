import {
  parse_poll_policy,
  default_poll_policy,
  next_policy_at,
} from "../../server/lib/poll_schedule.js";

export function PollPolicyModel({ ui, inherit = true } = {}) {
  const initial = {
    mode: inherit ? "inherit" : "interval",
    timezone: "Asia/Shanghai",
    interval: "60",
    min_interval: "15",
    max_interval: "720",
    time: "08:00",
    times: "08:00, 18:00",
    days: "0,1,2,3,4,5,6",
    cron: "0 8 * * *",
    windows: "1,2,3,4,5 08:00-18:00 10",
    outside_interval: "0",
  };
  const state = Object.fromEntries(
    Object.entries(initial).map(([key, value]) => [key, ui.ref(value)]),
  );
  const days = (value) =>
    String(value)
      .split(/[,，\s]+/)
      .filter(Boolean)
      .map(Number);
  const methods = {
    set(name, value) {
      state[name]?.set(String(value));
    },
    reset(policy = inherit ? { mode: "inherit" } : default_poll_policy()) {
      for (const [key, value] of Object.entries(initial)) state[key].set(value);
      state.mode.set(
        policy.mode === "times" && policy.times.length === 1
          ? "daily"
          : policy.mode,
      );
      if (policy.timezone) state.timezone.set(policy.timezone);
      for (const key of [
        "interval",
        "min_interval",
        "max_interval",
        "outside_interval",
      ]) {
        if (policy[key] !== undefined) state[key].set(String(policy[key] / 60));
      }
      if (policy.cron) state.cron.set(policy.cron);
      if (policy.days) state.days.set(policy.days.join(","));
      if (policy.times) {
        state.times.set(policy.times.join(", "));
        state.time.set(policy.times[0]);
      }
      if (policy.windows)
        state.windows.set(
          policy.windows
            .map(
              (window) =>
                `${window.days.join(",")} ${window.start}-${window.end} ${window.interval / 60}`,
            )
            .join("\n"),
        );
    },
    value() {
      const mode = state.mode.value;
      const policy = {
        mode: mode === "daily" ? "times" : mode,
        timezone: state.timezone.value.trim(),
      };
      if (mode === "interval")
        policy.interval = Number(state.interval.value) * 60;
      if (mode === "adaptive") {
        policy.min_interval = Number(state.min_interval.value) * 60;
        policy.max_interval = Number(state.max_interval.value) * 60;
      }
      if (mode === "cron") policy.cron = state.cron.value.trim();
      if (mode === "times" || mode === "daily") {
        policy.days = days(state.days.value);
        policy.times =
          mode === "daily"
            ? [state.time.value]
            : state.times.value.split(/[,，\s]+/).filter(Boolean);
      }
      if (mode === "windows") {
        policy.outside_interval = Number(state.outside_interval.value) * 60;
        policy.windows = state.windows.value
          .trim()
          .split(/\n/)
          .map((line) => {
            const match =
              /^([0-6](?:,[0-6])*)\s+(\d{2}:\d{2})-(\d{2}:\d{2})\s+(\d+(?:\.\d+)?)$/.exec(
                line.trim(),
              );
            if (!match)
              throw new Error(
                "每行填写：星期 开始时间-结束时间 间隔分钟，例如 1,2,3,4,5 08:00-18:00 10",
              );
            return {
              days: days(match[1]),
              start: match[2],
              end: match[3],
              interval: Number(match[4]) * 60,
            };
          });
      }
      return parse_poll_policy(policy, inherit);
    },
    preview() {
      try {
        const policy = methods.value();
        if (policy.mode === "inherit") return "使用设置中的默认抓取规则。";
        if (policy.mode === "manual") return "仅在点击强制刷新快照时抓取。";
        const at = next_policy_at(policy, Date.now());
        return (
          "计划预览：" +
          new Intl.DateTimeFormat("zh-CN", {
            timeZone: policy.timezone,
            dateStyle: "medium",
            timeStyle: "short",
          }).format(at) +
          "（" +
          policy.timezone +
          "）"
        );
      } catch (error) {
        return error.message;
      }
    },
  };
  return { state, methods, inherit, ui };
}
