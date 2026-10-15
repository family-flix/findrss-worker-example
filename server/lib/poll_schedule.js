// Five-field cron (minute hour day-of-month month day-of-week), evaluated in an
// explicit IANA timezone. Adapted from xiaoxunrss; shared by admin and server.
const field_limits = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 7]];
const formatters = new Map();

function timezone_formatter(timezone) {
  if (!formatters.has(timezone)) {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone, year: "numeric", month: "numeric", day: "numeric",
      hour: "numeric", minute: "numeric", hourCycle: "h23",
    });
    if (formatters.size >= 64) formatters.clear();
    formatters.set(timezone, formatter);
  }
  return formatters.get(timezone);
}

export function parse_poll_cron(value) {
  if (typeof value !== "string" || value.length > 128) throw new Error("Cron 必须是五段表达式：分 时 日 月 星期");
  const parts = value.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error("Cron 必须是五段表达式：分 时 日 月 星期");
  const fields = parts.map(function(part, index) {
    const [min, max] = field_limits[index];
    const values = new Set();
    for (const entry of part.split(",")) {
      const match = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(entry);
      if (!match) throw new Error("Cron 仅支持数字、*、逗号、范围和 / 步长");
      const step = (function() {
        if (match[2] === undefined) {
          return 1;
        }
        return Number(match[2]);
      })();
      const range = (function() {
        if (match[1] === "*") {
          return [min, max];
        }
        return match[1].split("-").map(Number);
      })();
      if (range.length === 1) range.push((function() {
        if (match[2] === undefined) {
          return range[0];
        }
        return max;
      })());
      if (step < 1 || step > max - min + 1 || range[0] < min || range[1] > max || range[0] > range[1]) {
        throw new Error(`Cron 第 ${index + 1} 段超出范围 ${min}–${max}`);
      }
      for (let number = range[0]; number <= range[1]; number += step) values.add((function() {
        if (index === 4 && number === 7) {
          return 0;
        }
        return number;
      })());
    }
    return { values, wildcard: part.startsWith("*") };
  });
  return { expression: parts.join(" "), fields };
}

export function validate_poll_schedule(expression, timezone = "Asia/Shanghai") {
  try {
    timezone_formatter(timezone);
    if (!expression) return "";
    parse_poll_cron(expression);
    return "";
  } catch (error) {
    return (function() {
      if (error instanceof RangeError) {
        return "请输入有效的 IANA 时区，例如 Asia/Shanghai 或 UTC";
      }
      return error.message;
    })();
  }
}

/** Strictly after now; missed slots are skipped, never replayed in a burst. */
export function next_cron_at(expression, timezone, now) {
  const { fields } = parse_poll_cron(expression);
  const formatter = timezone_formatter(timezone || "Asia/Shanghai");
  const [minutes, hours, days, months, weekdays] = fields;
  const end = now + 8 * 366 * 86400000;
  let candidate = Math.floor(now / 60000) * 60000 + 60000;
  while (candidate <= end) {
    const parts = Object.fromEntries(formatter.formatToParts(candidate)
      .filter(function(part) { return part.type !== "literal"; }).map(function(part) { return [part.type, Number(part.value)]; }));
    const weekday = new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
    const dom = days.values.has(parts.day);
    const dow = weekdays.values.has(weekday);
    // Unix cron: restricted day-of-month and weekday are ORed; otherwise AND.
    const day_matches = (function() {
      if (days.wildcard || weekdays.wildcard) {
        return dom && dow;
      }
      return dom || dow;
    })();
    if (!months.values.has(parts.month) || !day_matches || !hours.values.has(parts.hour)) {
      candidate += (60 - parts.minute) * 60000;
      continue;
    }
    if (minutes.values.has(parts.minute)) return candidate;
    candidate += 60000;
  }
  throw new Error("Cron 在未来八年内没有可执行的时间");
}

const all_days = [0, 1, 2, 3, 4, 5, 6];
export function default_poll_policy() {
  return { mode: "interval", interval: 3600, timezone: "Asia/Shanghai" };
}

function interval_value(value, allow_zero = false) {
  const number = Number(value);
  if (allow_zero && number === 0) return 0;
  if (!Number.isInteger(number) || number < 300 || number > 86400) throw new Error("刷新间隔应为 5 分钟至 24 小时");
  return number;
}
function time_value(value) {
  if (typeof value !== "string" || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new Error("时间应为 HH:mm，例如 08:30");
  return value;
}
function minute_of_day(value) { return Number(value.slice(0, 2)) * 60 + Number(value.slice(3)); }
function day_values(value) {
  if (!Array.isArray(value) || !value.length || value.length > 7 || value.some(function(day) { return !Number.isInteger(day) || day < 0 || day > 6; })) throw new Error("请选择有效的星期");
  return [...new Set(value)].sort(function(a, b) { return a - b; });
}

/** Strict input validation at write boundaries; reads use the tolerant normalizer. */
export function parse_poll_policy(raw, allow_inherit = true) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("刷新策略格式无效");
  const mode = raw.mode;
  if (mode === "inherit" && allow_inherit) return { mode };
  if (mode === "manual") return { mode };
  const timezone = raw.timezone || "Asia/Shanghai";
  if (typeof timezone !== "string" || timezone.length > 128 || validate_poll_schedule("", timezone)) throw new Error("请输入有效的 IANA 时区，例如 Asia/Shanghai 或 UTC");
  if (mode === "interval") return { mode, timezone, interval: interval_value(raw.interval) };
  if (mode === "adaptive") {
    const min_interval = interval_value(raw.min_interval ?? 900), max_interval = interval_value(raw.max_interval ?? 43200);
    if (min_interval > max_interval) throw new Error("最快刷新间隔不能大于最慢间隔");
    return { mode, timezone, min_interval, max_interval };
  }
  if (mode === "cron") {
    const error = validate_poll_schedule(raw.cron, timezone);
    if (!raw.cron || error) throw new Error(error || "请输入 Cron 表达式");
    next_cron_at(raw.cron, timezone, Date.now());
    return { mode, timezone, cron: parse_poll_cron(raw.cron).expression };
  }
  if (mode === "times") {
    if (!Array.isArray(raw.times) || !raw.times.length || raw.times.length > 48) throw new Error("请输入 1 至 48 个刷新时间");
    return { mode, timezone, days: day_values(raw.days || all_days), times: [...new Set(raw.times.map(time_value))].sort() };
  }
  if (mode === "windows") {
    if (!Array.isArray(raw.windows) || !raw.windows.length || raw.windows.length > 8) throw new Error("请设置 1 至 8 个刷新时段");
    const windows = raw.windows.map(function(period) {
      const start = time_value(period?.start), end = time_value(period?.end);
      if (start === end) throw new Error("时段开始和结束时间不能相同");
      return { days: day_values(period.days), start, end, interval: interval_value(period.interval) };
    });
    // Split wrapping ranges at the week boundary, then check adjacent ranges.
    const ranges = [];
    for (const period of windows) for (const day of period.days) {
      const start = day * 1440 + minute_of_day(period.start);
      const duration = (minute_of_day(period.end) - minute_of_day(period.start) + 1440) % 1440;
      const end = start + duration;
      ranges.push([start, Math.min(end, 10080)]);
      if (end > 10080) ranges.push([0, end - 10080]);
    }
    ranges.sort(function(a, b) { return a[0] - b[0]; });
    for (let i = 1; i < ranges.length; i++) {
      if (ranges[i][0] < ranges[i - 1][1]) throw new Error("刷新时段不能重叠，请调整星期或时间");
    }
    return { mode, timezone, outside_interval: interval_value(raw.outside_interval ?? 0, true), windows };
  }
  throw new Error("未知的刷新方式");
}
export function normalize_poll_policy(raw, fallback = null, allow_inherit = true) {
  if (raw == null) return fallback;
  try { return parse_poll_policy(raw, allow_inherit); } catch { return fallback; }
}
export function validate_poll_policy(raw, allow_inherit = true) {
  try { parse_poll_policy(raw, allow_inherit); return ""; } catch (error) { return error.message; }
}
export function policy_poll_interval(policy) {
  if (policy.mode === "manual") return 0;
  if (policy.mode === "adaptive") return policy.min_interval;
  if (policy.mode === "interval") return policy.interval;
  if (policy.mode === "windows") return Math.min(...policy.windows.map(function(period) { return period.interval; }), policy.outside_interval || 86400);
  return 300;
}
function wall_time(at, timezone) {
  const parts = Object.fromEntries(timezone_formatter(timezone).formatToParts(at)
    .filter(function(part) { return part.type !== "literal"; }).map(function(part) { return [part.type, Number(part.value)]; }));
  return { minute: parts.hour * 60 + parts.minute,
    day: new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay() };
}
function window_at(policy, wall) {
  for (const period of policy.windows) {
    const start = minute_of_day(period.start), end = minute_of_day(period.end);
    if (start < end && period.days.includes(wall.day) && wall.minute >= start && wall.minute < end) return period;
    if (start > end && ((period.days.includes(wall.day) && wall.minute >= start)
      || (period.days.includes((wall.day + 6) % 7) && wall.minute < end))) return period;
  }
  return null;
}

export function next_policy_at(policy, now, state = {}) {
  if (policy.mode === "adaptive") return now + adaptive_interval(policy, state.adaptive_interval) * 1000;
  if (policy.mode === "manual") return Infinity;
  if (policy.mode === "interval") return now + policy.interval * 1000;
  if (policy.mode === "cron") return next_cron_at(policy.cron, policy.timezone, now);
  if (policy.mode === "times") {
    const times = new Set(policy.times.map(minute_of_day));
    for (let candidate = Math.floor(now / 60000) * 60000 + 60000, end = now + 9 * 86400000; candidate <= end; candidate += 60000) {
      const wall = wall_time(candidate, policy.timezone);
      if (policy.days.includes(wall.day) && times.has(wall.minute)) return candidate;
    }
  }
  if (policy.mode === "windows") {
    const initial = window_at(policy, wall_time(now, policy.timezone));
    const delay = (initial?.interval || policy.outside_interval) * 1000;
    let target = (function() {
      if (delay) {
        return now + delay;
      }
      return Infinity;
    })();
    let previous = initial;
    // At a new period's start refresh promptly; slower periods never carry a
    // fast interval across their boundary. Seconds are preserved for intervals.
    for (let candidate = Math.floor(now / 60000) * 60000 + 60000, end = now + 9 * 86400000; candidate <= end; candidate += 60000) {
      if (target < candidate) return target;
      const current = window_at(policy, wall_time(candidate, policy.timezone));
      if (current !== previous) {
        if (current) return candidate;
        target = (function() {
          if (policy.outside_interval) {
            return candidate + policy.outside_interval * 1000;
          }
          return Infinity;
        })();
        previous = current;
      }
      if (target <= candidate) return target;
    }
  }
  throw new Error("刷新策略没有可执行时间");
}


export function adaptive_interval(policy, previous) {
  return Math.round(Math.min(policy.max_interval, Math.max(policy.min_interval, ((function() {
    if (Number.isFinite(Number(previous))) {
      return Number(previous);
    }
    return 0;
  })()) || policy.min_interval)));
}
export function learn_poll_interval(policy, previous, { failed, first, manual, new_count }) {
  const interval = adaptive_interval(policy, previous);
  if (failed || first || manual) return interval;
  return adaptive_interval(policy, (function() {
    if (new_count > 0) {
      return interval * 0.75;
    }
    return interval * 1.5;
  })());
}
