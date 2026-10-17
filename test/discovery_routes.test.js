import assert from "node:assert/strict";
import test from "node:test";
import { ServiceDiscovery } from "../server/service/durable_object/discovery.js";

function fixture() {
  const rows = new Map([["old", { id: "old", title: "旧源", feed_url: "https://example.com/feed.xml", enabled: 1 }]]);
  const scripts = [
    { path: "/rank/:id", metadata_json: '{"kind":"hot"}' },
    { path: "/news/:id", enabled: 0, metadata_json: JSON.stringify({ kind: "rss", routes: [
      { path: "/news/:id" }, { path: "/posts/:id{[0-9]+}" },
    ] }) },
    { path: "/legacy/:id", script: "/** RSS */ class Legacy extends RSSScript {}" },
  ];
  const repo = { scripts: { list: () => scripts }, discovery: {
    count: () => rows.size,
    feed_url_taken: () => false,
    feed_url_taken_by_other: () => false,
    insert: row => rows.set(row.id, row),
    update: row => rows.set(row.id, { ...rows.get(row.id), ...row }),
    find: id => rows.get(id),
    snapshot_delete() {},
    snapshot_get: () => undefined,
  } };
  return { service: new ServiceDiscovery({ repo }), rows };
}

const request = (body, method = "POST") => new Request("https://internal/_admin/discovery/sources", {
  method, body: JSON.stringify(body),
});

test("新增源默认非公开且消耗 1 积分，显式公开或零积分可保存，局部编辑保留配置", async () => {
  const { service, rows } = fixture();
  for (const fields of [{}, { require_token: false, credit_cost: 0 }]) {
    const created = await service.create_discovery_source(request({ title: "源", feed_url: "{{hostname}}/rss/news/123", ...fields }));
    const source = created.data.source;
    assert.equal(source.require_token, fields.require_token ?? true);
    assert.equal(source.credit_cost, fields.credit_cost ?? 1);
    assert.equal(rows.get(source.id).require_token, source.require_token ? 1 : 0);
    assert.equal(rows.get(source.id).credit_cost, source.credit_cost);
    const updated = await service.update_discovery_source(request({ title: "改名" }, "PATCH"), source.id);
    assert.equal(updated.source.require_token, source.require_token);
    assert.equal(updated.source.credit_cost, source.credit_cost);
  }
});

test("社媒主页随新增和编辑保存，局部修改保留原值，空串可清除", async () => {
  const { service, rows } = fixture();
  const social_url = "https://www.douyin.com/user/example?a=1&b=2";
  const created = await service.create_discovery_source(request({ title: "源", feed_url: "{{hostname}}/rss/news/123", social_url }));
  const id = created.data.source.id;
  assert.equal(created.data.source.social_url, social_url);
  assert.equal(rows.get(id).social_url, social_url);
  assert.equal((await service.update_discovery_source(request({ title: "新标题" }, "PATCH"), id)).source.social_url, social_url);
  assert.equal((await service.update_discovery_source(request({ social_url: "https://x.com/example" }, "PATCH"), id)).source.social_url, "https://x.com/example");
  assert.equal((await service.update_discovery_source(request({ social_url: "" }, "PATCH"), id)).source.social_url, "");
});

test("多个社媒主页新增、局部更新和清空均保持数组与首项一致", async () => {
  const { service, rows } = fixture();
  const social_urls = ["https://x.com/example", "https://www.douyin.com/user/example"];
  const created = await service.create_discovery_source(request({ title: "源", feed_url: "{{hostname}}/rss/news/123", social_urls }));
  const id = created.data.source.id;
  assert.deepEqual(created.data.source.social_urls, social_urls);
  assert.deepEqual(JSON.parse(rows.get(id).social_urls_json), social_urls);
  assert.deepEqual((await service.update_discovery_source(request({ title: "新标题" }, "PATCH"), id)).source.social_urls, social_urls);
  const changed = await service.update_discovery_source(request({ social_urls: social_urls.slice(1) }, "PATCH"), id);
  assert.equal(changed.source.social_url, social_urls[1]);
  const cleared = await service.update_discovery_source(request({ social_urls: [] }, "PATCH"), id);
  assert.equal(cleared.source.social_url, "");
  assert.deepEqual(cleared.source.social_urls, []);
  assert.deepEqual(JSON.parse(rows.get(id).social_urls_json), []);
});

test("新增与编辑源拒绝热榜和未匹配脚本的 RSS/Atom 路由，失败不写库", async () => {
  const { service, rows } = fixture();
  const before = structuredClone(rows);
  for (const prefix of ["{{hostname}}", "https://feeds.example.com"]) {
    for (const format of ["rss", "atom"]) {
      for (const path of ["/rank/123", "/missing/123", "/posts/not-a-number"]) {
        const feed_url = prefix + "/" + format + path;
        const error = { status: 400, message: "订阅源路由必须匹配 kind 为 rss 的脚本" };
        await assert.rejects(service.create_discovery_source(request({ title: "源", feed_url })), error);
        await assert.rejects(service.update_discovery_source(request({ feed_url }, "PATCH"), "old"), error);
        assert.deepEqual(rows, before);
      }
    }
  }
});

test("脚本支持动态、多路由、停用和旧元数据；普通外部订阅地址可保存", async () => {
  const { service, rows } = fixture();
  for (const feed_url of ["{{hostname}}/rss/news/123?offset=1", "{{hostname}}/atom/posts/123",
    "https://feeds.example.com/rss/news/abc?offset=1", "{{hostname}}/atom/legacy/123", "https://example.com/feed.xml"]) {
    const created = await service.create_discovery_source(request({ title: "源", feed_url }));
    assert.equal(created.status, 201);
    assert.equal(created.data.source.feed_url, feed_url);
    const updated = await service.update_discovery_source(request({ feed_url }, "PATCH"), "old");
    assert.equal(updated.source.feed_url, feed_url);
    assert.equal(rows.get("old").feed_url, feed_url);
  }
});
