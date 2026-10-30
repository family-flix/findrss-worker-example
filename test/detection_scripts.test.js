import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";
import { snapshot_store } from "./support/snapshot_store.js";
import { RepositoryScript } from "../server/repository/script.js";
import { RepositoryScriptRelease } from "../server/repository/script_release.js";
import { RepositoryRssCookieGrant } from "../server/repository/rss_cookie_grant.js";
import { RepositoryDetection } from "../server/repository/detection.js";
import { RepositoryBackgroundTasks } from "../server/repository/background_tasks.js";
import { ServiceDetection } from "../server/service/application/detections.js";
import { ServiceBackgroundTasks } from "../server/service/application/background_tasks.js";
import { RssRouteCache } from "../server/infra/rss_cache.js";
import { compare_detect_snapshots } from "../server/lib/detect.js";
import { create_worker } from "../router.js";
import api from "../api.js";
register("./support/quickjs_wasm_hook.js", import.meta.url);
const {
  ServiceScript
} = await import("../server/service/application/scripts.js");
const {
  route
} = await import("../application_router.js");
const edit = body => new Request("https://internal", {
  method: "POST",
  body: JSON.stringify(body)
});
const snapshot = text => ({
  body: {
    type: "content",
    value: text
  }
});
const source = `import {utils} from '@findrss/util';
export const kind='detect'; export const version='1.0.0'; export const platform={name:'检测平台'};
export const config_schema={type:'object',properties:{channel:{type:'string',default:'one'}}};
class Test extends DetectScript {
  async fetch(ctx){return utils.request_json(ctx,'https://example.com/content/'+ctx.params.id);}
  async normalize(data,ctx){return Result.Ok({title:'内容检测',link:'https://example.com/'+ctx.params.id,snapshot:data});}
}
const script=new Test(); export const route={path:'/detector/:id',name:'内容检测',example:'/detector/123',public:true,handler:ctx=>script.run(ctx)};`;
function fixture(t) {
  const store = snapshot_store();
  t.after(async () => await store.db.close());
  const repo = {
    scripts: new RepositoryScript(store),
    script_releases: new RepositoryScriptRelease(store),
    detections: new RepositoryDetection(store),
    rss_cookie_grants: new RepositoryRssCookieGrant(store),
    rss_cookies: {
      get: () => []
    },
    rss_route_cache: store.repo,
    script_logs: {
      delete_for_route() {}
    },
    discovery: {
      list_public_routes: () => [],
      list_private_routes: () => []
    }
  };
  const ports = {
    object_store: store.object_store,
    transaction: async callback => await store.storage.transaction(callback),
    route_cache: new RssRouteCache(60000, 100)
  };
  const app = {},
    scripts = new ServiceScript({
      repo,
      ports,
      app
    });
  scripts.record_log = () => {};
  scripts.rss_address_is_public = () => false;
  app.scripts = scripts;
  app.background_tasks = new ServiceBackgroundTasks({
    repo: new RepositoryBackgroundTasks(store),
    wait_until: promise => promise.catch(() => {})
  });
  app.detections = new ServiceDetection({
    repo: repo.detections,
    storage: store.storage,
    object_store: store.object_store,
    background_tasks: app.background_tasks,
    script_routes: async () => await scripts.detect_routes(),
    validate_script: async value => await scripts.detect_source(value),
    load_snapshot: (record, previous, signal) => scripts.execute_detection(record, previous, signal)
  });
  const worker = create_worker({
    api,
    admin: {},
    discovery: async () => new Response("page", {
      status: 404
    })
  });
  const env = {
    ADMIN_PASSWORD: "test-password",
    APPLICATION: (() => ({
      fetch: request => route(request, app)
    }))()
  };
  let current = snapshot("旧内容");
  const previous_fetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = previous_fetch;
  });
  globalThis.fetch = async () => Response.json(current);
  return {
    ...store,
    repo,
    ports,
    app,
    scripts,
    detectors: app.detections,
    set: value => {
      current = value;
    },
    create: async (script = source) => (await scripts.create_script(edit({
      script,
      status: "published",
      version: "1.0.0"
    }))).data.script,
    record: async script_id => (await app.detections.create({
      title: "检测",
      script_id,
      script_url: "/detector/123",
      enabled: false
    })).data.detection,
    request: async (path, options = {}) => path.startsWith("/admin/api/") ? await api.fetch(new Request("https://feeds.example" + path, options), env) : await worker.fetch(new Request("https://feeds.example" + path, options), env)
  };
}
test("任务基线独立、成功推进、变化历史及事件 ID 持久化到 R2", async t => {
  const f = fixture(t),
    script = await f.create(),
    first = await f.record(script.id),
    second = await f.record(script.id);
  assert.equal((await f.scripts.list_scripts(new URL("https://internal/scripts?kind=detect"))).scripts.length, 1);
  const one = await (await f.detectors.run_task(first.id)).promise;
  assert.equal(one.result.status, "initialized");
  assert.equal(one.result.changes.length, 0);
  f.set(snapshot("新内容"));
  const [a, b] = await Promise.all([(await f.detectors.run_task(first.id)).promise, (await f.detectors.run_task(second.id)).promise]);
  assert.equal(a.result.status, "changed");
  assert.equal(b.result.status, "initialized");
  assert.equal(a.result.previous_id, one.result.id);
  assert.equal(a.result.changes[0].before, "旧内容");
  assert.ok(a.result.changes[0].id);
  assert.equal((await f.detectors.result(first.id, a.result.id)).snapshot.body.value, "新内容");
  assert.equal((await f.repo.detections.run(first.id, a.result.id)).body_json, "");
  assert.equal((await (await f.detectors.run_task(first.id)).promise).result.status, "unchanged");
  assert.equal((await f.detectors.history(first.id)).runs.length, 3);
});
test("采集失败与不完整结果保留基线，不把失败误判为内容删除", async t => {
  const f = fixture(t),
    script = await f.create(),
    record = await f.record(script.id);
  await (await f.detectors.run_task(record.id)).promise;
  const baseline = (await f.repo.detections.find(record.id)).baseline_id;
  f.set({
    body: {
      type: "content",
      incomplete: true,
      reason: "分页中断"
    }
  });
  const partial = await (await f.detectors.run_task(record.id)).promise;
  assert.equal(partial.result.status, "inconclusive");
  assert.equal((await f.repo.detections.find(record.id)).baseline_id, baseline);
  globalThis.fetch = async () => {
    throw new Error("网络失败");
  };
  await assert.rejects((await f.detectors.run_task(record.id)).promise);
  assert.equal((await f.repo.detections.find(record.id)).baseline_id, baseline);
  const latest = (await f.detectors.history(record.id)).runs[0];
  assert.equal(latest.status, "error");
  assert.equal((await f.detectors.result(record.id, latest.id)).changes.length, 0);
});
test("只修改脚本代码不产生内容变化，影响数据的配置变化会重新建立基线", async t => {
  const f = fixture(t),
    script = await f.create(),
    record = await f.record(script.id);
  await (await f.detectors.run_task(record.id)).promise;
  await f.scripts.update_script(edit({
    script: source.replace("version='1.0.0'", "version='1.0.1'") + "\n// 调整实现，内容不变",
    version: "1.0.1",
    status: "published"
  }), script.id);
  assert.equal((await (await f.detectors.run_task(record.id)).promise).result.status, "unchanged");
  await f.scripts.update_script(edit({
    config: {
      channel: "two"
    }
  }), script.id);
  assert.equal((await (await f.detectors.run_task(record.id)).promise).result.status, "initialized");
});
test("Debug 接受旧内容快照并可重复比较，自定义比较筛选事件和规则命中", async t => {
  const f = fixture(t);
  f.set({
    fields: {
      type: "record",
      value: {
        price: "9",
        noise: 2
      }
    }
  });
  const custom = source.replace("  async fetch(ctx)", `  async compare(previous,current,ctx) {
    const compared=await ctx.detect.compare(previous,current); if(compared.error)return compared;
    const changes=compared.data.changes.filter(change=>change.path==='/price');
    return Result.Ok({changes,matches:changes.length?[{id:'price',label:'价格变化',change_indexes:[0]}]:[]});
  }
  async fetch(ctx)`);
  const previous = {
    fields: {
      type: "record",
      value: {
        price: "10",
        noise: 1
      }
    }
  };
  for (let index = 0; index < 2; index++) {
    const debug = await f.scripts.debug_script(edit({
      script: custom,
      version: "1.0.0",
      request_url: "/api/detect/detector/123",
      previous
    }));
    assert.equal(debug.ok, true, debug.rss_debug?.error_text);
    const value = JSON.parse(debug.rss_debug.output);
    assert.equal(value.changes.length, 1);
    assert.equal(value.changes[0].path, "/price");
    assert.equal(value.matches[0].id, "price");
  }
  assert.equal(await f.repo.detections.count(), 0);
});
test("检测 JSON API 不污染基线、不复用旧内容缓存，类型隔离及管理鉴权生效", async t => {
  const f = fixture(t);
  await f.create();
  const one = await f.request("/api/detect/detector/123");
  assert.equal(one.status, 200);
  assert.equal(await one.headers.get("Cache-Control"), "no-store");
  assert.equal((await one.json()).status, "initialized");
  f.set(snapshot("第二次"));
  assert.equal((await (await f.request("/api/detect/detector/123")).json()).snapshot.body.value, "第二次");
  const direct = await f.request("/detector/123");
  assert.equal(await direct.headers.get("Cache-Control"), "no-store");
  assert.equal((await direct.json()).snapshot.body.value, "第二次");
  assert.equal(await f.repo.detections.count(), 0);
  assert.equal((await f.request("/api/clip/detector/123")).status, 404);
  assert.equal((await f.request("/api/hot/detector/123")).status, 404);
  assert.equal((await f.request("/rss/detector/123")).status, 404);
  assert.equal((await f.request("/admin/api/detections")).status, 401);
  const headers = {
    Authorization: "Bearer test-password"
  };
  assert.equal((await f.request("/admin/api/detections", {
    headers
  })).status, 200);
  assert.equal((await f.request("/admin/api/detections", {
    method: "POST",
    headers: {
      ...headers,
      Origin: "https://evil.example"
    },
    body: "{}"
  })).status, 403);
  assert.equal((await f.request("/api/detect/detector/123", {
    method: "POST"
  })).status, 405);
});
test("运行去重，编辑、重置或删除后丢弃迟到结果；历史保留且来源改变重新初始化", async t => {
  const f = fixture(t),
    script = await f.create(),
    record = await f.record(script.id);
  await (await f.detectors.run_task(record.id)).promise;
  const old = (await f.repo.detections.find(record.id)).baseline_id;
  let finish;
  const original = f.detectors.load_snapshot;
  f.detectors.load_snapshot = async (...args) => {
    const value = await original(...args);
    await new Promise(resolve => {
      finish = resolve;
    });
    return value;
  };
  const task = await f.detectors.run_task(record.id);
  assert.equal((await f.detectors.run_task(record.id)).task.id, task.task.id);
  while (!finish) await new Promise(setImmediate);
  await f.detectors.reset(record.id);
  finish();
  await assert.rejects(task.promise, /基线已变更/);
  assert.equal((await f.repo.detections.find(record.id)).baseline_id, "");
  assert.ok(await f.repo.detections.run(record.id, old));
  f.detectors.load_snapshot = original;
  assert.equal((await (await f.detectors.run_task(record.id)).promise).result.status, "initialized");
  await f.detectors.update(record.id, {
    script_url: "/detector/456"
  });
  assert.equal((await (await f.detectors.run_task(record.id)).promise).result.status, "initialized");
  await f.detectors.delete(record.id);
  assert.equal((await f.object_store.list({
    prefix: "detections/"
  })).objects.length, 0);
});
test("采集中脚本停用或 R2 写入时授权撤销，不发布新快照；可暂停失效来源任务", async t => {
  const f = fixture(t),
    script = await f.create(),
    record = await f.record(script.id);
  await (await f.detectors.run_task(record.id)).promise;
  const baseline = (await f.repo.detections.find(record.id)).baseline_id;
  let revoked = false;
  f.scripts.cookie_access = async () => ({
    records: [],
    assert_grant() {
      if (revoked) throw new Error("授权已撤销");
    }
  });
  const put = await f.object_store.put.bind(f.object_store);
  f.object_store.put = async (...args) => {
    await put(...args);
    revoked = true;
  };
  await assert.rejects((await f.detectors.run_task(record.id)).promise, /授权已撤销/);
  assert.equal((await f.repo.detections.find(record.id)).baseline_id, baseline);
  assert.equal((await f.object_store.list({
    prefix: "detections/"
  })).objects.length, 1);
  await f.repo.scripts.update({
    ...(await f.repo.scripts.find(script.id)),
    enabled: 0
  });
  await f.scripts.invalidate_routes();
  await f.detectors.update(record.id, {
    enabled: false
  });
  assert.equal((await f.repo.detections.find(record.id)).enabled, 0);
});
test("历史保留最近 20 次和较旧有效基线，不完整结果与错误不会无限累积", async t => {
  const f = fixture(t),
    script = await f.create(),
    record = await f.record(script.id);
  f.detectors.load_snapshot = async () => ({
    ...compare_detect_snapshots(null, snapshot("基线")),
    kind: "detect",
    schema_version: 1,
    title: "测试",
    link: "https://example.com/",
    snapshot: snapshot("基线"),
    context_key: "test"
  });
  await (await f.detectors.run_task(record.id)).promise;
  const baseline = (await f.repo.detections.find(record.id)).baseline_id;
  f.detectors.load_snapshot = async () => {
    throw new Error("失败");
  };
  for (let index = 0; index < 24; index++) await assert.rejects((await f.detectors.run_task(record.id)).promise);
  assert.equal((await f.detectors.history(record.id)).runs.length, 21);
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM detection_runs WHERE detection_id=?").get(record.id).n, 21);
  assert.ok(await f.detectors.result(record.id, baseline));
  f.detectors.load_snapshot = async (record, previous) => ({
    ...compare_detect_snapshots(previous.snapshot, snapshot("恢复")),
    kind: "detect",
    schema_version: 1,
    title: "测试",
    link: "https://example.com/",
    snapshot: snapshot("恢复"),
    context_key: "test"
  });
  await (await f.detectors.run_task(record.id)).promise;
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM detection_runs WHERE detection_id=?").get(record.id).n, 20);
});
test("定时检测遵守仅手动和暂停规则、限制并发，删除会取消在途检测", async t => {
  const f = fixture(t),
    script = await f.create(),
    records = [];
  f.detectors.snapshot_settings = () => ({
    policy: {
      mode: "interval",
      interval: 300
    },
    max_concurrency: 2
  });
  for (let index = 0; index < 3; index++) {
    const row = await f.record(script.id);
    await f.detectors.update(row.id, {
      enabled: true
    });
    records.push(row);
  }
  const manual = (await f.detectors.create({
    title: "仅手动",
    script_id: script.id,
    script_url: "/detector/manual",
    poll_policy: {
      mode: "manual"
    }
  })).data.detection;
  assert.equal(await f.detectors.next_at(await f.repo.detections.find(manual.id)), null);
  assert.equal(f.detectors.pending.size, 0);
  const finishes = [];
  f.detectors.load_snapshot = async () => new Promise(resolve => {
    finishes.push(() => resolve({
      ...compare_detect_snapshots(null, snapshot("完成")),
      kind: "detect",
      schema_version: 1,
      title: "测试",
      link: "https://example.com/",
      snapshot: snapshot("完成"),
      context_key: "test"
    }));
  });
  const scheduled = f.detectors.refresh_due_snapshots();
  await new Promise(setImmediate);
  assert.equal(finishes.length, 2);
  assert.equal(await f.detectors.next_snapshot_at(), null);
  finishes.splice(0).forEach(finish => finish());
  await scheduled;
  assert.equal((await f.repo.detections.list()).filter(row => row.baseline_id).length, 2);
  const third = f.detectors.refresh_due_snapshots();
  await new Promise(setImmediate);
  const deleting = await records.find(row => f.detectors.pending.has(row.id));
  assert.ok(deleting);
  await f.detectors.delete(deleting.id);
  finishes[0]();
  await third;
  assert.equal(await f.repo.detections.find(deleting.id), undefined);
  assert.equal((await f.repo.detections.find(manual.id)).attempted_at, 0);
});
