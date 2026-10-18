import assert from "node:assert/strict";
import test from "node:test";
import { FeedModel } from "../server/domain/feed_format.js";
import { feed_image_metadata } from "../server/infra/feed_image_metadata.js";
import { discovery_feed_preview } from "../server/infra/feed_fetch.js";
import { discovery_snapshot_articles } from "../server/infra/discovery_snapshot.js";

test("快照图片按 URL 去重、最多并行四张，失败降级并包含引用与 Live Photo 静态图", async () => {
  const urls = Array.from({ length: 8 }, (_, index) => "https://example.com/" + index + ".jpg");
  const feed = FeedModel({ items: [{ image: urls[0], images: urls,
    live_photos: [{ image: urls[1], video: "https://example.com/live.mp4" }],
    references: [{ relation: "quote", id: "child", item: { image: urls[2] } }],
  }, { image: urls[0], enclosure: { url: urls[3], type: "image/jpeg" } }] });
  let running = 0, peak = 0;
  const calls = [];
  const metadata = await feed_image_metadata(feed, { metadata_for: async url => {
    calls.push(url); running++; peak = Math.max(peak, running);
    await new Promise(resolve => setImmediate(resolve));
    running--;
    if (url === urls[7]) throw new Error("offline");
    return { width: 800, height: 450, blurhash: "hash" };
  } });
  assert.deepEqual(new Set(calls), new Set(urls));
  assert.equal(calls.length, 8);
  assert.equal(peak, 4);
  assert.equal(metadata.size, 7);
  assert.equal(metadata.has(urls[7]), false);
});

test("取消图片元数据任务时停止取图并让刷新失败，保留旧快照", async () => {
  const controller = new AbortController();
  const reason = new Error("cancelled");
  const feed = FeedModel({ items: [{ images: ["https://example.com/a.jpg"] }] });
  await assert.rejects(feed_image_metadata(feed, { signal: controller.signal, metadata_for: async (_url, _decode, signal) => {
    assert.equal(signal, controller.signal);
    controller.abort(reason);
    throw reason;
  } }), error => error === reason);
});

for (const format of ["rss", "atom"]) test(`${format} 封面、图集、Live Photo、引用图片携带宽高和 BlurHash，预览复用 XML 元数据`, async () => {
  const cover = "https://example.com/cover.jpg?a=1&b=2";
  const other = "https://example.com/other.jpg";
  const hash = 'hash<&"';
  const feed = FeedModel({ title: "图片", items: [{ id: "parent", title: "图集", link: "https://example.com/post",
    image: cover, images: [cover, other],
    live_photos: [{ image: other, video: "https://example.com/live.mp4", width: 640, height: 360 }],
    references: [{ relation: "quote", id: "child", item: { id: "child", title: "引用", image: other } }],
  }] });
  const image_metadata = new Map([[cover, { width: 1200, height: 630, blurhash: hash }], [other, { width: 800, height: 600 }]]);
  const xml = feed.render(format, { image_metadata });
  assert.match(xml, /width="1200" height="630" blurhash="hash&lt;&amp;&quot;"/);
  assert.match(xml, /medium="image" width="1200" height="630"/);
  assert.match(xml, /medium="image" isDefault="true" width="800" height="600"/);
  assert.match(xml, /medium="video" type="video\/mp4" key="" width="640" height="360"/);
  const article = discovery_feed_preview(xml, "https://example.com/feed").articles[0];
  assert.equal(article.thumbnail, cover);
  assert.equal(article.thumbnail_width, 1200);
  assert.equal(article.thumbnail_height, 630);
  assert.equal(article.thumbnail_blurhash, hash);
  assert.equal(article.media.find(value => value.url === cover).blurhash, hash);
  assert.equal(article.references[0].item.thumbnail_width, 800);
  const preview = await discovery_snapshot_articles(xml, "https://example.com/feed", () => assert.fail("不应重复下载已处理封面"));
  assert.equal(preview[0].cover_width, 1200);
  assert.equal(preview[0].cover_height, 630);
  assert.equal(preview[0].cover_blurhash, hash);
  const dimensions_only = feed.render(format, { image_metadata: new Map([[cover, { width: 1200, height: 630 }]]) });
  const without_hash = await discovery_snapshot_articles(dimensions_only, "https://example.com/feed", () => assert.fail("已有尺寸、解码未得 BlurHash 时不应重复下载"));
  assert.equal(without_hash[0].cover_width, 1200);
  assert.equal(without_hash[0].cover_blurhash, "");
  const invalid = feed.render(format, { image_metadata: new Map([[cover, { width: Infinity, height: -1, blurhash: "" }]]) });
  assert.doesNotMatch(invalid, /Infinity|height="-1"|blurhash=""/);
});
