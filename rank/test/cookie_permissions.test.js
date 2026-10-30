import { read_script } from "../../test/support/script_sources.js";
import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { LITE_ESM, timeless_plugin } from "../../scripts/timeless_plugin.js";
import { create_rank_loader } from "../loader.js";
import { publish_rank_snapshots, rank_snapshot_key } from "../snapshot.js";
import { snapshot_store } from "../../test/support/snapshot_store.js";
import { RepositoryScript } from "../../server/repository/script.js";
import { RepositoryScriptRelease } from "../../server/repository/script_release.js";
import { RepositoryRssCookieGrant } from "../../server/repository/rss_cookie_grant.js";
import { RssRouteCache } from "../../server/infra/rss_cache.js";
import { ScriptSourceStore } from "../../server/infra/script_source_store.js";
register("../../test/support/quickjs_wasm_hook.js", import.meta.url);
const {
  compile_script_module,
  execute_script
} = await import("../../server/infra/script_sandbox.js");
const {
  ServiceScript
} = await import("../../server/service/application/scripts.js");
const bundle = await build({
  stdin: {
    contents: 'export * from "./rank/home.js";',
    resolveDir: fileURLToPath(new URL("../../", import.meta.url)),
    loader: "js"
  },
  bundle: true,
  write: false,
  format: "esm",
  platform: "neutral",
  mainFields: ["main"],
  loader: {
    ".html": "text",
    ".css": "text"
  },
  plugins: [timeless_plugin({
    platform: LITE_ESM,
    ssr: true
  })]
});
const {
  publish_rank_home,
  read_rank_home
} = await import("data:text/javascript;base64," + Buffer.from(bundle.outputFiles[0].text).toString("base64"));
const source = read_script("hot/douyin_hot.js");
const installed_source = source.replace("title: source.name,", 'title: "后台已授权抖音",');
const edit = body => new Request("https://internal/_admin/scripts", {
  method: "POST",
  body: JSON.stringify(body)
});
const upstream = title => Response.json({
  data: {
    word_list: [{
      sentence_id: "123",
      word: title,
      position: 1,
      hot_value: 12345
    }]
  }
});
async function fixture(t) {
  const store = snapshot_store();
  t.after(() => store.db.close());
  const repo = {
    scripts: new RepositoryScript(store),
    script_releases: new RepositoryScriptRelease(store),
    rss_cookie_grants: new RepositoryRssCookieGrant(store),
    rss_route_cache: store.repo,
    discovery: {
      list_public_routes: () => [],
      list_private_routes: () => []
    },
    rss_cookies: {
      get: () => [{
        name: "sessionid",
        value: "private-session",
        domain: ".douyin.com",
        path: "/",
        secure: true
      }, {
        name: "OTHER",
        value: "unrelated-secret",
        domain: ".douyin.com",
        path: "/",
        secure: true
      }]
    }
  };
  const service = new ServiceScript({
    repo,
    ports: {
      object_store: store.object_store,
      transaction: fn => store.storage.transactionSync(fn),
      route_cache: new RssRouteCache(60000, 100)
    },
    app: {}
  });
  service.record_log = () => {};
  const draft = (await service.create_script(edit({
    script: installed_source,
    status: "draft"
  }))).data.script;
  const load = create_rank_loader([{
    id: "douyin_hot",
    source
  }], {
    compile: compile_script_module,
    execute: execute_script,
    execute_hot: (context, signal) => service.execute_hot_snapshot(context, signal)
  });
  const env = {
    API_STORAGE: store.bucket
  };
  const refresh = async () => {
    const result = await publish_rank_snapshots(load, env);
    await publish_rank_home(result, env);
    return result.boards[0];
  };
  const publish = async () => {
    let challenge;
    await assert.rejects(service.update_script(edit({
      status: "published",
      version: "1.0.0"
    }), draft.id), error => {
      challenge = error.details.cookie_permissions;
      return error.status === 409;
    });
    const grant = await service.approve_cookie_grant(edit({
      ...challenge,
      script: installed_source,
      confirmed: true
    }));
    await service.update_script(edit({
      status: "published",
      version: "1.0.0",
      cookie_grant_id: grant.cookie_grant_id
    }), draft.id);
    return grant;
  };
  return {
    ...store,
    repo,
    service,
    env,
    refresh,
    publish,
    id: draft.id
  };
}
test("抖音 rank 用 R2 正式版本的授权生成 JSON 和 HTML，不读取未授权草稿或复用旧错误页", async t => {
  const f = await fixture(t);
  const fetch = t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.match(url, /^https:\/\/www\.douyin\.com\/aweme\/v1\/web\/hot\/search\/list\//);
    assert.equal(options.headers.Cookie, "sessionid=private-session");
    return upstream("授权后热榜内容");
  });
  const anonymous = await f.refresh();
  assert.match(anonymous.error, /Cookie.*管理员确认/);
  assert.equal(fetch.mock.callCount(), 0);
  const previous = await read_rank_home(f.env);
  await f.publish();
  await f.service.update_script(edit({
    script: '// 未完成的新草稿\nthrow new Error("禁止执行草稿");',
    status: "draft",
    version: "1.0.1"
  }), f.id);
  assert.equal((await f.repo.scripts.find(f.id)).script, "");
  f.service.source_store = new ScriptSourceStore(f.object_store);
  const board = await f.refresh();
  assert.equal(board.error, "");
  assert.equal(board.title, "后台已授权抖音");
  assert.equal(board.entries[0].title, "授权后热榜内容");
  const json = await (await f.bucket.get(rank_snapshot_key("douyin_hot"))).text();
  assert.deepEqual(JSON.parse(json), board);
  const page = await read_rank_home(f.env);
  assert.notEqual(page.version, previous.version);
  assert.match(page.html, /授权后热榜内容/);
  assert.doesNotMatch(page.html + json, /private-session|unrelated-secret|Cookie 权限尚未获得管理员确认|禁止执行草稿/);
  assert.equal(fetch.mock.callCount(), 1);
  await f.refresh();
  assert.equal(fetch.mock.callCount(), 2, "每轮快照必须重新采集已发布脚本");
  await f.service.revoke_cookie_grant(f.id);
  const revoked = await f.refresh();
  assert.match(revoked.error, /管理员确认 Cookie 权限/);
  assert.deepEqual(revoked.entries, []);
  assert.equal(fetch.mock.callCount(), 2);
  assert.doesNotMatch((await read_rank_home(f.env)).html, /授权后热榜内容/);
});
test("抖音采集中撤销授权后，结果不进入 rank JSON 或 HTML", {
  timeout: 5000
}, async t => {
  const f = await fixture(t);
  await f.publish();
  const entered = Promise.withResolvers(),
    release = Promise.withResolvers();
  t.mock.method(globalThis, "fetch", async () => {
    entered.resolve();
    await release.promise;
    return upstream("撤销后不得发布");
  });
  const task = f.refresh();
  await entered.promise;
  await f.service.revoke_cookie_grant(f.id);
  release.resolve();
  const board = await task;
  assert.ok(board.error);
  assert.deepEqual(board.entries, []);
  const json = await (await f.bucket.get(rank_snapshot_key("douyin_hot"))).text();
  assert.doesNotMatch(json + (await read_rank_home(f.env)).html, /撤销后不得发布|private-session/);
});
test("rank 不使用 RSS、停用或草稿 Hot 的授权，无匹配时保留匿名回退", async t => {
  const f = await fixture(t);
  const context = {
    pathname: "/douyin/hot",
    query: {}
  };
  assert.equal(await f.service.execute_hot_snapshot(context), null);
  await f.publish();
  await f.service.update_script(edit({
    enabled: false
  }), f.id);
  assert.equal(await f.service.execute_hot_snapshot(context), null);
  const row = await f.repo.scripts.find(f.id);
  const metadata = JSON.parse(row.metadata_json);
  metadata.kind = "rss";
  await f.repo.scripts.update({
    ...row,
    enabled: 1,
    metadata_json: JSON.stringify(metadata)
  });
  await f.service.invalidate_routes();
  assert.equal(await f.service.execute_hot_snapshot(context), null);
});
