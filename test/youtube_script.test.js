import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { register } from "node:module";
import { FeedModel } from "../server/domain/feed_format.js";

register("./support/quickjs_wasm_hook.js", import.meta.url);
const { compile_script_module, execute_script } = await import("../server/infra/script_sandbox.js");
const source = await readFile(new URL("../examples/scripts/rss/youtube.js", import.meta.url), "utf8");
const compiled = await compile_script_module(source);
assert.equal(compiled.error, "");

async function run_html(t, html) {
  const original_fetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = original_fetch; });
  globalThis.fetch = async () => new Response(html);
  const before = Date.now();
  const result = await execute_script(source, { ...compiled.metadata, ...compiled.metadata.routes[0] }, null,
    { method: "GET", pathname: "/youtube/example", params: { handle: "example" }, query: {} });
  return { feed: JSON.parse(result.output), before, after: Date.now() };
}

async function run_feed(t, entries) {
  const data = {
    metadata: { channelMetadataRenderer: { title: "测试频道", externalId: "channel-id" } },
    contents: { twoColumnBrowseResultsRenderer: { tabs: [{ tabRenderer: {
      selected: true, content: { richGridRenderer: { contents: entries } },
    } }] } },
  };
  return run_html(t, "<script>var ytInitialData = " + JSON.stringify(data) + ";</script>");
}

const video_id = index => "v" + String(index).padStart(10, "0");
const modern_video = (index, parts) => ({ lockupViewModel: {
  contentId: video_id(index), contentType: "LOCKUP_CONTENT_TYPE_VIDEO",
  metadata: { lockupMetadataViewModel: {
    title: { content: "视频 " + index },
    metadata: { contentMetadataViewModel: { metadataRows: [{ metadataParts: parts }] } },
  } },
} });

test("YouTube QuickJS 将简繁中文和英文相对时间估算为时间戳，按时间排序且同步 feed.updated", async t => {
  const cases = [
    ["2 years ago", 2 * 365 * 86400], ["3 months ago", 90 * 86400],
    ["1 week ago", 7 * 86400], ["Streamed 2 days ago", 2 * 86400],
    ["Premiered 1 hour ago", 3600], ["3 minutes ago", 180], ["2 seconds ago", 2],
    ["1年前", 365 * 86400], ["2个月前", 60 * 86400], ["3 個月前", 90 * 86400],
    ["4周前", 28 * 86400], ["2 週前", 14 * 86400], ["4天前", 4 * 86400],
    ["直播时间：3小时前", 3 * 3600], ["首播時間：2 小時前", 2 * 3600],
    ["5分钟前", 300], ["6 分鐘前", 360], ["7秒前", 7], ["8 秒鐘前", 8],
    ["刚刚", 0], ["剛剛", 0], ["just now", 0],
  ];
  const entries = cases.map(([label], index) => modern_video(index, [
    { text: { content: "34万次观看" } },
    { text: { content: label }, accessibilityLabel: "视频发布时间" },
  ]));
  const { feed, before, after } = await run_feed(t, entries);
  assert.equal(feed.items.length, cases.length);
  const timestamps = [];
  for (const [index, [label, seconds]] of cases.entries()) {
    const item = feed.items.find(item => item.id === "youtube:video:" + video_id(index));
    const timestamp = Date.parse(item.published);
    assert.ok(timestamp >= before - seconds * 1000 && timestamp <= after - seconds * 1000, label);
    timestamps.push(timestamp + seconds * 1000);
  }
  assert.equal(new Set(timestamps).size, 1, "整页使用同一个抓取时间基准");
  const expected_order = cases.map(([, seconds], index) => ({ seconds, index }))
    .sort((a, b) => a.seconds - b.seconds).map(({ index }) => "youtube:video:" + video_id(index));
  assert.deepEqual(feed.items.map(item => item.id), expected_order);
  assert.equal(feed.updated, feed.items[0].published);
  for (const format of ["rss", "atom"]) {
    const xml = FeedModel.fromValue(feed).render(format);
    assert.doesNotMatch(xml, /Invalid Date|NaN/);
    assert.ok(xml.includes(format === "rss" ? "<pubDate>" : "<published>"));
  }
});

test("YouTube 同时解析现代 accessibilityLabel、旧版 videoRenderer 和 gridVideoRenderer", async t => {
  const { feed, before, after } = await run_feed(t, [
    { videoRenderer: { videoId: video_id(0), title: { simpleText: "旧版" }, publishedTimeText: { simpleText: "3天前" } } },
    modern_video(1, [{ text: { content: "发布时间" }, accessibilityLabel: "Streamed 2 hours ago" }]),
    { gridVideoRenderer: { videoId: video_id(2), title: { simpleText: "网格" }, publishedTimeText: { runs: [{ text: "1 minute ago" }] } } },
  ]);
  assert.deepEqual(feed.items.map(item => item.id), [2, 1, 0].map(index => "youtube:video:" + video_id(index)));
  for (const [index, seconds] of [60, 7200, 259200].entries()) {
    const timestamp = Date.parse(feed.items[index].published);
    assert.ok(timestamp >= before - seconds * 1000 && timestamp <= after - seconds * 1000);
  }
});

test("YouTube 不把观看量、未来预告或旧版简介当作发布时间，缺失时间的条目排在末尾", async t => {
  const invalid_labels = ["34万次观看", "", "直播中", "Premieres in 2 days", "2天后", "-2天前", "1.5天前", "999999999999999999999 years ago"];
  const entries = invalid_labels.map((label, index) => modern_video(index, [{ text: { content: label } }]));
  entries.push({ videoRenderer: {
    videoId: video_id(8), title: { simpleText: "简介含相对时间" }, descriptionSnippet: { simpleText: "2 days ago" },
  } });
  entries.push(modern_video(9, [{ text: { content: "2 days ago" } }]));
  const { feed } = await run_feed(t, entries);
  assert.equal(feed.items[0].id, "youtube:video:" + video_id(9));
  assert.ok(feed.items.slice(1).every(item => item.published === undefined));
  assert.equal(feed.updated, feed.items[0].published);
});

test("YouTube 空列表不生成更新时间", async t => {
  const { feed } = await run_feed(t, []);
  assert.deepEqual(feed.items, []);
  assert.equal(feed.updated, undefined);
});

test("YouTube 原有频道页面样本的 4天前 生成可排序的发布时间", async t => {
  const fixtures = JSON.parse(await readFile(new URL("./fixtures/script_migration.json", import.meta.url)));
  const fixture = fixtures.find(fixture => fixture.file === "youtube");
  const { feed, before, after } = await run_html(t, fixture.responses[0].body);
  assert.deepEqual(feed.items.map(item => item.id), fixture.expected_ids);
  const timestamp = Date.parse(feed.items[0].published);
  assert.ok(timestamp >= before - 4 * 86400000 && timestamp <= after - 4 * 86400000);
  assert.equal(feed.updated, feed.items[0].published);
});
