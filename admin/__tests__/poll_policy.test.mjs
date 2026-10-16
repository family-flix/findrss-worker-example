import assert from "node:assert/strict";
import test from "node:test";
import { PollPolicyModel } from "../components/poll_policy.model.js";
import { SnapshotSettingsModel } from "../components/snapshot_settings.model.js";

const ui = { ref: value => ({ value, set(next) { this.value = next; } }) };

test("规则编辑器回填各模式，分钟转秒、每天时间与分时段完整保存", () => {
  const model = PollPolicyModel({ ui });
  const policies = [{ mode: "inherit" }, { mode: "manual" }, { mode: "interval", interval: 1800, timezone: "UTC" },
    { mode: "adaptive", min_interval: 300, max_interval: 7200, timezone: "Asia/Shanghai" },
    { mode: "times", days: [1,3,5], times: ["08:30"], timezone: "UTC" },
    { mode: "times", days: [0,6], times: ["08:00", "18:00"], timezone: "Asia/Shanghai" },
    { mode: "cron", cron: "0 8 * * 1-5", timezone: "UTC" },
    { mode: "windows", timezone: "UTC", outside_interval: 900, windows: [{ days: [1,2], start: "22:00", end: "02:00", interval: 600 }] }];
  for (const policy of policies) {
    model.methods.reset(policy);
    assert.equal(model.state.mode.value, policy.mode);
    assert.deepEqual(model.methods.value(), policy);
  }
  model.methods.set("windows", "bad"); assert.throws(model.methods.value, /每行填写/);
  model.methods.reset(); assert.equal(model.methods.value().mode, "inherit");
});

test("单时间点规则回填为多个时间点，可增减时间并保留星期和时区", () => {
  const model = PollPolicyModel({ ui });
  const policy = { mode: "times", days: [1,3,5], times: ["08:30"], timezone: "UTC" };
  model.methods.reset(policy);
  assert.equal(model.state.mode.value, "times");
  assert.equal(model.state.times.value, "08:30");
  model.methods.set("times", "08:30, 18:00");
  assert.deepEqual(model.methods.value(), { ...policy, times: ["08:30", "18:00"] });
  model.methods.set("times", "08:30");
  assert.deepEqual(model.methods.value(), policy);
});

test("计划预览按规则时区显示统一日期格式，不使用浏览器本地时区", t => {
  t.mock.method(Date, "now", () => Date.parse("2026-01-02T00:00:00Z"));
  const model = PollPolicyModel({ ui });
  model.methods.reset({ mode: "times", days: [0,1,2,3,4,5,6], times: ["08:30"], timezone: "Asia/Shanghai" });
  assert.equal(model.methods.preview(), "计划预览：2026-01-02 08:30（Asia/Shanghai）");
  model.methods.set("timezone", "America/New_York");
  assert.equal(model.methods.preview(), "计划预览：2026-01-02 08:30（America/New_York）");
});

test("默认规则加载失败不能保存，保存失败保留草稿重试，离开忽略迟到读取", async () => {
  let fail = true, finish; const writes = [];
  const model = SnapshotSettingsModel({ ui, request_json: async (_, options) => {
    if (!options) return new Promise(resolve => { finish = resolve; });
    writes.push(JSON.parse(options.body));
    if (fail) throw new Error("保存失败");
    return { policy: JSON.parse(options.body).policy };
  } });
  await model.methods.save(); assert.equal(writes.length, 0);
  const loading = model.methods.start(); model.methods.leave(); finish({ policy: { mode: "manual" } }); await loading;
  assert.equal(model.state.loaded.value, false);
  const reloading = model.methods.start(); finish({ policy: { mode: "interval", interval: 600, timezone: "UTC" } }); await reloading;
  model.editor.methods.set("interval", "30");
  await model.methods.save(); assert.match(model.state.error.value, /保存失败/); assert.equal(model.editor.state.interval.value, "30");
  fail = false; await model.methods.save(); assert.match(model.state.message.value, /已保存/);
  assert.equal(writes.at(-1).policy.interval, 1800);
});

test("保存期间离开再返回，等旧写入结束后重读，迟到写入不覆盖当前页面", async () => {
  let finish, reads = 0;
  let policy = { mode: "interval", interval: 600, timezone: "UTC" };
  const model = SnapshotSettingsModel({ ui, request_json: async (_, options) => {
    if (!options) { reads++; return { policy }; }
    return new Promise(resolve => { finish = () => { policy = JSON.parse(options.body).policy; resolve({ policy }); }; });
  } });
  await model.methods.start(); model.editor.methods.set("interval", "30");
  const saving = model.methods.save(); model.methods.leave();
  const reopening = model.methods.start();
  assert.equal(reads, 1); finish(); await saving; await reopening;
  assert.equal(reads, 2); assert.equal(model.state.loaded.value, true);
  assert.equal(model.editor.state.interval.value, "30"); assert.equal(model.state.message.value, "");
});
