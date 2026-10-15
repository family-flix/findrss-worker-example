import assert from "node:assert/strict";
import test from "node:test";
import { ServiceDiscovery } from "../server/service/durable_object/discovery.js";

test("只有管理列表带快照状态，RSS/Atom 与乱序 query 使用同一缓存键", () => {
  const keys = [];
  const repo = { discovery: { list_tags: () => [], list: () => [
    { id: "a", title: "源", feed_url: "{{hostname}}/rss/wxmp/gh_a?b=2&a=1", enabled: 1 },
    { id: "b", title: "源 Atom", feed_url: "{{hostname}}/atom/wxmp/gh_a?a=1&b=2", enabled: 1 },
  ] } };
  const service = new ServiceDiscovery({ repo, route_cache: { inspect(key) {
    keys.push(key);
    return { status: "fresh", saved_at: 1000, persistent: true };
  } } });
  const url = new URL("https://admin/discovery/sources");
  const admin = service.list_discovery_sources(url, true);
  assert.deepEqual(keys, ["public-snapshot:cookie-explicit:/wxmp/gh_a?a=1&b=2", "public-snapshot:cookie-explicit:/wxmp/gh_a?a=1&b=2"]);
  assert.equal(admin.sources[0].cache.status, "fresh");
  const public_list = service.list_discovery_sources(url, false);
  assert.equal("cache" in public_list.sources[0], false);
});
