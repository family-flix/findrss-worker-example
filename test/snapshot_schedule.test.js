import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { snapshot_store } from "./support/snapshot_store.js";
import { RepositoryDiscoverySource } from "../server/repository/discovery_source.js";
import { RepositoryAccessToken } from "../server/repository/access_token.js";
import { RepositoryCredit } from "../server/repository/credit.js";
import { ServiceCredit } from "../server/service/application/credits.js";
import { RepositorySnapshotSettings } from "../server/repository/snapshot_settings.js";
import { ServiceDiscovery } from "../server/service/application/discovery.js";
import { ServiceSnapshotSettings } from "../server/service/application/snapshot_settings.js";
import { DiscoverySourceModel } from "../server/domain/discovery_source.js";
import { parse_poll_policy, next_policy_at, learn_poll_interval } from "../server/lib/poll_schedule.js";
import { snapshot_next_at } from "../server/lib/snapshot_schedule.js";
import { RssRouteCache, rss_route_cache_key } from "../server/infra/rss_cache.js";
import { load_discovery_snapshot } from "../server/infra/discovery_snapshot.js";
import { RSS_ROUTE_CACHE_TTL_MS } from "../server/lib/constants.js";
register("./support/quickjs_wasm_hook.js", import.meta.url);
const {
  ServiceScript
} = await import("../server/service/application/scripts.js");
const {
  route
} = await import("../application_router.js");
const {
  default: api
} = await import("../api.js");
const at = value => Date.parse(value);
const interval = minutes => ({
  mode: "interval",
  interval: minutes * 60,
  timezone: "Asia/Shanghai"
});
function fixture(t) {
  const store = snapshot_store();
  t.after(async () => await store.db.close());
  const repo = {
    discovery: new RepositoryDiscoverySource(store),
    rss_route_cache: store.repo
  };
  const settings = new ServiceSnapshotSettings({
    repo: new RepositorySnapshotSettings(store),
    schedule_alarm: async () => {}
  });
  const calls = [];
  let fail = false,
    articles = [{
      title: "第一篇",
      link: "https://example.com/1"
    }];
  const service = new ServiceDiscovery({
    repo,
    snapshot_settings: async () => await settings.settings(),
    schedule_alarm: async () => {},
    load_snapshot: async source => {
      calls.push(source.id);
      if (fail) throw new Error("离线");
      return articles;
    }
  });
  async function add(id, policy, fields = {}) {
    await repo.discovery.insert({
      id,
      title: id,
      description: "",
      website: "",
      feed_url: "https://example.com/" + id,
      category: "",
      tags_json: "[]",
      enabled: 1,
      require_token: 0,
      sort_order: 0,
      source_type: "website",
      created_at: at("2026-10-16T00:00:00Z"),
      updated_at: at("2026-10-16T00:00:00Z"),
      poll_policy_json: JSON.stringify(policy || {
        mode: "inherit"
      }),
      ...fields
    });
  }
  return {
    ...store,
    repo,
    settings,
    service,
    calls,
    add,
    fail: () => {
      fail = true;
    },
    articles: value => {
      articles = value;
    }
  };
}
test("默认一小时；默认规则保存重建后继承，单源覆盖与仅手动优先", async t => {
  const now = at("2026-10-16T01:00:00Z");
  t.mock.method(Date, "now", () => now);
  const f = fixture(t);
  assert.deepEqual((await f.settings.settings()).policy, interval(60));
  await f.add("inherit");
  await f.add("own", interval(5));
  await f.add("manual", {
    mode: "manual"
  });
  await f.settings.save_settings({
    policy: interval(30)
  });
  const restarted = new ServiceSnapshotSettings({
    repo: new RepositorySnapshotSettings(f)
  });
  assert.deepEqual((await restarted.settings()).policy, interval(30));
  assert.equal(await f.service.scheduled_at(await f.repo.discovery.find("inherit")), now + 30 * 60000);
  assert.equal(await f.service.scheduled_at(await f.repo.discovery.find("own")), 0);
  assert.equal(await f.service.scheduled_at(await f.repo.discovery.find("manual")), null);
  await f.service.refresh_due_snapshots();
  assert.deepEqual(f.calls, ["own"]);
  await f.service.refresh_discovery_snapshot("manual");
  assert.deepEqual(f.calls, ["own", "manual"]);
  assert.equal(await f.service.scheduled_at(await f.repo.discovery.find("manual")), null);
  for (const policy of [{
    mode: "inherit"
  }, interval(1), {
    mode: "times",
    times: []
  }, {
    mode: "cron",
    cron: "bad"
  }]) {
    await assert.rejects(f.settings.save_settings({
      policy
    }), error => error.status === 400);
  }
  assert.deepEqual((await restarted.settings()).policy, interval(30));
});
test("每60分钟规则的手动刷新响应与重新加载列表返回相同的下次抓取时间", async t => {
  let now = at("2026-10-18T01:00:45Z");
  t.mock.method(Date, "now", () => now);
  const f = fixture(t);
  await f.add("inherit");
  await f.add("own", interval(60));
  for (const id of ["inherit", "own"]) {
    const started_at = now;
    f.service.load_snapshot = async () => {
      now += 2000;
      return [{
        title: "刷新后的文章"
      }];
    };
    const result = await f.service.refresh_discovery_snapshot(id);
    const listed = await (await f.service.list_discovery_sources(new URL("https://internal/_admin/discovery/sources"), true)).sources.find(source => source.id === id);
    assert.equal(result.next_snapshot_at, started_at + 3_600_000);
    assert.equal(result.next_snapshot_at, listed.next_snapshot_at);
    assert.deepEqual(result.poll_effective, interval(60));
  }
});
test("并发设置默认四个，保存及重启恢复；只改并发不推迟抓取时间，旧客户端保存保留并发", async t => {
  let now = at("2026-10-16T01:00:00Z");
  t.mock.method(Date, "now", () => now);
  const f = fixture(t);
  assert.equal((await f.settings.settings()).max_concurrency, 4);
  await f.add("inherit");
  await f.settings.save_settings({
    policy: interval(30),
    max_concurrency: 8
  });
  const before = await f.settings.settings();
  const next = await f.service.scheduled_at(await f.repo.discovery.find("inherit"));
  now += 60000;
  await f.settings.save_settings({
    policy: before.policy,
    max_concurrency: 2
  });
  assert.equal((await f.settings.settings()).updated_at, before.updated_at);
  assert.equal(await f.service.scheduled_at(await f.repo.discovery.find("inherit")), next);
  const restarted = new ServiceSnapshotSettings({
    repo: new RepositorySnapshotSettings(f)
  });
  assert.equal((await restarted.settings()).max_concurrency, 2);
  await restarted.save_settings({
    policy: interval(60)
  });
  assert.equal((await restarted.settings()).max_concurrency, 2);
  const saved = await restarted.settings();
  for (const value of [0, 17, -1, 1.5, "8", null, true]) {
    await assert.rejects(restarted.save_settings({
      max_concurrency: value
    }), error => error.status === 400);
    assert.deepEqual(await restarted.settings(), saved);
  }
});
test("自动抓取运行中调高并发补充空位，调低等待已开始任务完成且不重复抓取", async t => {
  t.mock.method(Date, "now", () => at("2026-10-16T01:00:00Z"));
  const f = fixture(t);
  for (let index = 0; index < 8; index++) await f.add("source-" + index);
  const running = new Map(),
    pending = [];
  f.service.load_snapshot = source => {
    f.calls.push(source.id);
    return new Promise(resolve => running.set(source.id, resolve));
  };
  async function finish(id) {
    (await running.get(id))([]);
    await running.delete(id);
  }
  try {
    await f.settings.save_settings({
      max_concurrency: 2
    });
    pending.push(f.service.refresh_due_snapshots());
    await new Promise(setImmediate);
    assert.equal(f.calls.length, 2);
    assert.equal(await f.service.next_snapshot_at(), Date.now() + 60000);
    await f.settings.save_settings({
      max_concurrency: 5
    });
    assert.equal(await f.service.next_snapshot_at(), Date.now() + 5000);
    pending.push(f.service.refresh_due_snapshots());
    await new Promise(setImmediate);
    assert.equal(f.calls.length, 5);
    await f.settings.save_settings({
      max_concurrency: 1
    });
    for (let index = 0; index < 4; index++) await finish("source-" + index);
    await new Promise(setImmediate);
    f.service.refresh_due_snapshots();
    await new Promise(setImmediate);
    assert.equal(f.calls.length, 5, "达到调低后的上限时不再启动新任务");
    assert.equal(running.size, 1, "调低并发不终止已有任务");
    await finish("source-4");
    await Promise.all(pending);
    pending.push(f.service.refresh_due_snapshots());
    await new Promise(setImmediate);
    assert.equal(f.calls.length, 6);
    assert.equal(running.size, 1);
    assert.equal(new Set(f.calls).size, 6);
  } finally {
    for (const id of [...running.keys()]) await finish(id);
    await Promise.all(pending);
  }
});
test("每天、多时间点、星期与 Cron 按指定时区计算，跨午夜时段尊重开始日", () => {
  const now = at("2026-10-16T00:00:00Z"); // 周五北京时间 08:00
  assert.equal(next_policy_at(parse_poll_policy({
    mode: "times",
    times: ["09:00", "18:00"],
    days: [1, 2, 3, 4, 5]
  }), now), at("2026-10-16T01:00:00Z"));
  assert.equal(next_policy_at(parse_poll_policy({
    mode: "cron",
    cron: "0 8 * * 1-5"
  }), now), at("2026-10-19T00:00:00Z"));
  assert.equal(next_policy_at(parse_poll_policy({
    mode: "times",
    timezone: "UTC",
    times: ["09:00"]
  }), now), at("2026-10-16T09:00:00Z"));
  const policy = parse_poll_policy({
    mode: "windows",
    timezone: "UTC",
    windows: [{
      days: [5],
      start: "22:00",
      end: "02:00",
      interval: 600
    }],
    outside_interval: 0
  });
  assert.equal(next_policy_at(policy, at("2026-10-16T21:00:00Z")), at("2026-10-16T22:00:00Z"));
  assert.equal(next_policy_at(policy, at("2026-10-17T01:55:00Z")), at("2026-10-23T22:00:00Z"));
  const daily = parse_poll_policy({
    mode: "times",
    times: ["08:30"]
  });
  assert.equal(next_policy_at(daily, now), at("2026-10-16T00:30:00Z"));
  assert.equal(next_policy_at(daily, at("2026-10-16T00:30:00Z")), at("2026-10-17T00:30:00Z"));
  const dst = parse_poll_policy({
    mode: "times",
    timezone: "America/New_York",
    times: ["02:30"]
  });
  assert.equal(next_policy_at(dst, at("2026-03-08T05:00:00Z")), at("2026-03-09T06:30:00Z"));
});
test("规则校验拒绝无效时间、时区、重叠时段，PATCH 保留规则并可恢复继承", () => {
  for (const policy of [{
    mode: "times",
    times: ["25:00"]
  }, {
    ...interval(10),
    timezone: "No/Zone"
  }, {
    mode: "adaptive",
    min_interval: 3600,
    max_interval: 300
  }, {
    mode: "windows",
    windows: [{
      days: [1],
      start: "23:00",
      end: "02:00",
      interval: 600
    }, {
      days: [2],
      start: "01:00",
      end: "03:00",
      interval: 600
    }]
  }]) {
    assert.throws(() => parse_poll_policy(policy));
  }
  const current = DiscoverySourceModel({
    title: "源",
    feed_url: "https://example.com/feed",
    poll_policy: interval(30)
  });
  assert.deepEqual(DiscoverySourceModel.validate(DiscoverySourceModel.merge_for_patch(current, {
    title: "新名称"
  })).model.poll_policy, interval(30));
  assert.equal(DiscoverySourceModel.validate(DiscoverySourceModel.merge_for_patch(current, {
    poll_policy: {
      mode: "inherit"
    }
  })).model.poll_policy.mode, "inherit");
  assert.equal(DiscoverySourceModel.validate({
    title: "源",
    feed_url: "https://example.com/feed",
    poll_policy: null
  }).ok, false);
});
test("分批抓取到期源，失败保留文章并推迟到下一轮，重建调度状态仍正确", async t => {
  let now = at("2026-10-16T01:00:00Z");
  t.mock.method(Date, "now", () => now);
  const f = fixture(t);
  for (let i = 0; i < 6; i++) await f.add("source-" + i, interval(5));
  await f.add("disabled", interval(5), {
    enabled: 0
  });
  await f.add("private", interval(5), {
    require_token: 1
  });
  await f.service.refresh_due_snapshots();
  assert.equal(f.calls.length, 4);
  await f.service.refresh_due_snapshots();
  assert.equal(f.calls.length, 6);
  await f.service.refresh_due_snapshots();
  assert.equal(f.calls.length, 6);
  now += 300000;
  f.fail();
  await f.service.refresh_due_snapshots();
  const saved = await f.repo.discovery.snapshot_get("source-0");
  assert.match(saved.error, /离线/);
  assert.equal(JSON.parse(saved.articles_json)[0].title, "第一篇");
  const restarted = new ServiceDiscovery({
    repo: f.repo,
    snapshot_settings: async () => await f.settings.settings()
  });
  const row = await (await f.repo.discovery.snapshot_schedule()).find(source => source.id === "source-0");
  assert.equal(await restarted.scheduled_at(row), now + 300000);
});
test("手动补抓按下次计划逾期五小时筛选全部源，跳过运行中、停用和仅手动源", async t => {
  const now = at("2026-10-18T12:00:00Z");
  t.mock.method(Date, "now", () => now);
  const f = fixture(t);
  for (const id of ["old", "boundary", "recent", "future", "never-old", "running"]) await f.add(id, interval(60));
  await f.add("never-new", interval(60), {
    created_at: now
  });
  await f.add("disabled", interval(60), {
    enabled: 0
  });
  await f.add("manual", {
    mode: "manual"
  });
  await f.add("external", interval(60), {
    require_token: 1
  });
  await f.add("private", interval(60), {
    require_token: 1,
    feed_url: "{{hostname}}/rss/private"
  });
  for (const [id, attempted_at] of [["old", now - 9 * 3600000], ["boundary", now - 6 * 3600000], ["recent", now - 6 * 3600000 + 1], ["future", now], ["running", now - 9 * 3600000], ["private", now - 9 * 3600000]]) {
    await f.repo.discovery.snapshot_attempt(id, (await f.repo.discovery.find(id)).feed_url, attempted_at);
  }
  f.service.snapshot_pending.set("running", new Promise(() => {}));
  const result = await f.service.recover_overdue_snapshots();
  assert.deepEqual(result, {
    matched_count: 5,
    queued_count: 4,
    skipped_count: 1
  });
  assert.equal((await f.service.recover_overdue_snapshots()).queued_count, 0);
  await new Promise(setImmediate);
  await f.service.snapshot_refreshing;
  assert.deepEqual([...f.calls].sort(), ["boundary", "never-old", "old", "private"]);
  assert.equal(f.service.snapshot_recovery.size, 0);
  assert.equal((await (await f.service.scheduled_sources()).find(source => source.id === "boundary")).next_at, now + 3600000);
});
test("手动补抓超过一批时持续填充空闲位置，失败继续且并发不超过设置", async t => {
  const now = at("2026-10-18T12:00:00Z");
  t.mock.method(Date, "now", () => now);
  const f = fixture(t),
    jobs = [],
    running = new Map();
  await f.settings.save_settings({
    max_concurrency: 2
  });
  f.service.wait_until = promise => jobs.push(promise);
  for (let index = 0; index < 7; index++) await f.add("overdue-" + index, interval(60));
  let active = 0,
    maximum = 0;
  f.service.load_snapshot = async source => {
    f.calls.push(source.id);
    maximum = Math.max(maximum, ++active);
    try {
      return await new Promise((resolve, reject) => running.set(source.id, {
        resolve,
        reject
      }));
    } finally {
      active--;
    }
  };
  const result = await route(new Request("https://internal/_admin/discovery/sources/recover-overdue", {
    method: "POST"
  }), {
    discovery: f.service
  });
  assert.equal(result.status, 202);
  assert.equal((await result.json()).queued_count, 7);
  await new Promise(setImmediate);
  assert.equal(running.size, 2);
  assert.equal(f.service.snapshot_recovery.size, 5);
  (await running.get("overdue-0")).reject(new Error("上游离线"));
  await running.delete("overdue-0");
  await new Promise(setImmediate);
  assert.equal(running.size, 2, "某个源失败后自动补充下一个");
  while (running.size) {
    const [id, job] = running.entries().next().value;
    await running.delete(id);
    job.resolve([]);
    await new Promise(setImmediate);
  }
  await Promise.all(jobs);
  assert.equal(maximum, 2);
  assert.equal(new Set(f.calls).size, 7);
  assert.equal(f.service.snapshot_recovery.size, 0);
  assert.equal(f.service.snapshot_automatic.size, 0);
  assert.match((await f.repo.discovery.snapshot_get("overdue-0")).error, /上游离线/);
});
test("补抓排队期间修改为仅手动的源不再启动，无匹配及不可用服务正确返回", async t => {
  t.mock.method(Date, "now", () => at("2026-10-18T12:00:00Z"));
  const f = fixture(t);
  assert.deepEqual(await f.service.recover_overdue_snapshots(), {
    matched_count: 0,
    queued_count: 0,
    skipped_count: 0
  });
  await f.settings.save_settings({
    max_concurrency: 1
  });
  await f.add("a", interval(60));
  await f.add("b", interval(60));
  let finish;
  f.service.load_snapshot = async source => {
    f.calls.push(source.id);
    return new Promise(resolve => {
      finish = resolve;
    });
  };
  assert.equal((await f.service.recover_overdue_snapshots()).queued_count, 2);
  await new Promise(setImmediate);
  await f.repo.discovery.update({
    ...(await f.repo.discovery.find("b")),
    poll_policy_json: '{"mode":"manual"}'
  });
  finish([]);
  await f.service.snapshot_refreshing;
  await new Promise(setImmediate);
  assert.deepEqual(f.calls, ["a"]);
  assert.equal(f.service.snapshot_recovery.size, 0);
  assert.equal((await route(new Request("https://internal/_admin/discovery/sources/recover-overdue"), {
    discovery: f.service
  })).status, 405);
  f.service.load_snapshot = null;
  await assert.rejects(async () => await f.service.recover_overdue_snapshots(), {
    status: 503
  });
});
test("三百个到期源中单个慢源不阻塞后续抓取，空闲位置继续补充且并发不超过四个", async t => {
  const now = at("2026-10-16T01:00:00Z");
  t.mock.method(Date, "now", () => now);
  const f = fixture(t);
  for (let index = 0; index < 300; index++) await f.add("source-" + index, interval(60));
  let finish_slow,
    active = 0,
    maximum = 0;
  f.service.load_snapshot = async source => {
    f.calls.push(source.id);
    maximum = Math.max(maximum, ++active);
    try {
      if (source.id === "source-0") await new Promise(resolve => {
        finish_slow = resolve;
      });
      return [];
    } finally {
      active--;
    }
  };
  const pending = [f.service.refresh_due_snapshots()];
  try {
    await new Promise(setImmediate);
    assert.equal(f.calls.length, 4);
    assert.equal(await f.service.next_snapshot_at(), now + 5000, "仍有到期源及空闲位置时及时安排下一轮");
    pending.push(f.service.refresh_due_snapshots());
    await new Promise(setImmediate);
    assert.equal(f.calls.length, 7, "不等待第一批最慢的源");
    while (f.calls.length < 300) {
      const previous = f.calls.length;
      pending.push(f.service.refresh_due_snapshots());
      await new Promise(setImmediate);
      assert.ok(f.calls.length > previous, "慢源运行期间仍持续推进");
    }
    assert.equal(new Set(f.calls).size, 300, "运行中的源不重复启动");
    assert.ok(maximum <= 4);
  } finally {
    finish_slow?.();
    await Promise.all(pending);
  }
});
test("智能刷新从文章变化学习间隔，手动和首次抓取不改变学习结果", async t => {
  let now = at("2026-10-16T01:00:00Z");
  t.mock.method(Date, "now", () => now);
  const f = fixture(t);
  const policy = {
    mode: "adaptive",
    min_interval: 300,
    max_interval: 1800,
    timezone: "UTC"
  };
  await f.add("adaptive", policy);
  await f.service.refresh_due_snapshots();
  assert.equal((await f.repo.discovery.snapshot_get("adaptive")).adaptive_interval, 300);
  now += 300000;
  await f.service.refresh_due_snapshots();
  assert.equal((await f.repo.discovery.snapshot_get("adaptive")).adaptive_interval, 450);
  f.articles([{
    title: "第二篇",
    link: "https://example.com/2"
  }]);
  now += 450000;
  await f.service.refresh_due_snapshots();
  assert.equal((await f.repo.discovery.snapshot_get("adaptive")).adaptive_interval, 338);
  await f.service.refresh_discovery_snapshot("adaptive");
  assert.equal((await f.repo.discovery.snapshot_get("adaptive")).adaptive_interval, 338);
  assert.equal(learn_poll_interval(policy, 1800, {
    failed: true
  }), 1800);
});
test("已登记源由单源规则调度，RSS/Atom 与 query 顺序归一；仅手动不被旧调度绕过", async t => {
  const f = fixture(t);
  await f.add("manual", {
    mode: "manual"
  }, {
    feed_url: "{{hostname}}/atom/demo?a=1&b=2"
  });
  const query = new URLSearchParams("b=2&a=1");
  const key = "public-snapshot:" + rss_route_cache_key("/demo", query);
  await f.repo.rss_route_cache.register_public(key, "/demo", query, "https://feeds.example/rss/demo", 100);
  const script = new ServiceScript({
    repo: f.repo,
    ports: {
      schedule_alarm: async () => {}
    },
    app: {
      discovery: f.service
    }
  });
  assert.equal(await script.next_snapshot_at(), null);
  await script.refresh_due_snapshots();
  assert.deepEqual(f.calls, []);
  assert.equal(snapshot_next_at({
    enabled: 1,
    require_token: 0,
    poll_policy: {
      mode: "manual"
    }
  }), null);
});
test("默认规则 API 要求管理员身份，保存校验错误返回 400 且不覆盖原规则", async t => {
  const f = fixture(t),
    app = {
      snapshot_settings: f.settings
    };
  const env = {
    ADMIN_PASSWORD: "test-password",
    APPLICATION: (() => ({
      fetch: request => route(request, app)
    }))()
  };
  const url = "https://feeds.example/admin/api/settings/snapshots";
  assert.equal((await api.fetch(new Request(url), env)).status, 401);
  const headers = {
    Authorization: "Bearer test-password",
    "Content-Type": "application/json"
  };
  const saved = await api.fetch(new Request(url, {
    method: "PUT",
    headers,
    body: JSON.stringify({
      policy: interval(30),
      max_concurrency: 8
    })
  }), env);
  assert.equal(saved.status, 200);
  const saved_settings = await saved.json();
  assert.deepEqual(saved_settings.policy, interval(30));
  assert.equal(saved_settings.max_concurrency, 8);
  const bad = await api.fetch(new Request(url, {
    method: "PUT",
    headers,
    body: '{"policy":{"mode":"cron","cron":"bad"}}'
  }), env);
  assert.equal(bad.status, 400);
  const read = await api.fetch(new Request(url, {
    headers
  }), env);
  assert.deepEqual((await read.json()).policy, interval(30));
  assert.equal((await route(new Request("https://internal/_admin/settings/snapshots", {
    method: "PUT",
    body: "bad"
  }), app)).status, 400);
});
test("新增定时源从创建时刻开始安排，不补抓该源创建前的历史时刻", () => {
  const now = at("2026-10-16T00:00:00Z");
  const policy = parse_poll_policy({
    mode: "times",
    times: ["18:00"]
  });
  const row = {
    enabled: 1,
    require_token: 0,
    created_at: now,
    poll_policy: {
      mode: "inherit"
    }
  };
  assert.equal(snapshot_next_at(row, {
    policy,
    updated_at: now - 86400000
  }, now), at("2026-10-16T10:00:00Z"));
  assert.equal(snapshot_next_at(row, {
    policy: interval(30),
    updated_at: now - 86400000
  }, now), 0);
});
test("新增和编辑订阅源持久化规则，修改其他字段保留规则与调度起点", async t => {
  let now = at("2026-10-16T01:00:00Z");
  t.mock.method(Date, "now", () => now);
  const f = fixture(t);
  const request = body => new Request("https://internal/", {
    method: "POST",
    body: JSON.stringify(body)
  });
  const created = await f.service.create_discovery_source(request({
    title: "源",
    feed_url: "https://example.com/feed",
    poll_policy: interval(30)
  }));
  const id = created.data.source.id;
  assert.deepEqual(DiscoverySourceModel.fromRow(await f.repo.discovery.find(id)).poll_policy, interval(30));
  now += 1000;
  await f.service.update_discovery_source(request({
    poll_policy: {
      mode: "manual"
    }
  }), id);
  const manual = await f.repo.discovery.find(id);
  assert.equal(await f.service.scheduled_at(manual), null);
  assert.equal(manual.poll_updated_at, now);
  now += 1000;
  await f.service.update_discovery_source(request({
    title: "新标题"
  }), id);
  const renamed = await f.repo.discovery.find(id);
  assert.equal(renamed.poll_updated_at, manual.poll_updated_at);
  assert.equal(DiscoverySourceModel.fromRow(renamed).poll_policy.mode, "manual");
});
test("私密自有源按规则自动抓取，手动模式及外部私密源不自动抓取，重启恢复下一次时间", async t => {
  let now = at("2026-10-16T01:00:00Z");
  t.mock.method(Date, "now", () => now);
  const f = fixture(t);
  await f.add("private", interval(60), {
    require_token: 1,
    feed_url: "{{hostname}}/rss/private"
  });
  await f.add("manual", {
    mode: "manual"
  }, {
    require_token: 1,
    feed_url: "{{hostname}}/atom/manual"
  });
  await f.add("external", interval(5), {
    require_token: 1
  });
  await f.service.refresh_due_snapshots();
  assert.deepEqual(f.calls, ["private"]);
  const saved = await f.repo.discovery.snapshot_get("private");
  assert.equal(saved.articles_json, "[]");
  assert.match(saved.poll_fingerprint, /^[0-9a-f]{64}$/);
  const public_catalog = await f.service.public_catalog();
  assert.ok(public_catalog.sources.every(source => source.snapshot.articles.length === 0));
  assert.doesNotMatch(JSON.stringify(public_catalog), /第一篇|https:\/\/example.com\/1|poll_fingerprint/);
  const restarted = new ServiceDiscovery({
    repo: f.repo
  });
  const row = await (await f.repo.discovery.snapshot_schedule()).find(source => source.id === "private");
  assert.equal(await restarted.scheduled_at(row), now + 3600000);
  await f.service.refresh_due_snapshots();
  assert.equal(f.calls.length, 1);
  now += 3600000;
  f.fail();
  await f.service.refresh_due_snapshots();
  assert.equal(f.calls.length, 2);
  const failed = await f.repo.discovery.snapshot_get("private");
  assert.equal(failed.saved_at, saved.saved_at);
  assert.match(failed.error, /离线/);
  assert.equal((await (await f.service.scheduled_sources()).find(source => source.id === "private")).next_at, now + 3600000);
});
test("私密智能刷新根据指纹学习，不存文章预览；编辑私密源保留状态", async t => {
  let now = at("2026-10-16T01:00:00Z");
  t.mock.method(Date, "now", () => now);
  const f = fixture(t);
  await f.add("private", {
    mode: "adaptive",
    min_interval: 300,
    max_interval: 1800
  }, {
    require_token: 1,
    feed_url: "{{hostname}}/rss/private"
  });
  await f.service.refresh_due_snapshots();
  now += 300000;
  await f.service.refresh_due_snapshots();
  assert.equal((await f.repo.discovery.snapshot_get("private")).adaptive_interval, 450);
  f.articles([{
    title: "第二篇私密文章",
    link: "https://example.com/2"
  }]);
  now += 450000;
  await f.service.refresh_due_snapshots();
  assert.equal((await f.repo.discovery.snapshot_get("private")).adaptive_interval, 338);
  assert.equal((await f.repo.discovery.snapshot_get("private")).articles_json, "[]");
  f.repo.scripts = {
    list: () => [{
      route: "private",
      path: "/private",
      metadata_json: JSON.stringify({
        path: "/private"
      }),
      kind: "rss",
      enabled: 1
    }]
  };
  const previous = await f.repo.discovery.snapshot_get("private");
  await f.service.update_discovery_source(new Request("https://internal/", {
    method: "POST",
    body: '{"title":"新名称"}'
  }), "private");
  assert.deepEqual(await f.repo.discovery.snapshot_get("private"), previous);
});
test("真实私密脚本自动生成 RSS/Atom；鉴权后只读，过期清理与重建后保留 XML，失败不泄露文章", async t => {
  let now = at("2026-10-16T01:00:00Z");
  t.mock.method(Date, "now", () => now);
  const f = fixture(t);
  await f.add("private", interval(60), {
    require_token: 1,
    feed_url: "{{hostname}}/rss/private/1?a=1&b=2"
  });
  const row = {
    route: "private",
    path: "/private/:id",
    enabled: 1,
    script: `export const route = {
    path: "/private/:id", async handler(ctx) {
      const result = await ctx.invoke("count", {});
      if (result.error) return result;
      return Result.Ok({ title: "私密版本" + result.data, items: [{ title: "私密文章", link: "https://example.com/secret" }] });
    }
  };`,
    metadata_json: JSON.stringify({
      path: "/private/:id",
      name: "私密"
    })
  };
  f.repo.scripts = {
    list_enabled: () => [row]
  };
  f.repo.access_tokens = new RepositoryAccessToken(f);
  f.repo.credit = new RepositoryCredit(f);
  await f.repo.access_tokens.insert({
    id: "user-token-id",
    user_id: "reader",
    name: "Reader",
    token_hash: "hash",
    token_hint: "hint",
    expires_at: null,
    created_at: 1,
    credit_balance: 10,
    total_credits_granted: 10
  });
  const ports = {
    route_cache: new RssRouteCache(RSS_ROUTE_CACHE_TTL_MS, 100, {
      store: f.repo.rss_route_cache
    }),
    schedule_alarm: async () => {}
  };
  const script = new ServiceScript({
    repo: f.repo,
    ports,
    app: {
      discovery: f.service,
      credit: new ServiceCredit({
        repo: f.repo,
        storage: f.storage
      })
    },
    public_origin: "https://feeds.example"
  });
  let executions = 0,
    fail = false;
  script.record_log = () => {};
  script.script_invoke = async () => {
    if (fail) throw new Error("offline");
    return ++executions;
  };
  f.service.load_snapshot = (source, origin) => load_discovery_snapshot(source, "https://feeds.example", (...args) => script.serve_rss_route(...args));
  const serve = (token = "", format = "rss") => script.serve_rss_route(format, "/private/1", new Request("https://internal/_public/feed/" + format + "/private/1?b=2&a=1", {
    headers: {
      "X-Api-Access-Token-ID": token
    }
  }));
  await assert.rejects(serve(), {
    status: 401
  });
  await assert.rejects(serve("user-token-id"), {
    status: 503
  });
  await Promise.all([f.service.refresh_due_snapshots(), ...script.xml_tasks.values()]);
  assert.equal(executions, 1);
  await assert.rejects(serve(), {
    status: 401
  });
  const first = await serve("user-token-id");
  assert.match(first.body, /私密文章/);
  assert.equal(first.headers["Cache-Control"], "private, no-cache");
  assert.match((await serve("user-token-id", "atom")).body, /私密文章/);
  assert.equal(executions, 1);
  now += RSS_ROUTE_CACHE_TTL_MS + 1;
  await f.repo.rss_route_cache.delete_expired(now);
  ports.route_cache = new RssRouteCache(RSS_ROUTE_CACHE_TTL_MS, 100, {
    store: f.repo.rss_route_cache
  });
  assert.equal((await serve("user-token-id")).body, first.body);
  assert.equal(executions, 1);
  now += 3600000;
  fail = true;
  await f.service.refresh_due_snapshots();
  assert.match((await f.repo.discovery.snapshot_get("private")).error, /offline/);
  assert.equal((await serve("user-token-id")).body, first.body);
  await assert.rejects(serve(), {
    status: 401
  });
  assert.doesNotMatch(JSON.stringify(await f.service.public_catalog()), /私密文章|example.com\/secret/);
});
