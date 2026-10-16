import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { dayjs, format_datetime } from "../server/lib/datetime.js";
import { format_clock, format_time } from "../admin/utils.js";

test("共享时间格式兼容毫秒、数字字符串、Date 和带时区的日期字符串", () => {
  const options = { timezone: "Asia/Shanghai" };
  const timestamp = Date.parse("2026-01-02T03:04:59Z");
  for (const value of [timestamp, String(timestamp), new Date(timestamp), "2026-01-02T03:04:59Z", "2026-01-01T22:04:59-05:00"]) {
    assert.equal(format_datetime(value, options), "2026-01-02 11:04");
  }
  for (const value of [undefined, null, "", 0, "invalid", NaN, Infinity]) {
    assert.equal(format_datetime(value), "未知");
    assert.equal(format_datetime(value, { fallback: "—" }), "—");
  }
  assert.equal(format_datetime(timestamp, { ...options, format: "YYYY-MM-DD" }), "2026-01-02");
});

test("本地显示遵循宿主时区，UTC 和偏移字符串在跨日与夏令时切换时表示同一时刻", () => {
  const module_url = new URL("../server/lib/datetime.js", import.meta.url).href;
  const source = `import { format_datetime } from ${JSON.stringify(module_url)};
    console.log(JSON.stringify([
      format_datetime("2026-01-02T03:04:59Z"),
      format_datetime("2026-01-01T22:04:59-05:00"),
      format_datetime("2026-03-08T06:59:00Z"),
      format_datetime("2026-03-08T07:00:00Z"),
      format_datetime("2026-11-01T05:30:00Z"),
      format_datetime("2026-11-01T06:30:00Z"),
      format_datetime("2026-01-02T03:04:59Z", { timezone: "Asia/Shanghai" }),
      format_datetime("2026-01-02T03:04:59")
    ]));`;
  const cases = {
    UTC: ["2026-01-02 03:04", "2026-01-02 03:04", "2026-03-08 06:59", "2026-03-08 07:00", "2026-11-01 05:30", "2026-11-01 06:30"],
    "Asia/Shanghai": ["2026-01-02 11:04", "2026-01-02 11:04", "2026-03-08 14:59", "2026-03-08 15:00", "2026-11-01 13:30", "2026-11-01 14:30"],
    "America/New_York": ["2026-01-01 22:04", "2026-01-01 22:04", "2026-03-08 01:59", "2026-03-08 03:00", "2026-11-01 01:30", "2026-11-01 01:30"],
  };
  for (const [TZ, expected] of Object.entries(cases)) {
    const actual = JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", source], {
      env: { ...process.env, TZ }, encoding: "utf8",
    }));
    assert.deepEqual(actual, [...expected, "2026-01-02 11:04", "2026-01-02 03:04"], TZ);
  }
});

test("同步时刻保留今天与昨天样式，旧相对时间的日期使用统一格式", () => {
  const now = dayjs();
  assert.equal(format_clock(now.valueOf()), now.format("HH:mm"));
  assert.equal(format_clock(now.subtract(1, "day").valueOf()), "昨天 " + now.format("HH:mm"));
  assert.equal(format_clock(0), "");
  const older = now.subtract(8, "day");
  assert.equal(format_time(older.valueOf()), older.format("YYYY-MM-DD"));
});
