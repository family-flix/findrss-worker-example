import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";
import { create_worker } from "../../router.js";
import { handle_admin_request } from "../../admin.js";
import { create_rank_loader } from "../loader.js";
import { publish_rank_snapshots, rank_snapshot_key } from "../snapshot.js";
import { submit_hot_snapshot } from "../../server/service/worker/hot_snapshot.js";
import { RepositoryBackgroundTasks } from "../../server/repository/background_tasks.js";
import { ServiceBackgroundTasks } from "../../server/service/application/background_tasks.js";
import { ServiceHotSnapshots } from "../../server/service/application/hot_snapshots.js";
import { snapshot_store } from "../../test/support/snapshot_store.js";
register("../../test/support/quickjs_wasm_hook.js", import.meta.url);
const {
  route
} = await import("../../application_router.js");
const {
  default: api
} = await import("../../api.js");
const url = "https://findrss.example/admin/api/hot/snapshot";
const request = (headers = {
  Authorization: "Bearer admin-secret"
}, method = "POST") => new Request(url, {
  method,
  headers
});
const queue_request = path => new Request("https://findrss.example/admin/api/background-tasks" + path, {
  method: path ? "POST" : "GET",
  headers: {
    Authorization: "Bearer admin-secret"
  }
});
function fixture(t, {
  release,
  failed = false,
  build_home
} = {}) {
  const store = snapshot_store();
  const repo = new RepositoryBackgroundTasks(store);
  const jobs = [],
    notifications = [];
  const tasks = new ServiceBackgroundTasks({
    repo,
    wait_until: job => jobs.push(job),
    notify: task => notifications.push(task)
  });
  t.after(async () => {
    for (const task of await repo.list()) if (task.status === "running") await tasks.cancel(task.id);
    await Promise.allSettled(jobs);
    store.db.close();
  });
  const env = {
    ADMIN_PASSWORD: "admin-secret",
    API_STORAGE: store.bucket
  };
  let runs = 0,
    submissions = 0,
    home_builds = 0;
  const load = create_rank_loader((failed ? ["ok", "failed"] : ["ok"]).map(id => ({
    id,
    source: id
  })), {
    compile: async source => ({
      metadata: {
        category: "科技",
        routes: [{
          name: source,
          path: "/demo",
          example: "/demo",
          route_index: 0
        }]
      }
    }),
    execute: async (source, _route, _invoke, _context, _cookies, _mock, _access, signal) => {
      runs++;
      if (release) await new Promise((resolve, reject) => {
        const abort = () => reject(signal.reason);
        signal.addEventListener("abort", abort, {
          once: true
        });
        release.promise.then(resolve).finally(() => signal.removeEventListener("abort", abort));
      });
      signal.throwIfAborted();
      if (source === "failed") throw Error("上游维护");
      return {
        output: JSON.stringify({
          kind: "hot_rank",
          title: "成功榜单",
          entries: []
        })
      };
    }
  });
  const app = {
    background_tasks: tasks,
    hot_snapshots: new ServiceHotSnapshots({
      background_tasks: tasks,
      build_snapshot: signal => publish_rank_snapshots(load, env, signal),
      build_home: async (catalog, signal) => {
        home_builds++;
        await build_home?.(catalog, signal);
      }
    })
  };
  env.APPLICATION = {
    fetch: input => {
      const request = typeof input === 'string' ? new Request(input) : input;
      if (new URL(request.url).pathname === '/_admin/hot/snapshot') submissions++;
      return route(request, app);
    }
  };
  const worker = create_worker({
    api,
    admin: handle_admin_request,
    rank_snapshot: submit_hot_snapshot
  });
  const drain = () => Promise.all(jobs);
  const list = async () => (await (await worker.fetch(queue_request(""), env)).json()).tasks;
  return {
    worker,
    env,
    repo,
    tasks,
    app,
    jobs,
    notifications,
    drain,
    list,
    get runs() {
      return runs;
    },
    get submissions() {
      return submissions;
    },
    get home_builds() {
      return home_builds;
    }
  };
}
test("手动触发必须鉴权，只接受 POST 和同源请求，服务缺席时不入队", async t => {
  const f = fixture(t);
  for (const headers of [{}, {
    Authorization: "Bearer wrong"
  }, {
    Authorization: "Basic invalid"
  }]) {
    assert.equal((await f.worker.fetch(request(headers), f.env)).status, 401);
  }
  const get = await f.worker.fetch(request(undefined, "GET"), f.env);
  assert.equal(get.status, 405);
  assert.equal(await get.headers.get("Allow"), "POST");
  assert.equal((await f.worker.fetch(request({
    Authorization: "Bearer admin-secret",
    Origin: "https://other.example"
  }), f.env)).status, 403);
  for (const env of [{
    ...f.env,
    API_STORAGE: undefined
  }, {
    ...f.env,
    APPLICATION: undefined
  }]) {
    assert.equal((await f.worker.fetch(request(), env)).status, 503);
  }
  assert.equal(f.submissions, 0);
  assert.equal(f.runs, 0);
  assert.equal((await f.repo.list()).length, 0);
  f.app.hot_snapshots.build_snapshot = null;
  assert.equal((await f.worker.fetch(request(), f.env)).status, 503);
});
test("接口在采集完成前返回 202 和任务 ID，队列可查状态并接收结束通知", {
  timeout: 5000
}, async t => {
  const release = Promise.withResolvers();
  const f = fixture(t, {
    release
  });
  const login = await f.worker.fetch(new Request("https://findrss.example/admin/auth/login", {
    method: "POST",
    body: JSON.stringify({
      password: f.env.ADMIN_PASSWORD
    })
  }), f.env);
  const Cookie = (await login.headers.get("Set-Cookie")).split(";")[0];
  const ids = [];
  for (const headers of [{
    Authorization: "Bearer admin-secret"
  }, {
    Authorization: "Basic " + btoa("admin:admin-secret")
  }, {
    Cookie,
    Origin: "https://findrss.example"
  }]) {
    const response = await f.worker.fetch(request(headers), f.env);
    assert.equal(response.status, 202);
    assert.equal(await response.headers.get("Cache-Control"), "no-store");
    const result = await response.json();
    assert.equal(result.task_id, result.task.id);
    assert.equal(result.task.status, "running");
    ids.push(result.task_id);
  }
  assert.equal(new Set(ids).size, 1);
  assert.equal((await f.repo.list()).length, 1);
  assert.equal((await f.list())[0].id, ids[0]);
  assert.equal((await f.list())[0].title, "刷新热榜快照");
  assert.equal((await f.list())[0].status, "running");
  assert.equal(f.env.API_STORAGE.calls.put, 0);
  release.resolve();
  await f.drain();
  const task = (await f.list())[0];
  assert.equal(task.status, "completed");
  assert.ok(task.finished_at >= task.started_at);
  assert.equal(f.runs, 1);
  assert.equal(f.home_builds, 1);
  assert.equal(JSON.parse(await (await f.env.API_STORAGE.get(rank_snapshot_key("ok"))).text()).title, "成功榜单");
  assert.equal(f.notifications.length, 2);
});
test("定时任务与手动触发共用队列中的同一任务，结束后可提交新任务", async t => {
  const release = Promise.withResolvers();
  const f = fixture(t, {
    release
  });
  await f.worker.scheduled({}, f.env);
  const first = (await f.list())[0];
  const manual = await (await f.worker.fetch(request(), f.env)).json();
  assert.equal(manual.task_id, first.id);
  assert.equal((await f.repo.list()).length, 1);
  release.resolve();
  await f.drain();
  assert.equal(f.runs, 1);
  const next = await (await f.worker.fetch(request(), f.env)).json();
  assert.notEqual(next.task_id, first.id);
  await f.drain();
  assert.equal((await f.repo.list()).length, 2);
});
test("脚本采集错误和快照写入错误记录为任务失败，后续任务仍可重试", async t => {
  const f = fixture(t, {
    failed: true
  });
  const first = await (await f.worker.fetch(request(), f.env)).json();
  await f.drain();
  assert.equal((await f.repo.find(first.task_id)).status, "failed");
  assert.match((await f.repo.find(first.task_id)).error, /failed: 上游维护/);
  assert.equal(f.home_builds, 1);
  assert.equal(JSON.parse(await (await f.env.API_STORAGE.get(rank_snapshot_key("failed"))).text()).error, "上游维护");
  f.env.API_STORAGE.fail_next({
    op: "put"
  });
  const second = await (await f.worker.fetch(request(), f.env)).json();
  await f.drain();
  assert.equal((await f.repo.find(second.task_id)).status, "failed");
  assert.match((await f.repo.find(second.task_id)).error, /快照写入失败/);
  assert.equal(f.home_builds, 1);
  assert.equal(f.runs, 4);
});
test("队列终止 Hot 刷新传播取消信号，保留旧 JSON 且停止后续写入", async t => {
  const release = Promise.withResolvers();
  const f = fixture(t, {
    release
  });
  await f.env.API_STORAGE.put(rank_snapshot_key("ok"), JSON.stringify({
    id: "ok",
    title: "旧快照",
    entries: []
  }));
  const result = await (await f.worker.fetch(request(), f.env)).json();
  await new Promise(setImmediate);
  const cancelled = await f.worker.fetch(queue_request("/" + result.task_id + "/cancel"), f.env);
  assert.equal(cancelled.status, 200);
  assert.equal((await cancelled.json()).task.status, "cancelled");
  release.resolve();
  await f.drain();
  assert.equal((await f.repo.find(result.task_id)).status, "cancelled");
  assert.equal(JSON.parse(await (await f.env.API_STORAGE.get(rank_snapshot_key("ok"))).text()).title, "旧快照");
  assert.equal(f.env.API_STORAGE.calls.put, 1);
  assert.equal(f.home_builds, 0);
});
test("JSON 完成后继续生成 HTML，发布结束前任务保持进行中", {
  timeout: 5000
}, async t => {
  const entered = Promise.withResolvers(),
    release = Promise.withResolvers();
  const f = fixture(t, {
    build_home: async (catalog, signal) => {
      assert.equal(catalog.boards.length, 1);
      assert.equal(f.env.API_STORAGE.objects.has(rank_snapshot_key("ok")), true);
      entered.resolve();
      await release.promise;
      signal.throwIfAborted();
    }
  });
  const {
    task_id
  } = await (await f.worker.fetch(request(), f.env)).json();
  await entered.promise;
  assert.equal((await f.repo.find(task_id)).status, "running");
  release.resolve();
  await f.drain();
  assert.equal((await f.repo.find(task_id)).status, "completed");
  assert.equal(f.home_builds, 1);
});
test("HTML 发布失败记录为同一任务失败，保留已生成的 JSON", async t => {
  const f = fixture(t, {
    build_home: async () => {
      throw Error("HTML 页面写入失败");
    }
  });
  const {
    task_id
  } = await (await f.worker.fetch(request(), f.env)).json();
  await f.drain();
  assert.equal((await f.repo.find(task_id)).status, "failed");
  assert.match((await f.repo.find(task_id)).error, /HTML 页面写入失败/);
  assert.equal(JSON.parse(await (await f.env.API_STORAGE.get(rank_snapshot_key("ok"))).text()).title, "成功榜单");
});
