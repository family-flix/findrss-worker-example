import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";
import { DEFAULT_RSS_SCRIPT, DEFAULT_HOT_SCRIPT } from "../admin/pages/script.default.js";
import { FeedModel } from "../server/domain/feed_format.js";

register("./support/quickjs_wasm_hook.js", import.meta.url);
const { compile_script_module, execute_script } = await import("../server/infra/script_sandbox.js");

test("Hot 默认脚本读取百度 HTML 榜单，输出 rank/heat，非法榜单返回错误", async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  const compiled = await compile_script_module(DEFAULT_HOT_SCRIPT);
  assert.equal(compiled.error, "");
  assert.equal(compiled.metadata.path, "/baidu/hot");
  assert.equal(compiled.metadata.script_type, "hot");
  const title = '新闻 & "热榜"';
  const row = { card_title: title, index: "1", heat_score: "12345" };
  for (const html of [
    '<textarea id="hotsearch_data">' + JSON.stringify({ hotsearch: [row] }).replace(/&/g, "&amp;") + "</textarea>",
    '<li class="hotsearch-item" data-index="1"><span class="title-content-title">新闻 &amp; &quot;热榜&quot;</span></li>',
  ]) {
    globalThis.fetch = async url => { assert.equal(url, "https://www.baidu.com/"); return new Response(html); };
    const result = await execute_script(DEFAULT_HOT_SCRIPT, compiled.metadata);
    const snapshot = JSON.parse(result.output);
    assert.equal(snapshot.kind, "hot_rank");
    assert.equal(snapshot.entries[0].title, title);
    assert.equal(snapshot.entries[0].rank, 1);
    assert.equal(snapshot.entries[0].link, "https://www.baidu.com/s?wd=" + encodeURIComponent(title));
    assert.equal("items" in snapshot, false);
    assert.match(result.lines.map(line => line.text).join("\n"), /获取百度首页热榜[\s\S]*热榜快照完成/);
  }
  for (const html of ["<html>访问验证</html>", '<textarea id="hotsearch_data">{broken}</textarea>',
    '<textarea id="hotsearch_data">{"hotsearch":[]}</textarea>',
    '<textarea id="hotsearch_data">' + JSON.stringify({ hotsearch: [{ ...row, index: "bad" }] }) + "</textarea>"]) {
    globalThis.fetch = async () => new Response(html);
    await assert.rejects(execute_script(DEFAULT_HOT_SCRIPT, compiled.metadata), /百度/);
  }
});

test("RSS 默认脚本保留真实发布时间和正文，可渲染 RSS/Atom", async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  const compiled = await compile_script_module(DEFAULT_RSS_SCRIPT);
  assert.equal(compiled.error, "");
  assert.equal(compiled.metadata.script_type, "rss");
  globalThis.fetch = async url => {
    assert.equal(url, "https://www.solidot.org/index.rss");
    return new Response('<rss><channel><item><guid>article-1</guid><title>文章 &amp; 内容</title><link>https://www.solidot.org/story/1</link><pubDate>Wed, 14 Oct 2026 08:00:00 GMT</pubDate><content:encoded><![CDATA[<p>正文</p>]]></content:encoded></item></channel></rss>');
  };
  const result = await execute_script(DEFAULT_RSS_SCRIPT, compiled.metadata);
  const feed = JSON.parse(result.output);
  assert.equal(feed.items[0].published, "2026-10-14T08:00:00.000Z");
  assert.equal(feed.items[0].content, "<p>正文</p>");
  for (const format of ["rss", "atom"]) assert.match(FeedModel(feed).render(format), /文章 &amp; 内容/);
  assert.match(result.lines.map(line => line.text).join("\n"), /RSS 解析完成[\s\S]*RSS 内容完成/);
});
