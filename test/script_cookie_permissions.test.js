import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";
import { ScriptCookiePermissionsModel } from "../server/domain/script_cookie_permissions.js";
import { ScriptCookieAccess } from "../server/infra/script_cookie_access.js";
import { RssRouteCache } from "../server/infra/rss_cache.js";
import { ServiceDiscovery } from "../server/service/durable_object/discovery.js";
import worker_router from "../api.js";

register("./support/quickjs_wasm_hook.js", import.meta.url);
const { compile_script_module, execute_script } = await import("../server/infra/script_sandbox.js");
const { ServiceScript } = await import("../server/service/durable_object/scripts.js");
const { route } = await import("../durable_object_router.js");
const permissions = { cookies: [{ id: "session", origin: "https://example.com", path_prefix: "/ajax/", names: ["SUB", "XSRF-TOKEN"], purpose: "读取登录后内容" }] };
const cookies = [
  { name: "SUB", value: "private-session", domain: "example.com", path: "/", secure: true },
  { name: "XSRF-TOKEN", value: "private-csrf", domain: "example.com", path: "/", secure: true },
  { name: "OTHER", value: "never-send", domain: "example.com", path: "/" },
  { name: "SUB", value: "expired", domain: "example.com", expirationDate: 1 },
];
const script = `export const permissions = ${JSON.stringify(permissions)};
export const route = { path: "/cookie-test", name: "Cookie测试", handler: async ctx => {
  const acquired = await ctx.cookies.get("session");
  if (acquired.error) return acquired;
  const jar = acquired.data;
  ctx.log("Cookie名称", jar.names);
  const fetched = await ctx.fetchText("https://example.com/ajax/items?secret=query", { cookies: jar, cookie_headers: { "x-xsrf-token": "XSRF-TOKEN" } });
  if (fetched.error) return fetched;
  return Result.Ok({ title: "测试", items: [] });
}};`;
const edit = body => new Request("https://internal/_admin/scripts", { method: "POST", body: JSON.stringify(body) });

test("权限明确列出名称、HTTPS origin 和规范路径；句柄不含值，不能伪造或越界", () => {
  const model = ScriptCookiePermissionsModel(permissions);
  for (const patch of [{ names: ["*"] }, { names: [] }, { origin: "http://example.com" }, { origin: "https://example.com/path" }, { path_prefix: "//other.com" }, { path_prefix: "/ajax/../" }, { purpose: "" }]) {
    assert.throws(() => ScriptCookiePermissionsModel({ cookies: [{ ...permissions.cookies[0], ...patch }] }));
  }
  let valid = true;
  const access = new ScriptCookieAccess({ permissions: model.toValue(), cookies: () => cookies, assert_grant: () => assert.ok(valid, "revoked") });
  const jar = access.get("session");
  assert.deepEqual(Object.keys(jar).sort(), ["id", "names"]);
  assert.throws(() => access.get("unknown"));
  assert.throws(() => access.header({ id: "forged" }, new URL("https://example.com/ajax/items")));
  for (const target of ["https://other.com/ajax/items", "https://example.com/private", "https://example.com/ajax/%2f..%2fprivate", "http://example.com/ajax/items"]) assert.throws(() => access.header(jar, new URL(target)));
  assert.throws(() => access.header(jar, new URL("https://example.com/ajax/items"), { "x-xsrf-token": "OTHER" }));
  assert.equal(access.header(jar, new URL("https://example.com/ajax/items")), "SUB=private-session; XSRF-TOKEN=private-csrf");
  assert.ok(!JSON.stringify(access.records).includes("private-session"));
  valid = false;
  assert.throws(() => access.header(jar, new URL("https://example.com/ajax/items")), /revoked/);
});

test("沙箱默认匿名；显式授权按名称发送，跨 origin 后不恢复，日志不含值", async () => {
  const compiled = await compile_script_module(script);
  assert.equal(compiled.error, "");
  assert.deepEqual(compiled.metadata.permissions, ScriptCookiePermissionsModel(permissions).toValue());
  const original_fetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, headers: options.headers });
    if (url.includes("/ajax/items")) return new Response(null, { status: 302, headers: { Location: "https://other.com/redirect" } });
    if (url.includes("other.com")) return new Response(null, { status: 302, headers: { Location: "https://example.com/ajax/back" } });
    return new Response("ok");
  };
  try {
    const anonymous = script.replace('const acquired = await ctx.cookies.get("session");\n  if (acquired.error) return acquired;\n  const jar = acquired.data;', 'const jar = undefined;').replace('ctx.log("Cookie名称", jar.names);', '').replace(', cookie_headers: { "x-xsrf-token": "XSRF-TOKEN" }', '');
    await execute_script(anonymous, { ...compiled.metadata, debug: true }, null, undefined, cookies);
    assert.ok(calls.every(call => !call.headers.Cookie));
    calls.length = 0;
    const access = new ScriptCookieAccess({ permissions, cookies: () => cookies, assert_grant: () => {} });
    const result = await execute_script(script, { ...compiled.metadata, debug: true }, null, undefined, [], "", access);
    assert.equal(calls[0].headers.Cookie, "SUB=private-session; XSRF-TOKEN=private-csrf");
    assert.equal(calls[0].headers["x-xsrf-token"], "private-csrf");
    assert.ok(calls.slice(1).every(call => !call.headers.Cookie && !call.headers["x-xsrf-token"]));
    assert.ok(!JSON.stringify(result).includes("private-session"));
    assert.ok(!JSON.stringify(result).includes("private-csrf"));
    assert.ok(!JSON.stringify(result.cookie_accesses).includes("secret=query"));
    await assert.rejects(execute_script(script, compiled.metadata), /Cookie 权限/);
    const inline = script.replace('{ cookies: jar, cookie_headers: { "x-xsrf-token": "XSRF-TOKEN" } }', '{ headers: { Cookie: "manual-secret" } }');
    await assert.rejects(execute_script(inline, compiled.metadata, null, undefined, [], "", access), /禁止直接填写/);
  } finally { globalThis.fetch = original_fetch; }
});

test("管理员确认精确源码版本；发布及缓存命中均验证授权，撤销后保留 XML 但阻止访问", async () => {
  const rows = [], grants = new Map(), cache = new RssRouteCache(60000, 100);
  let public_sources = [];
  const repo = {
    discovery: { list_public_routes: () => public_sources },
    scripts: { list: () => rows, list_enabled: () => rows.filter(row => row.path && row.enabled), count: () => rows.length,
      exists: id => rows.some(row => row.route === id), find: id => rows.find(row => row.route === id), find_config: id => rows.find(row => row.route === id),
      insert: row => rows.push(row), update: value => Object.assign(rows.find(row => row.route === value.route), value) },
    rss_cookie_grants: { find: id => grants.get(id), insert: value => grants.set(value.id, value), bind: (id, script_id) => { if (grants.get(id)?.script_id === "") grants.get(id).script_id = script_id; }, revoke: script_id => { for (const [id, grant] of grants) if (grant.script_id === script_id) grants.delete(id); } },
    rss_cookies: { get: () => cookies },
  };
  const service = new ServiceScript({ repo, ports: { route_cache: cache }, app: {} });
  service.record_log = () => {};
  service.rss_address_is_public = () => false;
  const drafted = await service.create_script(edit({ script, status: "draft" }));
  const id = drafted.data.script.id;
  let info;
  await assert.rejects(service.update_script(edit({ status: "published", version: "1.0.0" }), id), error => { info = error.details.cookie_permissions; return error.status === 409 && !!info; });
  await assert.rejects(service.approve_cookie_grant(edit({ ...info, script: script + "\n", confirmed: true })), error => error.status === 409);
  await assert.rejects(service.approve_cookie_grant(edit({ ...info, visibility: { ...info.visibility, routes: [] }, script, confirmed: true })), error => error.status === 409);
  assert.equal(info.version, "1.0.0");
  assert.equal(info.visibility.public_sources, undefined);
  let approved = await service.approve_cookie_grant(edit({ ...info, visibility: { ...info.visibility, public_sources: ["/cookie-test"] }, script, confirmed: true }));
  assert.equal(JSON.parse(grants.get(approved.cookie_grant_id).permissions_json).visibility.public_sources, undefined);
  await service.update_script(edit({ status: "published", version: "1.0.0", cookie_grant_id: approved.cookie_grant_id }), id);
  await assert.rejects(service.cookie_access(script, { ...JSON.parse(rows[0].metadata_json) }, "other-script", approved.cookie_grant_id), error => error.status === 409);
  let next_info;
  await assert.rejects(service.update_script(edit({ status: "published", version: "1.0.1", cookie_grant_id: approved.cookie_grant_id }), id), error => {
    next_info = error.details.cookie_permissions;
    return error.status === 409 && next_info?.version === "1.0.1";
  });
  assert.equal(next_info.script_hash, info.script_hash, "同一源码升级版本也需要重新确认");
  const next_grant = await service.approve_cookie_grant(edit({ ...next_info, script, confirmed: true }));
  assert.equal(JSON.parse(rows[0].metadata_json).cookie_grant_id, approved.cookie_grant_id, "新版授权不会提前替换在线版本授权");
  await service.cookie_access(script, JSON.parse(rows[0].metadata_json), id, approved.cookie_grant_id);
  await service.update_script(edit({ status: "published", version: "1.0.1", cookie_grant_id: next_grant.cookie_grant_id }), id);
  await assert.rejects(service.cookie_access(script, JSON.parse(rows[0].metadata_json), id, approved.cookie_grant_id), error => error.status === 409);
  approved = next_grant;
  const draft_source = script + "\n// 尚未发布的新代码";
  const with_draft = (await service.update_script(edit({ script: draft_source, status: "draft", version: "1.0.2",
    cookie_grant_id: "unapproved-draft-grant" }), id)).script;
  assert.equal(with_draft.cookie_grant_id, approved.cookie_grant_id);
  assert.equal(with_draft.draft.cookie_grant_id, "unapproved-draft-grant");
  assert.equal(with_draft.script, script);
  assert.equal((await service.check_cookie_permissions(id)).cookie_authorization.status, "active");
  // 升级前保存的授权可能仍包含旧公开源列表；无需迁移或重新确认。
  const grant = grants.get(approved.cookie_grant_id);
  const legacy_permissions = JSON.parse(grant.permissions_json);
  legacy_permissions.visibility.public_sources = ["/cookie-test/old"];
  grant.permissions_json = JSON.stringify(legacy_permissions);
  const metadata = JSON.parse(rows[0].metadata_json);
  await assert.rejects(service.cookie_access(script, { ...metadata,
    permissions: { cookies: [{ ...permissions.cookies[0], names: ["OTHER"] }] } }, id, approved.cookie_grant_id), error => error.status === 409);
  await assert.rejects(service.cookie_access(script, { ...metadata,
    routes: metadata.routes.map(entry => ({ ...entry, public: true })) }, id, approved.cookie_grant_id), error => error.status === 409);
  const original_fetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("ok");
  const serve = () => route(new Request("https://internal/_public/feed/rss/cookie-test", {
    headers: { "X-Api-Access-Token-ID": "test-user" },
  }), { scripts: service });
  const generate = () => service.serve_rss_route("rss", "/cookie-test",
    new Request("https://internal/_admin/feed/rss/cookie-test"), { refresh: true });
  try {
    assert.equal((await serve()).status, 503);
    await generate();
    assert.equal((await serve()).status, 200);
    assert.equal(cache.stats().entries, 1);
    assert.equal((await serve()).headers.get("X-Api-RSS-Cache"), "hit");
    assert.equal((await service.list_scripts()).scripts[0].cookie_authorization.status, "active");
    public_sources = [{ id: "source", feed_url: "{{hostname}}/rss/cookie-test", enabled: 1, require_token: 0 }];
    const listed = (await service.list_scripts()).scripts[0];
    assert.equal(listed.cookie_grant_id, approved.cookie_grant_id);
    assert.equal(listed.cookie_authorization.status, "active", "新增公开源不影响已有 Cookie 授权");
    assert.equal((await serve()).status, 200);
    let snapshot = {};
    Object.assign(repo.discovery, {
      find: id => public_sources.find(source => source.id === id), snapshot_attempt() {}, snapshot_get: () => snapshot,
      snapshot_save(_id, _url, articles, saved_at, error = "") { snapshot = { saved_at, error, articles_json: JSON.stringify(articles) }; },
    });
    const discovery = new ServiceDiscovery({ repo, load_snapshot: async () => {
      await generate(); return [{ title: "示例文章" }];
    } });
    const challenge = await route(new Request("https://internal/_admin/scripts/" + id + "/cookie-permissions", { method: "POST" }), { scripts: service });
    assert.equal(challenge.status, 200);
    assert.equal((await challenge.json()).cookie_authorization.status, "active");
    assert.equal((await service.list_scripts()).scripts[0].cookie_authorization.status, "active");
    assert.equal((await service.check_cookie_permissions(id)).cookie_authorization.status, "active");
    const refreshed_snapshot = await discovery.refresh_discovery_snapshot("source");
    assert.equal(refreshed_snapshot.snapshot.error, "");
    assert.ok(refreshed_snapshot.snapshot.saved_at > 0);
    assert.equal(refreshed_snapshot.snapshot.articles[0].title, "示例文章");
    public_sources = [];
    assert.equal((await service.check_cookie_permissions(id)).cookie_authorization.status, "active", "删除或改为私密也不影响授权");
    assert.equal(JSON.parse(rows[0].metadata_json).cookie_grant_id, approved.cookie_grant_id);
    grants.delete(approved.cookie_grant_id);
    assert.equal((await serve()).status, 409); // 即便已有缓存也不能绕过撤销。
    await service.revoke_cookie_grant(id);
    assert.equal(cache.stats().entries, 1);
    assert.equal((await serve()).status, 409);
    await assert.rejects(service.update_script(edit({ script: script + "\n", status: "published", version: "1.0.2" }), id), error => error.status === 409);
  } finally { globalThis.fetch = original_fetch; }
});

test("已保存脚本权限检查仅管理员可调用，外层转发脚本 ID 且不执行脚本", async () => {
  const calls = [];
  const env = { ADMIN_PASSWORD: "admin-test", API: { getByName: () => ({ fetch: async request => {
    calls.push({ url: request.url, method: request.method });
    return Response.json({ cookie_authorization: { status: "active", message: "" } });
  } }) } };
  const request = authorization => new Request("https://feeds.example/admin/api/scripts/module-1/cookie-permissions", {
    method: "POST", headers: authorization ? { Authorization: authorization } : {},
  });
  assert.equal((await worker_router.fetch(request(""), env)).status, 401);
  assert.deepEqual(calls, []);
  assert.equal((await worker_router.fetch(request("Bearer admin-test"), env)).status, 200);
  assert.deepEqual(calls, [{ url: "https://internal/_admin/scripts/module-1/cookie-permissions", method: "POST" }]);
});

test("未保存授权 15 分钟过期；Cookie 值轮换无需重新授权，撤销进行中的请求阻止结果返回", async () => {
  const grants = new Map();
  const service = new ServiceScript({ repo: { rss_cookie_grants: { find: id => grants.get(id), insert: value => grants.set(value.id, value) },
    rss_cookies: { get: () => cookies } }, ports: { route_cache: { invalidate_all() {} } }, app: {} });
  const compiled = await compile_script_module(script);
  let info;
  await assert.rejects(service.cookie_access(script, compiled.metadata, "", "", true), error => { info = error.details.cookie_permissions; return error.status === 409; });
  const grant = await service.approve_cookie_grant(edit({ ...info, script, confirmed: true }));
  const access = await service.cookie_access(script, compiled.metadata, "", grant.cookie_grant_id);
  const original_fetch = globalThis.fetch;
  globalThis.fetch = async () => { grants.delete(grant.cookie_grant_id); return new Response("ok"); };
  try { await assert.rejects(execute_script(script, compiled.metadata, null, undefined, [], "", access), error => error.status === 409); }
  finally { globalThis.fetch = original_fetch; }
  const renewed = await service.approve_cookie_grant(edit({ ...info, script, confirmed: true }));
  service.repo.rss_cookies.get = () => cookies.map(cookie => ({ ...cookie, value: "rotated" }));
  const current = await service.cookie_access(script, compiled.metadata, "", renewed.cookie_grant_id);
  assert.match(current.header(current.get("session"), new URL("https://example.com/ajax/items")), /SUB=rotated/);
  grants.get(renewed.cookie_grant_id).created_at -= 900001;
  await assert.rejects(service.cookie_access(script, compiled.metadata, "", renewed.cookie_grant_id), error => error.status === 409);
});
