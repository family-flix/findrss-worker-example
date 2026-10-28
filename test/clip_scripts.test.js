import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";
import { snapshot_store } from "./support/snapshot_store.js";
import { read_script } from "./support/script_sources.js";
import { RepositoryScript } from "../server/repository/script.js";
import { RepositoryScriptRelease } from "../server/repository/script_release.js";
import { RepositoryRssCookieGrant } from "../server/repository/rss_cookie_grant.js";
import { RepositoryClip } from "../server/repository/clip.js";
import { RepositoryPlatform } from "../server/repository/platform.js";
import { RepositoryBackgroundTasks } from "../server/repository/background_tasks.js";
import { ServiceClip } from "../server/service/durable_object/clips.js";
import { ServiceBackgroundTasks } from "../server/service/durable_object/background_tasks.js";
import { ClipModel } from "../server/domain/clip.js";
import { RssRouteCache } from "../server/infra/rss_cache.js";
import { normalize_clip_snapshot } from "../server/infra/clip_html.js";
import { create_worker } from "../router.js";
import api from "../api.js";

register("./support/quickjs_wasm_hook.js", import.meta.url);
const { compile_script_module, execute_script } = await import("../server/infra/script_sandbox.js");
const { ServiceScript } = await import("../server/service/durable_object/scripts.js");
const { migrate_clip_scripts } = await import("../server/service/durable_object/default_data.js");
const { route } = await import("../durable_object_router.js");
const edit = body => new Request("https://internal/_admin/scripts", { method: "POST", body: JSON.stringify(body) });
const source = (title = "正文", extra = "") => `export const kind = "clip";
export const version = "1.0.0";
export const platform = { name: "测试平台", icon: "" };
${extra}
class Article extends ClipScript { async fetch(ctx) {
  return Result.Ok({ title: ${JSON.stringify(title)}, link: "https://example.com/" + ctx.params.id,
    html: '<article style="color:red" data-n="article">' + ctx.params.id + '<script>bad()</script></article>', stats: { width: 320 } });
} }
const script = new Article();
export const route = { path: "/clip-test/:id", name: "正文剪藏", example: "/clip-test/123", public: true, handler: ctx => script.run(ctx) };`;

function fixture(t, navigate = null) {
  const store = snapshot_store(), values = new Map();
  t.after(() => store.db.close());
  const storage = { ...store.storage, get: async key => values.get(key), put: async (key, value) => values.set(key, value) };
  const repo = { scripts: new RepositoryScript(store), script_releases: new RepositoryScriptRelease(store),
    rss_cookie_grants: new RepositoryRssCookieGrant(store), rss_cookies: { get: () => [] },
    clips: new RepositoryClip(store), platforms: new RepositoryPlatform(store), rss_route_cache: store.repo,
    script_logs: { delete_for_route() {} }, discovery: { list_public_routes: () => [], list_private_routes: () => [] } };
  const app = {};
  const service = new ServiceScript({ repo, app, ports: { object_store: store.object_store,
    transaction: callback => storage.transactionSync(callback), route_cache: new RssRouteCache(60000, 100), puppeteer_navigate: navigate } });
  service.record_log = () => {};
  service.rss_address_is_public = () => false;
  app.scripts = service;
  app.background_tasks = new ServiceBackgroundTasks({ repo: new RepositoryBackgroundTasks(store), wait_until: promise => promise.catch(() => {}) });
  app.clips = new ServiceClip({ repo: repo.clips, storage, object_store: store.object_store, background_tasks: app.background_tasks,
    load_snapshot: (record, signal) => service.execute_clip_snapshot(record, signal),
    validate_script: record => service.clip_source(record), script_routes: () => service.clip_routes() });
  const worker = create_worker({ api, admin: {}, discovery: {} });
  const env = { API: { getByName: () => ({ fetch: request => route(request, app) }) } };
  return { ...store, repo, storage, service, app, values,
    create: async script => (await service.create_script(edit({ script, status: "published", version: "1.0.0" }))).data.script,
    fetch: (path, method = "GET") => worker.fetch(new Request("https://feeds.example" + path, { method }), env) };
}

test("Clip 脚本必须声明版本", async () => {
  assert.match((await compile_script_module(source().replace('export const version = "1.0.0";', ''))).error, /version/);
});

test("剪藏输出清理 HTML，拒绝错误来源、空内容和非法统计，直接 handler 也必须符合契约", async () => {
  const valid = { kind: "clip", title: "标题", link: "https://example.com/", html: '<div onclick="bad()">安全<script>bad()</script></div>' };
  assert.doesNotMatch(normalize_clip_snapshot(valid).html, /onclick|script/);
  for (const patch of [{ kind: "rss" }, { title: "" }, { link: "javascript:bad()" }, { link: "https://user:pass@example.com/" },
    { html: "<script>bad()</script>" }, { html: "x".repeat(8 * 1024 * 1024 + 1) }, { stats: [] }, { stats: { width: -1 } }]) {
    assert.throws(() => normalize_clip_snapshot({ ...valid, ...patch }));
  }
  const script = `export const kind='clip'; export const version='1.0.0'; export const platform={name:'网页'};
    export const route={path:'/invalid-clip',name:'无效剪藏',handler:()=>({kind:'rss',items:[]})};`;
  const compiled = await compile_script_module(script);
  assert.equal(compiled.error, "");
  await assert.rejects(execute_script(script, compiled.metadata), /kind=clip/);
});

test("Clip 发布到 R2、类型列表、草稿 Debug、API GET/HEAD、类型与缓存隔离", async t => {
  const f = fixture(t), script = await f.create(source());
  assert.equal(script.kind, "clip");
  assert.equal(f.repo.scripts.find(script.id).script, "");
  assert.equal((await f.service.list_scripts(new URL("https://internal/scripts?kind=clip"))).scripts.length, 1);
  const response = await f.fetch("/api/clip/clip-test/abc");
  assert.equal(response.status, 200);
  const value = await response.json(); assert.equal(value.title, "正文"); assert.match(value.html, /abc/); assert.doesNotMatch(value.html, /script/);
  assert.equal((await f.fetch("/api/hot/clip-test/abc")).status, 404);
  assert.equal((await f.fetch("/rss/clip-test/abc")).status, 404);
  assert.equal((await f.fetch("/api/clip/clip-test/abc", "POST")).status, 405);
  assert.equal(await (await f.fetch("/api/clip/clip-test/abc", "HEAD")).text(), "");
  const debug = await f.service.debug_script(edit({ script: source("草稿"), version: "1.0.0", request_url: "/api/clip/clip-test/456" }));
  assert.equal(debug.ok, true); assert.equal(JSON.parse(debug.rss_debug.output).title, "草稿");
  assert.equal((await (await f.fetch("/api/clip/clip-test/abc")).json()).title, "正文");
});

test("剪藏记录绑定脚本路由，更新正式版复用固定链接，停用及路由变化保留旧快照", async t => {
  const f = fixture(t), script = await f.create(source());
  const created = await f.app.clips.create({ title: "记录", script_id: script.id, script_url: "/api/clip/clip-test/123", enabled: false });
  const record = created.data.clip;
  assert.equal(record.script_url, "/clip-test/123");
  assert.equal(f.app.clips.list().scripts[0].id, script.id);
  await f.app.clips.refresh_task(record.id).promise;
  const previous = f.repo.clips.find(record.id);
  assert.equal(previous.url, "https://example.com/123");
  await f.app.clips.update(record.id, { title: "改名" });
  assert.equal(f.repo.clips.find(record.id).url, previous.url);
  await assert.rejects(f.app.clips.create({ title: "错误路由", script_id: script.id, script_url: "/other/123", enabled: false }), /路由与所选脚本不匹配/);
  await f.service.update_script(edit({ script: "// 未完成的工作副本", status: "draft", version: "2.0.0" }), script.id);
  assert.equal((await f.service.execute_clip_snapshot(record)).title, "正文");
  await f.service.update_script(edit({ script: source("新版").replace('version = "1.0.0"', 'version = "1.0.1"'), status: "published", version: "1.0.1" }), script.id);
  await f.app.clips.refresh_task(record.id).promise;
  assert.equal((await f.service.execute_clip_snapshot(record)).title, "新版");
  assert.equal(f.app.clips.find(record.id).id, record.id);
  f.repo.scripts.update({ ...f.repo.scripts.find(script.id), enabled: 0 }); f.service.invalidate_routes();
  await assert.rejects(f.app.clips.refresh_task(record.id).promise, /已停用/);
  assert.match(await f.app.clips.document(record.id), /123/);
  await assert.rejects(f.app.clips.create({ title: "错误", script_id: script.id, script_url: "/other/123" }), /已停用/);
  const saved = f.repo.clips.find(record.id);
  assert.ok(saved.saved_at >= previous.saved_at);
});

test("多路由 Clip 记录选择对应入口，路径参数和查询参数独立传入", async t => {
  const f = fixture(t);
  const script = await f.create(source().replace("ctx.params.id + '<script>", "ctx.params.id + ':' + ctx.query.period + '<script>")
    .replace("export const route =", "const main_route =") + `
export const routes = [main_route, { ...main_route, path: '/clip-second/:id', example: '/clip-second/abc?period=week' }];`);
  const record = (await f.app.clips.create({ title: "第二入口", script_id: script.id, script_url: "/clip-second/abc?period=week", enabled: false })).data.clip;
  await f.app.clips.refresh_task(record.id).promise;
  assert.match(await f.app.clips.document(record.id), /abc:week/);
});

test("R2 写入期间停用脚本或撤销授权，不发布迟到的快照", async t => {
  for (const mode of ["disable", "revoke"]) {
    const f = fixture(t), script = await f.create(source());
    let revoked = false;
    f.service.cookie_access = async () => ({ records: [], assert_grant() { if (revoked) throw new Error("Cookie 授权已撤销"); } });
    const record = (await f.app.clips.create({ title: "记录", script_id: script.id, script_url: "/clip-test/123", enabled: false })).data.clip;
    await f.app.clips.refresh_task(record.id).promise;
    const before = f.repo.clips.find(record.id);
    const original = f.object_store.put.bind(f.object_store);
    f.object_store.put = async (...args) => {
      await original(...args);
      if (mode === "disable") { f.repo.scripts.update({ ...f.repo.scripts.find(script.id), enabled: 0 }); f.service.invalidate_routes(); }
      else revoked = true;
    };
    await assert.rejects(f.app.clips.refresh_task(record.id).promise, /已停用|授权已撤销/);
    assert.equal(f.repo.clips.find(record.id).object_key, before.object_key);
    assert.equal((await f.object_store.list({ prefix: "clips/" })).objects.length, 1);
  }
});

test("旧记录迁移到通用 Clip 脚本，保留公开链接和快照，迁移完成后不重建已删除脚本", async t => {
  const f = fixture(t);
  f.db.prepare(`INSERT INTO clips(id,title,url,selector,config_version,html,saved_at,created_at) VALUES(?,?,?,?,?,?,?,?)`)
    .run("old", "天气", "https://example.com/", "#weather", "old", "<div>旧快照</div>", 123, 1);
  await migrate_clip_scripts({ repo: f.repo, storage: f.storage, script: read_script("clip/website.js") });
  const row = f.repo.clips.find("old");
  assert.equal(row.script_id, ClipModel.WEBSITE_SCRIPT_ID); assert.equal(row.html, "<div>旧快照</div>");
  assert.equal(row.saved_at, 123); assert.equal(ClipModel(row).path, "/clips/old");
  const url = new URL(row.script_url, "https://clip.invalid");
  assert.equal(url.searchParams.get("selector"), "#weather");
  assert.equal(f.service.clip_routes()[0].id, row.script_id);
  f.repo.scripts.delete(row.script_id);
  await migrate_clip_scripts({ repo: f.repo, storage: f.storage, script: read_script("clip/website.js") });
  assert.equal(f.repo.scripts.count(), 0);
});
