import assert from "node:assert/strict";
import test from "node:test";
import { ServiceDiscovery } from "../server/service/application/discovery.js";
import { RssRouteCache, rss_route_cache_key } from "../server/infra/rss_cache.js";
import { RSS_ROUTE_CACHE_TTL_MS } from "../server/lib/constants.js";
import { snapshot_store } from "./support/snapshot_store.js";
test("XML 状态与下次抓取时间无关，只有管理列表带状态，RSS/Atom 共用一份 XML", async () => {
  const keys = [];
  const repo = {
    discovery: {
      list_tags: () => [],
      list: () => [{
        id: "a",
        title: "源",
        feed_url: "{{hostname}}/rss/wxmp/gh_a?b=2&a=1",
        enabled: 1,
        snapshot_attempted_at: 1
      }, {
        id: "b",
        title: "源 Atom",
        feed_url: "{{hostname}}/atom/wxmp/gh_a?a=1&b=2",
        enabled: 1
      }]
    }
  };
  const service = new ServiceDiscovery({
    repo,
    route_cache: {
      inspect(key) {
        keys.push(key);
        return {
          status: "fresh",
          saved_at: 1000,
          persistent: true
        };
      }
    }
  });
  const url = new URL("https://admin/discovery/sources");
  const admin = await service.list_discovery_sources(url, true);
  assert.deepEqual(keys, ["public-snapshot:cookie-explicit:/wxmp/gh_a?a=1&b=2", "public-snapshot:cookie-explicit:/wxmp/gh_a?a=1&b=2"]);
  assert.equal(admin.sources[0].cache.status, "fresh");
  assert.equal("expires_at" in admin.sources[0].cache, false);
  assert.ok(admin.sources[0].next_snapshot_at <= Date.now());
  const public_list = await service.list_discovery_sources(url, false);
  assert.equal("cache" in public_list.sources[0], false);
});
for (const require_token of [false, true]) test(`${require_token ? "私密" : "公开"}源 XML 超过十分钟及清理重建后，后台仍显示已生成`, async t => {
  let now = 1_800_000_000_000;
  t.mock.method(Date, "now", () => now);
  const {
    db,
    repo
  } = snapshot_store();
  t.after(() => db.close());
  const key = (require_token ? "private-snapshot:" : "public-snapshot:") + rss_route_cache_key("/demo", []);
  const cache = new RssRouteCache(RSS_ROUTE_CACHE_TTL_MS, 1, {
    store: repo
  });
  const saved_at = now;
  await cache.run(key, now, async () => ({
    output: "{}",
    invoked: false,
    rendered: new Map([["rss\n", "<rss/>"], ["atom\n", "<feed/>"]])
  }));
  const service = new ServiceDiscovery({
    route_cache: cache,
    repo: {
      discovery: {
        list_tags: () => [],
        list: () => [{
          id: "a",
          title: "源",
          feed_url: "{{hostname}}/rss/demo",
          enabled: 1,
          require_token
        }]
      }
    }
  });
  const url = new URL("https://admin/discovery/sources");
  for (const elapsed of [0, RSS_ROUTE_CACHE_TTL_MS + 1, 30 * 86400000]) {
    now = saved_at + elapsed;
    await cache.run("temporary-" + elapsed, now, async () => ({
      output: "temporary",
      invoked: false
    }));
    await repo.delete_expired(now);
    await repo.delete_oldest(0);
    service.route_cache = new RssRouteCache(RSS_ROUTE_CACHE_TTL_MS, 1, {
      store: repo
    });
    const state = (await service.list_discovery_sources(url, true)).sources[0].cache;
    assert.equal(state.status, "fresh");
    assert.equal(state.saved_at, saved_at);
    assert.equal(state.persistent, true);
    assert.equal("expires_at" in state, false);
    const snapshot = await service.route_cache.resolve(key, now);
    assert.equal(await snapshot.rendered.get("rss\n"), "<rss/>");
    assert.equal(await snapshot.rendered.get("atom\n"), "<feed/>");
  }
});
