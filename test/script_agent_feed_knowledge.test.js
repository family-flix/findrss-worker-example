import assert from "node:assert/strict";
import test from "node:test";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { FeedModel } from "../server/domain/feed_format.js";
import { SCRIPT_AGENT_FEED_EXAMPLE, SCRIPT_AGENT_MEDIA_FEED_EXAMPLE, SCRIPT_AGENT_REFERENCE_FEED_EXAMPLE, SCRIPT_AGENT_FEED_KNOWLEDGE } from "../server/lib/script_agent_feed_knowledge.js";

const parser = new XMLParser({ ignoreAttributes: false, parseTagValue: false,
  isArray: name => ["item", "entry", "category", "media:content", "media:group"].includes(name) });
function document(example, format) {
  // 使用提示词中的原始 JSON 示例，走实际生产模型和 XML 渲染器。
  const xml = FeedModel.fromValue(JSON.parse(JSON.stringify(example))).render(format, { self_url: "https://feeds.example.com/" + format + "/sample" });
  assert.equal(XMLValidator.validate(xml), true);
  return parser.parse(xml);
}

test("助手知识的完整 JSON 示例正确映射 RSS channel、item、HTML 正文和 Atom feed/entry", () => {
  const raw = SCRIPT_AGENT_FEED_EXAMPLE, item = raw.items[0];
  const channel = document(raw, "rss").rss.channel;
  assert.equal(channel.title, raw.title);
  assert.equal(channel.link, raw.link);
  assert.equal(channel.description, raw.description);
  assert.equal(channel.language, raw.language);
  assert.equal(channel.image.url, raw.image.url);
  assert.equal(channel.image.title, raw.image.title);
  assert.equal(Date.parse(channel.lastBuildDate), Date.parse(raw.updated));
  const rss_item = channel.item[0];
  assert.equal(rss_item.title, item.title);
  assert.equal(rss_item.guid["#text"], item.id);
  assert.equal(rss_item.guid["@_isPermaLink"], "true");
  assert.equal(rss_item["content:encoded"], item.content, "HTML 仅由渲染器转义一次，解析后还原正文与 URL 中的 &");
  assert.equal(rss_item["dc:creator"], item.author.name);
  assert.equal(Date.parse(rss_item.pubDate), Date.parse(item.published));
  assert.equal(rss_item["media:thumbnail"]["@_url"], item.image);
  assert.equal(channel.author, undefined, "顶层 author 不渲染为 RSS channel author");
  assert.equal(rss_item.updated, undefined, "item.updated 是 Atom 字段");
  const atom = document(raw, "atom").feed;
  assert.equal(atom.title, raw.title);
  assert.equal(atom["@_xml:lang"], raw.language);
  assert.equal(atom.author.name, raw.author.name);
  assert.equal(atom.logo, raw.image.url);
  assert.equal(atom.entry[0].content["#text"], item.content);
  assert.equal(atom.entry[0].content["@_type"], "html");
  assert.equal(Date.parse(atom.entry[0].updated), Date.parse(item.updated));
});

test("助手知识的多图、附件和动态照片示例在 RSS 与 Atom 中保留媒体与视频密钥", () => {
  for (const format of ["rss", "atom"]) {
    const doc = document(SCRIPT_AGENT_MEDIA_FEED_EXAMPLE, format);
    const [gallery, video, live] = format === "rss" ? doc.rss.channel.item : doc.feed.entry;
    assert.equal(gallery["media:group"][0]["media:content"].length, 2);
    assert.equal(video["media:content"][0]["@_type"], "video/mp4");
    assert.equal(video["media:content"][0]["@_key"], "example-video-key");
    const photo_group = live["media:group"][0];
    assert.equal(photo_group["media:content"][0]["@_medium"], "image");
    assert.equal(photo_group["media:content"][1]["@_medium"], "video");
    assert.equal(photo_group["media:content"][1]["@_key"], "example-live-video-key");
    assert.equal(photo_group["media:content"][1]["@_width"], "1080");
    assert.equal(photo_group["media:content"][1]["media:thumbnail"]["@_url"], "https://example.com/live.jpg");
    if (format === "rss") assert.equal(video.enclosure["@_length"], "123456");
  }
});

test("知识中的最低结构、错误 channel 包装和不支持的 RSS 字段与实际渲染行为一致", () => {
  assert.equal(document({ items: [] }, "rss").rss.channel.item, undefined);
  assert.throws(() => FeedModel.fromValue({ channel: SCRIPT_AGENT_FEED_EXAMPLE }), /items 必须是数组/);
  assert.throws(() => FeedModel.fromValue(JSON.stringify(SCRIPT_AGENT_FEED_EXAMPLE)), /JSON 对象/);
  const raw = { ...SCRIPT_AGENT_FEED_EXAMPLE, ttl: 60, managingEditor: "editor", items: [{ title: "错误别名", pubDate: "2026-10-14", content_html: "<p>wrong</p>", image: { url: "https://example.com/wrong.jpg" } }] };
  const channel = document(raw, "rss").rss.channel;
  assert.equal(channel.ttl, undefined);
  assert.equal(channel.managingEditor, undefined);
  assert.equal(channel.item[0].pubDate, undefined);
  assert.equal(channel.item[0]["content:encoded"], undefined);
  assert.equal(channel.item[0]["media:thumbnail"], undefined);
  for (const example of [SCRIPT_AGENT_FEED_EXAMPLE, SCRIPT_AGENT_MEDIA_FEED_EXAMPLE, SCRIPT_AGENT_REFERENCE_FEED_EXAMPLE]) {
    assert.ok(SCRIPT_AGENT_FEED_KNOWLEDGE.includes(JSON.stringify(example, null, 2)));
    assert.ok(Object.isFrozen(example.items));
  }
});


test("助手知识中的原帖引用在 RSS/Atom 中输出子 item/entry，保留各自正文与作者", () => {
  const raw = SCRIPT_AGENT_REFERENCE_FEED_EXAMPLE;
  for (const format of ["rss", "atom"]) {
    const doc = document(raw, format);
    const parents = format === "rss" ? doc.rss.channel.item : doc.feed.entry;
    assert.equal(parents.length, 1);
    const parent = parents[0];
    assert.equal(parent["findrss:kind"]["#text"], "reply");
    const reference = parent["findrss:reference"][0];
    assert.equal(reference["@_relation"], "reply");
    assert.equal(reference["@_ref"], "post-1");
    const original = format === "rss" ? reference.item[0] : reference.entry[0];
    assert.equal(original.title, "原帖");
    assert.equal(format === "rss" ? original["dc:creator"] : original.author.name, "原帖作者");
    assert.equal(parent["findrss:reference"][1]["@_unavailable"], "true");
  }
});
