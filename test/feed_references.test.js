import assert from "node:assert/strict";
import test from "node:test";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { create_feed_parser } from "@findrss/feed-fetch";
import { FeedItemModel, FeedModel } from "../server/domain/feed_format.js";

const { parse_feed_document } = create_feed_parser(XMLParser, XMLValidator);
const original = {
  id: 'post:<1>&"', kind: "post", type: "video", title: "原帖 <&> 😀",
  link: "https://example.com/1?a=1&b=2", description: "原帖摘要", content: "<p>原帖正文</p>",
  author: { name: "原作者", uri: "https://example.com/author" }, published: "2026-10-17T01:00:00Z",
  images: ["https://example.com/photo.jpg"], enclosure: { url: "https://example.com/video.mp4", type: "video/mp4", key: 'a"&b' },
};
const raw = { title: "源", link: "https://example.com/", items: [{
  id: "reply:2", kind: "reply", type: "article", title: "回复", link: "https://example.com/2",
  description: "我的回复", references: [
    { relation: "reply", item: original },
    { relation: "quote", id: "missing", link: "https://example.com/missing", unavailable: true },
  ],
}] };

test("引用归一化保留独立互动类型、完整子项及不可用引用，可重复序列化", () => {
  const feed = FeedModel(raw).toValue();
  const reference = feed.items[0].references[0];
  assert.equal(feed.items[0].kind, "reply");
  assert.equal(feed.items[0].type, "article");
  assert.equal(reference.id, original.id);
  assert.equal(reference.link, original.link);
  assert.equal(reference.item.author.name, "原作者");
  assert.equal(reference.item.content, original.content);
  assert.deepEqual(FeedModel(JSON.parse(JSON.stringify(feed))).toValue(), feed);
  assert.equal(FeedItemModel({ kind: "unknown", references: [null, {}, { relation: "unknown", id: "a" }, { relation: "reply" }] }).toValue().references, undefined);
});

for (const format of ["rss", "atom"]) test(format + " 引用在父项内输出，解析时不展开为独立文章或混合媒体", () => {
  const xml = FeedModel(raw).render(format);
  assert.equal(XMLValidator.validate(xml), true);
  const parsed = new XMLParser({ ignoreAttributes: false, parseTagValue: false }).parse(xml);
  const parent = format === "rss" ? parsed.rss.channel.item : parsed.feed.entry;
  assert.equal(Array.isArray(parent), false);
  assert.equal(parent["findrss:kind"]["#text"], "reply");
  const [reference, missing] = parent["findrss:reference"];
  assert.equal(reference["@_xmlns:findrss"], "https://findrss.cloud/ns/reader");
  assert.equal(reference["@_relation"], "reply");
  assert.equal(reference["@_ref"], original.id);
  assert.equal(reference["@_href"], original.link);
  assert.equal((reference.item || reference.entry).title, original.title);
  assert.equal(missing["@_unavailable"], "true");
  const feed = parse_feed_document(xml, "https://example.com/feed");
  assert.equal(feed.articles.length, 1);
  const article = feed.articles[0];
  assert.equal(article.kind, "reply");
  assert.equal(article.summary, "我的回复");
  assert.equal(article.type, "article");
  assert.deepEqual(article.images, []);
  assert.equal(article.video_url, "");
  assert.equal(article.thumbnail, "");
  assert.equal(article.references[0].item.guid, original.id);
  assert.equal(article.references[0].item.type, "video");
  assert.equal(article.references[0].item.content_html, original.content);
  assert.deepEqual(article.references[0].item.images, original.images);
  assert.equal(article.references[0].item.video_key, original.enclosure.key);
  assert.equal(article.references[1].unavailable, true);
  // 前缀可替换；字段身份来自命名空间，而不是 findrss 字符串。
  assert.deepEqual(parse_feed_document(xml.replaceAll("findrss:", "f:").replaceAll("xmlns:findrss", "xmlns:f"), "https://example.com/feed"), feed);
});

test("引用链有深度上限，循环引用退为 ID/链接，重复引用可独立携带正文", () => {
  const root = { id: "root", title: "root", link: "https://example.com/root" };
  root.references = [{ relation: "reply", item: root }];
  const normalized = FeedItemModel(root).toValue();
  assert.deepEqual(normalized.references, [{ relation: "reply", id: root.id, link: root.link }]);
  let chain = original;
  for (let i = 0; i < 12; i++) chain = { id: "n" + i, references: [{ relation: "repost", item: chain }] };
  const item = FeedItemModel(chain).toValue();
  let depth = 0, current = item;
  while (current.references?.[0].item) { depth++; current = current.references[0].item; }
  assert.equal(depth, 4);
  assert.ok(current.references[0].id);
  for (const format of ["rss", "atom"]) assert.equal(XMLValidator.validate(FeedModel({ items: [item] }).render(format)), true);
  const copy_loop = FeedItemModel({ id: "same", references: [{ relation: "reply", item: { id: "same", title: "copy" } }] }).toValue();
  assert.equal(copy_loop.references[0].item, undefined);
  const twice = FeedItemModel({ references: [{ relation: "reply", item: original }, { relation: "quote", item: original }] });
  assert.equal(twice.references[1].item.content, original.content);
});
