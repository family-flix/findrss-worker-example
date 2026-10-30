import assert from "node:assert/strict";
import test from "node:test";
import { RepositoryDiscoverySource } from "../server/repository/discovery_source.js";
import { snapshot_store } from "./support/snapshot_store.js";
import { DiscoverySourceModel } from "../server/domain/discovery_source.js";
test("社媒主页写入 SQLite，编辑与重建仓库后保留，仅启用且已配置的源参与 XML 构建", async t => {
  const store = snapshot_store();
  t.after(async () => await store.db.close());
  const repo = new RepositoryDiscoverySource(store);
  const fields = {
    id: "one",
    title: "源",
    description: "",
    website: "https://example.com/",
    social_url: "https://x.com/one",
    feed_url: "{{hostname}}/rss/example/one",
    category: "",
    tags_json: "[]",
    enabled: 1,
    require_token: 1,
    credit_cost: 2,
    sort_order: 0,
    source_type: "x",
    created_at: 1,
    updated_at: 1
  };
  await repo.insert(fields);
  await repo.insert({
    ...fields,
    id: "disabled",
    enabled: 0,
    feed_url: "{{hostname}}/rss/example/disabled"
  });
  await repo.insert({
    ...fields,
    id: "empty",
    social_url: undefined,
    feed_url: "{{hostname}}/rss/example/empty"
  });
  assert.equal((await repo.find("one")).social_url, fields.social_url);
  assert.equal((await repo.find("empty")).social_url, "");
  await repo.update({
    ...fields,
    social_url: "https://x.com/updated"
  });
  const rebuilt = new RepositoryDiscoverySource(store);
  assert.deepEqual((await rebuilt.list_social_routes()).map(row => ({
    ...row
  })), [{
    feed_url: fields.feed_url,
    social_url: "https://x.com/updated"
  }]);
  assert.equal((await rebuilt.find("one")).website, fields.website);
  await repo.update({
    ...fields,
    social_url: ""
  });
  assert.deepEqual(await rebuilt.list_social_routes(), []);
});
test("多个主页存入 SQLite，重建后全部保留且可检索第二项", async t => {
  const store = snapshot_store();
  t.after(async () => await store.db.close());
  const repo = new RepositoryDiscoverySource(store);
  const social_urls = ["https://x.com/one", "https://www.douyin.com/user/second-home"];
  const fields = {
    id: "multi",
    title: "源",
    description: "",
    website: "",
    social_url: social_urls[0],
    social_urls_json: JSON.stringify(social_urls),
    feed_url: "https://example.com/feed.xml",
    category: "",
    tags_json: "[]",
    enabled: 1,
    require_token: 0,
    sort_order: 0,
    source_type: "website",
    created_at: 1,
    updated_at: 1
  };
  await repo.insert(fields);
  const rebuilt = new RepositoryDiscoverySource(store);
  assert.deepEqual(DiscoverySourceModel.fromRow(await rebuilt.find("multi")).social_urls, social_urls);
  assert.equal(await rebuilt.count_filtered({
    query: "second-home",
    include_disabled: true
  }), 1);
  await repo.update({
    ...fields,
    social_urls_json: "[]",
    social_url: ""
  });
  assert.deepEqual(DiscoverySourceModel.fromRow(await rebuilt.find("multi")).social_urls, []);
  assert.equal(await rebuilt.count_filtered({
    query: "second-home",
    include_disabled: true
  }), 0);
});
