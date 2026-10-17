import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { snapshot_store } from "./support/snapshot_store.js";
import { RepositoryDiscoverySource } from "../server/repository/discovery_source.js";
import { RepositoryAccessToken } from "../server/repository/access_token.js";
import { RepositoryScript } from "../server/repository/script.js";
import { ServiceDiscovery } from "../server/service/durable_object/discovery.js";
import { ServiceAccessToken } from "../server/service/durable_object/access_tokens.js";
register("./support/quickjs_wasm_hook.js", import.meta.url);
const { ServiceScript } = await import("../server/service/durable_object/scripts.js");
const { default: worker } = await import("../api.js");
const { route } = await import("../durable_object_router.js");

test("管理源后端组合筛选公开性、状态、平台和社媒关键词，分页与总数一致", t => {
  const store = snapshot_store();
  t.after(() => store.db.close());
  for (let index = 0; index < 45; index++) store.sql.exec(
    "INSERT INTO discovery_sources(id,title,feed_url,category,source_type,enabled,require_token,social_url,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
    "s" + index, "源 " + index, "https://example.com/" + index, "technology", "website", index === 44 ? 0 : 1,
    index % 2, "https://x.com/unique-home", index, index);
  const service = new ServiceDiscovery({ repo: { discovery: new RepositoryDiscoverySource(store) } });
  const list = query => service.list_discovery_sources(new URL("https://admin/sources?" + query), true);
  const first = list("limit=10&offset=0&status=enabled&visibility=private&source_type=website&q=unique-home");
  assert.equal(first.total_count, 22);
  assert.equal(first.sources.length, 10);
  assert.ok(first.sources.every(row => row.require_token && row.enabled));
  const last = list("limit=10&offset=20&status=enabled&visibility=private");
  assert.equal(last.sources.length, 2);
  assert.equal(last.has_more, false);
  assert.equal(list("limit=20&visibility=public&status=disabled").sources[0].id, "s44");
  assert.equal(list("").sources.length, 45, "导出仍可读取全部源");
  assert.throws(() => list("visibility=invalid"), error => error.status === 400);
});

test("脚本后端搜索附加路由，类型与状态筛选后分页，仅检查当前页授权", async t => {
  const store = snapshot_store();
  t.after(() => store.db.close());
  const scripts = new RepositoryScript(store);
  for (let index = 0; index < 45; index++) scripts.insert({ route: "s" + index, title: "脚本", path: "/s" + index,
    script: "export const route={};", enabled: index === 44 ? 0 : 1, created_at: index, updated_at: index,
    metadata_json: JSON.stringify({ kind: "rss", status: index === 43 ? "draft" : "published", routes: [{ path: "/s" + index }, { path: "/extra/search" }] }) });
  const service = new ServiceScript({ repo: { scripts }, ports: {}, app: {} });
  let checked = 0;
  service.cookie_access = async () => { checked++; return null; };
  const result = await service.list_scripts(new URL("https://admin/scripts?limit=10&offset=40&kind=rss&status=enabled&q=extra/search"));
  assert.equal(result.total_count, 44);
  assert.equal(result.scripts.length, 4);
  assert.equal(checked, 4);
  assert.equal((await service.list_scripts(new URL("https://admin/scripts?limit=10&status=draft"))).total_count, 1);
});

test("Token 后端分页包括已过期项、排除撤销项，并透传 Worker 查询参数", async t => {
  const store = snapshot_store();
  t.after(() => store.db.close());
  for (let index = 0; index < 42; index++) store.sql.exec(
    "INSERT INTO access_tokens(id,user_id,name,token_hash,token_hint,created_at,expires_at,revoked_at) VALUES (?,?,?,?,?,?,?,?)",
    "t" + index, "u", "Token", "hash" + index, "hint", index, index === 0 ? 1 : null, index === 41 ? 1 : null);
  const service = new ServiceAccessToken({ repo: { access_tokens: new RepositoryAccessToken(store) }, storage: store.storage });
  const env = { ADMIN_PASSWORD: "admin-test", API: { getByName: () => ({ fetch: request => route(request, { access_tokens: service }) }) } };
  const response = await worker.fetch(new Request("https://feeds.example/admin/api/access-tokens?limit=20&offset=40", {
    headers: { Authorization: "Bearer admin-test" },
  }), env);
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.total_count, 41);
  assert.equal(result.access_tokens.length, 1);
  assert.equal(result.access_tokens[0].id, "t0");
  assert.equal(result.access_tokens[0].status, "expired");
  assert.equal("token_hash" in result.access_tokens[0], false);
  assert.equal(service.list_access_tokens().access_tokens.length, 41);
});
