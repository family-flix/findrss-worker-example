import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import timezone from "dayjs/plugin/timezone.js";
import "dayjs/locale/zh-cn.js";

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.locale("zh-cn");

// 时间戳使用毫秒；带偏移的日期字符串保留其代表的时刻，再转换到显示时区。
export function format_datetime(value, { fallback = "未知", format = "YYYY-MM-DD HH:mm", timezone } = {}) {
  if (value == null || value === "" || value === 0) return fallback;
  const timestamp = typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value)) ? Number(value) : value;
  const date = dayjs(timestamp);
  if (!date.isValid()) return fallback;
  return (timezone ? date.tz(timezone) : date).format(format);
}

export { dayjs };
