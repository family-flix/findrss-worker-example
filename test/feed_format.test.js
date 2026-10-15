import assert from "node:assert/strict";
import test from "node:test";

import { FeedItemModel, FeedModel } from "../server/domain/feed_format.js";

test('RSS/Atom 文本与属性移除 XML 1.0 非法码点，保留汉字、emoji 与有效空白', () => {
  const invalid = '\u0000\u0001\u0008\u000b\u000c\u000e\u001f\ud800\udfff\ufffe\uffff';
  const clean = '中文😀<&"\t\n\r';
  const value = clean + invalid;
  const feed = FeedModel({ title: value, author: { name: value }, image: value,
    items: [{ id: value, title: value, description: value, content: value, categories: [value], enclosure: { url: value, type: value } }],
  });
  for (const format of ['rss', 'atom']) {
    const xml = feed.render(format, { self_url: value });
    assert.doesNotMatch(xml, /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uD800-\uDFFF\uFFFE\uFFFF]/u);
    assert.match(xml, /中文😀&lt;&amp;/u);
    assert.match(xml, /&quot;/);
    assert.ok(xml.includes('\t\n\r'));
  }
});

/** 覆盖超集字段的完整 feed。 */
const full_feed = {
  title: "36Kr & 更多",
  link: "https://36kr.com/",
  description: "由脚本生成的订阅源",
  language: "zh-CN",
  id: "https://36kr.com/",
  author: { name: "作者", email: "author@example.com", uri: "https://example.com/me" },
  image: { url: "https://36kr.com/logo.png", title: "36Kr", link: "https://36kr.com/" },
  updated: 1_700_000_000,
  items: [{
    id: "https://36kr.com/p/1",
    title: "文章标题",
    link: "https://36kr.com/p/1",
    description: "摘要",
    content: "<p>正文</p>",
    author: "作者",
    published: 1_700_000_000,
    updated: 1_700_000_100,
    image: "https://36kr.com/cover.jpg",
    images: ["https://36kr.com/a.jpg", "https://36kr.com/b.jpg"],
    enclosure: { url: "https://36kr.com/v.mp4", type: "video/mp4", length: 1234 },
    categories: ["科技", "创业"],
  }],
};

const value_of = (feed) => FeedModel.fromValue(feed).toValue();
const render_rss = (feed, options) => FeedModel.fromValue(feed).render("rss", options);
const render_atom = (feed, options) => FeedModel.fromValue(feed).render("atom", options);

test("FeedModel.FORMATS 与内容类型", () => {
  assert.deepEqual(FeedModel.FORMATS, ["rss", "atom"]);
  assert.equal(FeedModel.content_type("rss"), "application/rss+xml; charset=utf-8");
  assert.equal(FeedModel.content_type("atom"), "application/atom+xml; charset=utf-8");
});

test("FeedModel 归一化超集字段并忽略未知字段", () => {
  const feed = value_of({ ...full_feed, unknown: "ignore me", items: [
    { ...full_feed.items[0], mystery: 42 },
  ] });
  assert.equal(feed.title, "36Kr & 更多");
  assert.equal(feed.updated, 1_700_000_000_000);
  assert.deepEqual(feed.author, {
    name: "作者",
    email: "author@example.com",
    uri: "https://example.com/me",
  });
  assert.deepEqual(feed.image, {
    url: "https://36kr.com/logo.png",
    title: "36Kr",
    link: "https://36kr.com/",
  });
  assert.equal(feed.items.length, 1);
  assert.equal(feed.items[0].published, 1_700_000_000_000);
  assert.equal(feed.items[0].updated, 1_700_000_100_000);
  assert.deepEqual(feed.items[0].enclosure, {
    url: "https://36kr.com/v.mp4",
    type: "video/mp4",
    length: "1234",
    key: "",
  });
  assert.deepEqual(feed.items[0].categories, ["科技", "创业"]);
  assert.deepEqual(feed.items[0].images, ["https://36kr.com/a.jpg", "https://36kr.com/b.jpg"]);
  assert.equal("unknown" in feed, false);
  assert.equal("mystery" in feed.items[0], false);
});

test("item.images 归一：非数组 / 空白项被丢弃，缺省为空数组", () => {
  assert.deepEqual(value_of({ items: [{}] }).items[0].images, []);
  assert.deepEqual(
    value_of({ items: [{ images: [" a.jpg ", "", null, 3, "b.jpg"] }] }).items[0].images,
    ["a.jpg", "b.jpg"],
  );
  // 非数组（含单个字符串）一律不算多图
  for (const invalid of ["a.jpg", null, 42, {}]) {
    assert.deepEqual(value_of({ items: [{ images: invalid }] }).items[0].images, []);
  }
});

test("FeedModel 结构不合法时 throw", () => {
  for (const invalid of [null, 42, "feed", [], undefined]) {
    assert.throws(() => FeedModel.fromValue(invalid), /feed 必须是 JSON 对象/);
  }
  assert.throws(() => FeedModel.fromValue({ title: "x" }), /feed.items 必须是数组/);
  assert.throws(() => FeedModel.fromValue({ items: {} }), /feed.items 必须是数组/);
});

test("FeedModel 兜底缺失字段并可重复归一化", () => {
  const feed = value_of({ items: [] });
  assert.deepEqual(feed, {
    title: "",
    link: "",
    description: "",
    language: "",
    id: "",
    author: null,
    image: null,
    updated: null,
    items: [],
  });
  assert.deepEqual(value_of(feed), feed);
  // 非对象 item 直接忽略，不报错。
  assert.deepEqual(value_of({ items: [null, "x", 3] }).items, []);
});

test("时间字段接受秒 / 毫秒 / ISO 串，非法值归为 null", () => {
  assert.equal(value_of({ items: [], updated: 1_700_000_000 }).updated, 1_700_000_000_000);
  assert.equal(value_of({ items: [], updated: 1_700_000_000_000 }).updated, 1_700_000_000_000);
  assert.equal(
    value_of({ items: [], updated: "2023-11-14T22:13:20.000Z" }).updated,
    1_700_000_000_000,
  );
  for (const invalid of [0, -1, "not-a-date", "", null, {}, []]) {
    assert.equal(value_of({ items: [], updated: invalid }).updated, null);
  }
});

test("FeedItemModel 对非对象输入返回 null，FeedPersonModel 的 label 走 name→email→uri", () => {
  assert.equal(FeedItemModel(null), null);
  assert.equal(FeedItemModel(42), null);
  assert.equal(FeedItemModel([]), null);
  const by_email = FeedItemModel({ author: { email: "a@example.com" } });
  assert.equal(by_email.author.label(), "a@example.com");
  const by_name = FeedItemModel({ author: "作者" });
  assert.equal(by_name.author.label(), "作者");
  assert.equal(by_name.author.toValue().uri, "");
});

test("RSS 输出完整超集字段与 RFC 822 时间", () => {
  const output = render_rss(full_feed);
  assert.ok(output.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n'));
  assert.ok(output.includes(
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" ' +
      'xmlns:media="http://search.yahoo.com/mrss/" ' +
      'xmlns:content="http://purl.org/rss/1.0/modules/content/" ' +
      'xmlns:dc="http://purl.org/dc/elements/1.1/">',
  ));
  assert.ok(output.includes("<title>36Kr &amp; 更多</title>"));
  assert.ok(output.includes("<link>https://36kr.com/</link>"));
  assert.ok(output.includes("<description>由脚本生成的订阅源</description>"));
  assert.ok(output.includes("<language>zh-CN</language>"));
  assert.ok(output.includes("<lastBuildDate>Tue, 14 Nov 2023 22:13:20 GMT</lastBuildDate>"));
  assert.ok(output.includes("<url>https://36kr.com/logo.png</url>"));
  // RSS 侧忽略 feed.author，只保留 item 的 dc:creator
  assert.ok(!output.includes("<managingEditor>"));
  assert.ok(output.includes("<dc:creator>作者</dc:creator>"));
  assert.ok(output.includes("<pubDate>Tue, 14 Nov 2023 22:13:20 GMT</pubDate>"));
  assert.ok(output.includes('<media:thumbnail url="https://36kr.com/cover.jpg" />'));
  // item.images 每张一个 medium="image" 的 media:content，与视频的 media:content 靠 medium 区分
  assert.ok(output.includes('<media:content url="https://36kr.com/a.jpg" medium="image" />'));
  assert.ok(output.includes('<media:content url="https://36kr.com/b.jpg" medium="image" />'));
  assert.ok(output.includes(
    '<enclosure url="https://36kr.com/v.mp4" type="video/mp4" length="1234" />',
  ));
  assert.ok(output.includes(
    '<media:content url="https://36kr.com/v.mp4" type="video/mp4" length="1234" medium="video" />',
  ));
  assert.ok(output.includes("<category>科技</category>"));
  assert.ok(output.includes("<category>创业</category>"));
  assert.ok(output.endsWith("</rss>\n"));
});

test("RSS guid：id 缺省取 link，等于 link 且为 http(s) 时 isPermaLink=true", () => {
  const output = render_rss({
    items: [
      { title: "无 id", link: "https://example.com/a" },
      { title: "id 非 link", id: "wxmp:gh:1:2:3", link: "https://example.com/b" },
      { title: "无 link", id: "custom-guid" },
      { title: "无 link 无 id" },
    ],
  });
  assert.ok(output.includes('<guid isPermaLink="true">https://example.com/a</guid>'));
  assert.ok(output.includes('<guid isPermaLink="false">wxmp:gh:1:2:3</guid>'));
  assert.ok(output.includes('<guid isPermaLink="false">custom-guid</guid>'));
  assert.equal(output.match(/<guid/g).length, 3);
});

test("RSS 转义正文中的 &<> 且不让 ]]> 逃逸（不用 CDATA）", () => {
  const output = render_rss({
    items: [{
      title: '标题 <a> & "b"',
      description: "摘要 & <b>",
      content: "正文 ]] > & <i>结束</i>",
      enclosure: { url: 'https://example.com/a?x=1&y="2"', type: "video/mp4" },
    }],
  });
  assert.ok(output.includes("<title>标题 &lt;a&gt; &amp; \"b\"</title>"));
  assert.ok(output.includes("<description>摘要 &amp; &lt;b&gt;</description>"));
  assert.ok(output.includes("<content:encoded>正文 ]] &gt; &amp; &lt;i&gt;结束&lt;/i&gt;</content:encoded>"));
  assert.ok(!output.includes("<![CDATA["));
  assert.ok(output.includes('url="https://example.com/a?x=1&amp;y=&quot;2&quot;"'));
});

test("Atom 输出超集字段与 RFC 3339 时间", () => {
  const output = render_atom(full_feed, { self_url: "https://api.example/atom/demo" });
  assert.ok(output.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n'));
  assert.ok(output.includes('xmlns="http://www.w3.org/2005/Atom"'));
  assert.ok(output.includes('xml:lang="zh-CN"'));
  assert.ok(output.includes("<title>36Kr &amp; 更多</title>"));
  assert.ok(output.includes("<id>https://36kr.com/</id>"));
  assert.ok(output.includes("<updated>2023-11-14T22:13:20.000Z</updated>"));
  assert.ok(output.includes('<link rel="alternate" href="https://36kr.com/" />'));
  assert.ok(output.includes(
    '<link rel="self" href="https://api.example/atom/demo" type="application/atom+xml" />',
  ));
  assert.ok(output.includes("<subtitle>由脚本生成的订阅源</subtitle>"));
  assert.ok(output.includes("<author>\n    <name>作者</name>"));
  assert.ok(output.includes("<email>author@example.com</email>"));
  assert.ok(output.includes("<uri>https://example.com/me</uri>"));
  assert.ok(output.includes("<logo>https://36kr.com/logo.png</logo>"));
  assert.ok(output.includes("<published>2023-11-14T22:13:20.000Z</published>"));
  assert.ok(output.includes('<summary type="html">摘要</summary>'));
  assert.ok(output.includes('<content type="html">&lt;p&gt;正文&lt;/p&gt;</content>'));
  assert.ok(output.includes('<media:content url="https://36kr.com/a.jpg" medium="image" />'));
  assert.ok(output.includes('<media:content url="https://36kr.com/b.jpg" medium="image" />'));
  assert.ok(output.includes(
    '<link rel="enclosure" url="https://36kr.com/v.mp4" type="video/mp4" length="1234" />',
  ));
  assert.ok(output.includes('<category term="科技" />'));
  assert.ok(output.endsWith("</feed>\n"));
});

test("Atom feed/entry id 与 author 缺失时的兜底链", () => {
  const output = render_atom({
    title: "只有标题",
    items: [
      { title: "条目一", link: "https://example.com/a" },
      { title: "条目二" },
    ],
  });
  // feed 无 id/link/self_url 时用占位 id；author 用 feed title 兜底。
  assert.ok(output.includes("<id>urn:findrss:feed</id>"));
  assert.ok(output.includes("<author>\n    <name>只有标题</name>\n  </author>"));
  // entry id 缺省取 link，再退回 feed id + 序号。
  assert.ok(output.includes("<id>https://example.com/a</id>"));
  assert.ok(output.includes("<id>urn:findrss:feed#1</id>"));
});

test("Atom entry updated 回退链：updated → published → feed.updated", () => {
  const output = render_atom({
    updated: 1_700_000_000,
    items: [
      { title: "a", updated: 1_700_000_100, published: 1_700_000_050 },
      { title: "b", published: 1_700_000_050 },
      { title: "c" },
    ],
  });
  assert.ok(output.includes("<updated>2023-11-14T22:15:00.000Z</updated>"));
  assert.ok(output.includes("<updated>2023-11-14T22:14:10.000Z</updated>"));
  // 第三个条目回退到 feed.updated
  assert.equal(output.match(/<updated>2023-11-14T22:13:20\.000Z<\/updated>/g).length, 2);
  // published 只在显式给出时输出（前两个条目有，第三个没有）
  assert.equal(output.match(/<published>/g).length, 2);
});

test("RSS/Atom 的 item.image 映射为 media:thumbnail，enclosure/video 映射为附件", () => {
  const video_item = { title: "视频", video: "https://example.com/v.mp4", image: "https://example.com/c.jpg" };
  for (const format of ["rss", "atom"]) {
    const output = FeedModel.fromValue({ items: [video_item] }).render(format);
    assert.ok(output.includes('<media:thumbnail url="https://example.com/c.jpg" />'));
    // video 快捷写法等价 type=video/mp4 的 enclosure
    assert.ok(output.includes('url="https://example.com/v.mp4" type="video/mp4"'));
    assert.ok(output.includes('medium="video"'));
  }
  // 图片型 enclosure 的 medium 为 image，阅读端缩略图同样能命中
  const image_enclosure = render_rss({
    items: [{ title: "图", enclosure: { url: "https://example.com/i.png", type: "image/png" } }],
  });
  assert.ok(image_enclosure.includes('<enclosure url="https://example.com/i.png" type="image/png" />'));
  assert.ok(image_enclosure.includes('medium="image"'));
});

test("enclosure.key 渲染成附件属性（RSS/Atom 两种都出），缺失时不出", () => {
  const with_key = {
    items: [{
      title: "视频",
      enclosure: { url: "https://play.example/v", type: "video/mp4", key: "k & 1" },
    }],
  };
  const rss = render_rss(with_key);
  assert.ok(rss.includes('<enclosure url="https://play.example/v" type="video/mp4" key="k &amp; 1" />'));
  assert.ok(rss.includes(
    '<media:content url="https://play.example/v" type="video/mp4" key="k &amp; 1" medium="video" />',
  ));

  const atom = render_atom(with_key);
  assert.ok(atom.includes(
    '<link rel="enclosure" url="https://play.example/v" type="video/mp4" key="k &amp; 1" />',
  ));
  assert.ok(atom.includes(
    '<media:content url="https://play.example/v" type="video/mp4" key="k &amp; 1" medium="video" />',
  ));

  // 没有 key（含 `video` 快捷写法）时属性整个不出现，不输出空 key。
  const without_key = render_rss({ items: [{ title: "v", video: "https://example.com/v.mp4" }] });
  assert.ok(without_key.includes('<enclosure url="https://example.com/v.mp4" type="video/mp4" />'));
  assert.equal(without_key.includes("key="), false);
});

test("self_url 只影响 RSS atom:link 与 Atom rel=self", () => {
  const rss = render_rss({ items: [] }, { self_url: "https://api.example/rss/demo?x=1" });
  assert.ok(rss.includes(
    '<atom:link href="https://api.example/rss/demo?x=1" rel="self" type="application/rss+xml" />',
  ));
  const atom_without_self = render_atom({ items: [] });
  assert.ok(!atom_without_self.includes('rel="self"'));
  assert.ok(!render_rss({ items: [] }).includes("atom:link"));
});

test("FeedModel.render 按 format 分派，未知格式报错", () => {
  const feed = FeedModel.fromValue({ title: "x", items: [] });
  assert.equal(feed.render("rss"), render_rss({ title: "x", items: [] }));
  assert.equal(feed.render("atom"), render_atom({ title: "x", items: [] }));
  assert.throws(() => feed.render("json"), /未知的 feed 格式：json/);
});

test("渲染前不需要预先归一化，raw feed 同样可用", () => {
  const raw = { title: "raw", items: [{ title: "t", published: "2023-11-14T22:13:20Z" }] };
  assert.ok(render_rss(raw).includes("<pubDate>Tue, 14 Nov 2023 22:13:20 GMT</pubDate>"));
  assert.ok(render_atom(raw).includes("<updated>2023-11-14T22:13:20.000Z</updated>"));
});

test("空 items 与缺失可选字段时仍输出合法根元素", () => {
  const rss = render_rss({ items: [] });
  assert.ok(rss.includes("<channel>"));
  assert.ok(!rss.includes("<item>"));
  assert.ok(!rss.includes("<title>"));
  const atom = render_atom({ items: [] });
  assert.ok(atom.includes("<feed "));
  assert.ok(!atom.includes("<entry>"));
});
