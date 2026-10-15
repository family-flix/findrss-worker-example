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
