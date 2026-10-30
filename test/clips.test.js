import { read_script } from "./support/script_sources.js";
import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";
import { RepositoryClip } from "../server/repository/clip.js";
import { ServiceClip } from "../server/service/application/clips.js";
import { ServiceBackgroundTasks } from "../server/service/application/background_tasks.js";
import { RepositoryBackgroundTasks } from "../server/repository/background_tasks.js";
import { sanitize_clip_html } from "../server/infra/clip_html.js";
import { snapshot_store } from "./support/snapshot_store.js";
import { read_clip_json } from "../server/service/worker/clips.js";
register("./support/quickjs_wasm_hook.js", import.meta.url);
const {
  route
} = await import("../application_router.js");
const {
  default: api
} = await import("../api.js");
const {
  create_worker
} = await import("../router.js");
const source = read_script("clip/website.js");
const input = {
  title: "天气卡片",
  url: "https://example.com/weather",
  selector: "#weather",
  enabled: false
};
const snapshot = text => ({
  html: `<div style="color:red!important">${text}<script>steal()</script></div>`,
  stats: {
    width: 320,
    height: 180,
    node: "div#weather",
    image_missing: 1
  }
});
function fixture(t, load_snapshot = async () => snapshot("晴")) {
  const store = snapshot_store();
  t.after(async () => await store.db.close());
  const repo = new RepositoryClip(store);
  const background_tasks = new ServiceBackgroundTasks({
    repo: new RepositoryBackgroundTasks(store),
    wait_until: promise => promise.catch(() => {})
  });
  const clips = new ServiceClip({
    repo,
    storage: store.storage,
    object_store: store.object_store,
    load_snapshot,
    background_tasks
  });
  return {
    ...store,
    repo,
    clips,
    background_tasks
  };
}
async function create(f, body = {}) {
  return (await f.clips.create({
    ...input,
    ...body
  })).data.clip;
}
test("剪藏记录固定链接、去重采集和 R2 快照；公开 GET/HEAD 仅返回无脚本文档", async t => {
  let count = 0,
    finish;
  const f = fixture(t, async () => {
    count++;
    return new Promise(resolve => {
      finish = resolve;
    });
  });
  const clip = await create(f);
  assert.equal((await route(new Request("https://internal/_public" + clip.path), {
    clips: f.clips
  })).status, 404);
  const task = await f.clips.refresh_task(clip.id);
  assert.equal((await f.clips.refresh_task(clip.id)).task.id, task.task.id);
  await new Promise(setImmediate);
  assert.equal((await f.clips.list()).clips[0].refreshing, true);
  finish(snapshot("晴"));
  await task.promise;
  assert.equal(count, 1);
  const saved = await f.repo.find(clip.id);
  assert.equal(saved.html, "");
  assert.match(saved.object_key, /^clips\//);
  assert.equal((await f.clips.list()).clips[0].path, clip.path);
  const get = await route(new Request("https://internal/_public" + clip.path), {
    clips: f.clips
  });
  assert.equal(get.status, 200);
  const html = await get.text();
  assert.match(html, /晴/);
  assert.match(html, /color:red!important/);
  assert.doesNotMatch(html, /<script/i);
  assert.match(await get.headers.get("Content-Security-Policy"), /sandbox;/);
  assert.match(await get.headers.get("Content-Security-Policy"), /frame-ancestors \*/);
  assert.equal(get.headers.has("X-Frame-Options"), false);
  assert.equal(await get.headers.get("Cache-Control"), "no-store");
  const head = await route(new Request("https://internal/_public" + clip.path, {
    method: "HEAD"
  }), {
    clips: f.clips
  });
  assert.equal(await head.text(), "");
  assert.equal(count, 1);
});
test("刷新成功替换旧对象；失败保留上一次快照、记录错误", async t => {
  const f = fixture(t);
  const clip = await create(f);
  await (await f.clips.refresh_task(clip.id)).promise;
  const previous = await f.repo.find(clip.id);
  f.clips.load_snapshot = async () => {
    throw new Error("上游超时");
  };
  await assert.rejects((await f.clips.refresh_task(clip.id)).promise, /上游超时/);
  assert.equal((await f.repo.find(clip.id)).saved_at, previous.saved_at);
  assert.equal((await f.repo.find(clip.id)).error, "上游超时");
  assert.match(await f.clips.document(clip.id), /晴/);
  f.clips.load_snapshot = async () => snapshot("雨");
  await (await f.clips.refresh_task(clip.id)).promise;
  assert.equal(await f.object_store.get(previous.object_key), null);
  assert.match(await f.clips.document(clip.id), /雨/);
  assert.equal((await f.repo.find(clip.id)).error, "");
});
test("采集中编辑规则或删除记录，迟到结果不覆盖旧快照、不复活链接", async t => {
  const f = fixture(t),
    clip = await create(f);
  await (await f.clips.refresh_task(clip.id)).promise;
  let finish;
  f.clips.load_snapshot = async () => new Promise(resolve => {
    finish = resolve;
  });
  const pending = await f.clips.refresh_task(clip.id);
  await new Promise(setImmediate);
  await f.clips.update(clip.id, {
    selector: "#tomorrow"
  });
  finish(snapshot("迟到"));
  await assert.rejects(pending.promise, /规则已变更/);
  assert.match(await f.clips.document(clip.id), /晴/);
  assert.doesNotMatch(await f.clips.document(clip.id), /迟到/);
  const deleting = await f.clips.refresh_task(clip.id);
  await new Promise(setImmediate);
  await f.clips.delete(clip.id);
  finish(snapshot("不复活"));
  await assert.rejects(deleting.promise, /终止/);
  await assert.rejects(async () => await f.clips.find(clip.id), {
    status: 404
  });
  assert.equal((await f.object_store.list({
    prefix: "clips/"
  })).objects.length, 0);
});
test("定时调度继承规则、限制并发、停用与仅手动规则不自动采集", async t => {
  const f = fixture(t, null);
  f.clips.snapshot_settings = () => ({
    policy: {
      mode: "interval",
      interval: 300
    },
    max_concurrency: 2
  });
  const clips = [];
  for (let i = 0; i < 3; i++) clips.push(await create(f, {
    title: String(i),
    enabled: true
  }));
  const manual = await create(f, {
    title: "manual",
    enabled: true,
    poll_policy: {
      mode: "manual"
    }
  });
  await f.repo.attempt(manual.id, Date.now());
  await create(f, {
    title: "disabled"
  });
  const finishes = [];
  f.clips.load_snapshot = async () => new Promise(resolve => finishes.push(resolve));
  const running = f.clips.refresh_due_snapshots();
  await new Promise(setImmediate);
  assert.equal(finishes.length, 2);
  assert.equal(f.clips.pending.size, 2);
  assert.equal(await f.clips.next_snapshot_at(), null);
  finishes.forEach(finish => finish(snapshot("ok")));
  await running;
  assert.equal((await f.repo.list()).filter(row => row.saved_at).length, 2);
  assert.ok((await f.clips.next_snapshot_at()) <= Date.now() + 5100);
  const second = f.clips.refresh_due_snapshots();
  await new Promise(setImmediate);
  assert.equal(finishes.length, 3);
  finishes[2](snapshot("third"));
  await second;
  assert.equal((await f.repo.list()).filter(row => row.saved_at).length, 3);
  assert.ok((await f.clips.next_snapshot_at()) >= Date.now() + 295000);
});
test("智能刷新按静态内容是否变化调整间隔", async t => {
  const f = fixture(t),
    clip = await create(f, {
      poll_policy: {
        mode: "adaptive",
        min_interval: 300,
        max_interval: 3600
      }
    });
  await (await f.clips.refresh_task(clip.id, {
    automatic: true
  })).promise;
  assert.equal((await f.repo.find(clip.id)).adaptive_interval, 300);
  await (await f.clips.refresh_task(clip.id, {
    automatic: true
  })).promise;
  assert.equal((await f.repo.find(clip.id)).adaptive_interval, 450);
  f.clips.load_snapshot = async () => snapshot("changed");
  await (await f.clips.refresh_task(clip.id, {
    automatic: true
  })).promise;
  assert.equal((await f.repo.find(clip.id)).adaptive_interval, 338);
});
test("未配置渲染器仍可保存规则；参数与流式请求体均有边界", async t => {
  const f = fixture(t, null),
    clip = await create(f);
  assert.equal((await f.clips.list()).renderer_available, false);
  await assert.rejects(async () => await f.clips.refresh(clip.id), {
    status: 503
  });
  assert.equal(await f.clips.next_snapshot_at(), null);
  for (const body of [{
    url: "javascript:alert(1)"
  }, {
    title: ""
  }, {
    selector: ""
  }, {
    viewport_width: 1
  }, {
    wait_ms: 10001
  }]) {
    await assert.rejects(f.clips.create({
      ...input,
      ...body
    }), {
      status: 400
    });
  }
  await assert.rejects(read_clip_json(new Request("https://internal", {
    method: "POST",
    body: '{"large":"' + "x".repeat(200) + '"}'
  }), 100), {
    status: 413
  });
  await assert.rejects(read_clip_json(new Request("https://internal", {
    method: "POST",
    body: "[]"
  }), 100), {
    status: 400
  });
});
test("HTML 清理移除脚本、事件、外部资源及交互入口，保留内联样式和 SVG", () => {
  const html = sanitize_clip_html(`<div class="host" style="color:red"><script>alert(1)</script><style>@import 'https://evil';</style><iframe src="https://evil"></iframe><a href="javascript:evil()" onclick="evil()">text</a><img src="https://evil" onerror="evil()"><img src="data:image/png;base64,aA=="><div style="background:url(https://evil)"></div><svg><use href="#icon"/></svg><input autofocus></div>`);
  assert.doesNotMatch(html, /<script|<style|iframe|onclick|onerror|https:\/\/evil|javascript:|class=/i);
  assert.match(html, /color:red/);
  assert.match(html, /data:image\/png/);
  assert.match(html, /href="#icon"/);
  assert.match(html, /disabled/);
  assert.throws(() => sanitize_clip_html("<script>nothing()</script>"), /可显示/);
});
test("管理 API 要求认证，公开 iframe 经外层路由支持跨站 GET 与 HEAD", async t => {
  const f = fixture(t),
    clip = await create(f);
  await (await f.clips.refresh_task(clip.id)).promise;
  const env = {
    ADMIN_PASSWORD: "admin-fixture",
    APPLICATION: (() => ({
      fetch: request => route(request, {
        clips: f.clips
      })
    }))()
  };
  const worker = create_worker({
    api,
    admin: () => assert.fail("admin handler"),
    discovery: () => assert.fail("discovery handler")
  });
  assert.equal((await api.fetch(new Request("https://feeds.example/admin/api/clips"), env)).status, 401);
  const headers = {
    Authorization: "Bearer admin-fixture"
  };
  const list = await api.fetch(new Request("https://feeds.example/admin/api/clips", {
    headers
  }), env);
  assert.equal((await list.json()).clips[0].id, clip.id);
  const cross = await api.fetch(new Request("https://feeds.example/admin/api/clips", {
    method: "POST",
    headers: {
      ...headers,
      Origin: "https://other.example"
    },
    body: "{}"
  }), env);
  assert.equal(cross.status, 403);
  const public_get = await worker.fetch(new Request("https://feeds.example" + clip.path, {
    headers: {
      Origin: "https://other.example"
    }
  }), env);
  assert.equal(public_get.status, 200);
  assert.match(await public_get.text(), /晴/);
  assert.equal((await worker.fetch(new Request("https://feeds.example" + clip.path, {
    method: "POST"
  }), env)).status, 405);
  assert.equal((await worker.fetch(new Request("https://feeds.example/_admin/clips"), env)).status, 404);
});
