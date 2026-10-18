import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { register } from 'node:module';
import { ScriptCookieAccess } from '../server/infra/script_cookie_access.js';
import { FeedModel } from '../server/domain/feed_format.js';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { create_feed_parser } from '@findrss/feed-fetch';

register('./support/quickjs_wasm_hook.js', import.meta.url);
const { compile_script_module, execute_script } = await import('../server/infra/script_sandbox.js');
const source = await readFile(new URL('../examples/scripts/rss/weibo.js', import.meta.url), 'utf8');
const compiled = await compile_script_module(source);
assert.equal(compiled.error, '');
const run = () => execute_script(source, { ...compiled.metadata, ...compiled.metadata.routes[0] }, null, {
  method: 'GET', pathname: '/weibo/u/123', params: { uid: '123' }, query: {}, public_origin: 'https://feeds.example',
}, [], '', new ScriptCookieAccess({ permissions: compiled.metadata.permissions, assert_grant() {}, cookies: () => [] }));
const status = (id, text, extra = {}) => ({ idstr: id, mblogid: 'B' + id, text_raw: text,
  created_at: 'Sat Oct 17 01:00:00 +0800 2026', user: { idstr: '456', screen_name: '原作者' }, ...extra });
const html = statuses => '<script type="application/json">' + JSON.stringify(statuses) + '</script>';
const proxy = url => 'https://feeds.example/img/weibo?url=' + encodeURIComponent(url.replace('/large/', '/orj360/'));

test('微博转发、回复和多层引用独立保留正文、作者、链接及代理后的媒体', async t => {
  const saved = globalThis.fetch;
  t.after(() => { globalThis.fetch = saved; });
  const original = status('100', '原微博[月亮]', {
    pics: [{ url: 'https://wx1.sinaimg.cn/large/original.jpg' }],
    page_info: { type: 'video', media_info: { stream_url_hd: 'https://video.example/original.mp4' } },
    retweeted_status: status('90', '更早的原帖'),
  });
  const calls = [];
  globalThis.fetch = async url => {
    calls.push(url);
    return new Response(url.includes('/ajax/profile/') ? '{}' : html([
      status('200', '我的转发说明', { user: { idstr: '123', screen_name: '转发者' }, pics: [{ url: 'https://wx1.sinaimg.cn/large/own.jpg' }], retweeted_status: original }),
      status('201', '我的回复', { in_reply_to_status_idstr: '100' }),
    ]));
  };
  const feed = JSON.parse((await run()).output);
  assert.equal(calls.length, 2, '列表内嵌的原微博可以直接复用');
  assert.equal(feed.items.length, 2);
  const repost = feed.items[0], reply = feed.items[1];
  assert.equal(repost.kind, 'repost');
  assert.equal(repost.description, '我的转发说明');
  assert.doesNotMatch(repost.content, /原微博|blockquote/);
  assert.equal(repost.enclosure, undefined);
  assert.deepEqual(repost.images, [proxy('https://wx1.sinaimg.cn/large/own.jpg')]);
  assert.equal(repost.link, 'https://weibo.com/123/B200');
  for (const item of [repost, reply]) {
    const ref = item.references[0];
    assert.equal(ref.id, '100');
    assert.equal(ref.link, 'https://weibo.com/456/B100');
    assert.equal(ref.item.author, '原作者');
    assert.equal(ref.item.enclosure.url, 'https://video.example/original.mp4');
    assert.deepEqual(ref.item.images, [proxy('https://wx1.sinaimg.cn/large/original.jpg')]);
    assert.match(ref.item.content, /原微博/);
    assert.match(ref.item.content, /img\/weibo\?url=/);
    assert.equal(ref.item.published, '2026-10-16T17:00:00.000Z');
    assert.equal(ref.item.references[0].item.description, '更早的原帖');
  }
  assert.equal(reply.kind, 'reply');
  for (const format of ['rss', 'atom']) {
    const xml = FeedModel(feed).render(format);
    assert.equal(XMLValidator.validate(xml), true);
    const parsed = create_feed_parser(XMLParser, XMLValidator).parse_feed_document(xml, 'https://feeds.example/feed');
    assert.equal(parsed.articles.length, 2);
    assert.equal(parsed.articles[0].references[0].item.summary, '原微博[月亮]');
    assert.equal(parsed.articles[0].video_url, '');
  }
});

test('微博原帖详情按 ID 去重查询，查询失败和明确已删除的原微博保留引用', async t => {
  const saved = globalThis.fetch;
  t.after(() => { globalThis.fetch = saved; });
  const calls = [];
  globalThis.fetch = async url => {
    calls.push(url);
    if (url.includes('/ajax/profile/')) return new Response('{}');
    if (url.includes('/ajax/statuses/show?')) return url.endsWith('100')
      ? Response.json(status('100', '补取原微博')) : new Response('denied', { status: 403 });
    return new Response(html([
      status('200', '回复一', { in_reply_to_status_idstr: '100' }),
      status('201', '回复二', { in_reply_to_status_idstr: '100' }),
      status('202', '原帖不可访问', { retweeted_status_idstr: '999' }),
      status('203', '再次引用', { retweeted_status_idstr: '999' }),
      status('204', '已删除', { retweeted_status: { idstr: '888', deleted: true } }),
    ]));
  };
  const feed = JSON.parse((await run()).output);
  assert.equal(calls.filter(url => url.includes('/ajax/statuses/show?')).length, 2);
  assert.equal(feed.items[1].references[0].item.description, '补取原微博');
  assert.equal(feed.items[2].references[0].link, 'https://weibo.com/detail/999');
  assert.equal(feed.items[2].references[0].item, undefined);
  assert.equal(feed.items[4].references[0].unavailable, true);
  assert.equal(feed.items[4].references[0].id, '888');
});

test('微博缺失原帖有查询预算，字段不完整的原帖不误标为删除', async t => {
  const saved = globalThis.fetch;
  t.after(() => { globalThis.fetch = saved; });
  let queries = 0;
  globalThis.fetch = async url => {
    if (url.includes('/ajax/profile/')) return new Response('{}');
    if (url.includes('/ajax/statuses/show?')) { queries++; return Response.json({ ok: 0 }); }
    return new Response(html(Array.from({ length: 10 }, (_, i) => status(String(200 + i), '转发', {
      retweeted_status: { idstr: String(100 + i) },
    }))));
  };
  const feed = JSON.parse((await run()).output);
  assert.equal(queries, 8);
  assert.equal(feed.items.length, 10);
  for (const item of feed.items) {
    assert.equal(item.kind, 'repost');
    assert.equal(item.references[0].item, undefined);
    assert.equal(item.references[0].unavailable, undefined);
  }
});

test('微博旧 HTML 转发卡片直接返回原微博子项，各自链接与时间不串位', async t => {
  const saved = globalThis.fetch;
  t.after(() => { globalThis.fetch = saved; });
  globalThis.fetch = async url => new Response(url.includes('/ajax/profile/') ? '{}' : `
<div action-type="feed_list_item" mid="200">
  <div node-type="feed_list_content">我的转发说明</div>
  <div node-type="feed_list_forwardContent" action-data="omid=100">
    <a href="/u/456" usercard="id=456" nick-name="原作者">原作者</a>
    <div node-type="feed_list_reason">原微博正文<img src="https://face.t.sinajs.cn/emoji.png" alt="[月亮]"></div>
    <img src="https://wx1.sinaimg.cn/large/original.jpg">
    <a href="/456/B100" date="1792198800000">昨天</a>
  </div>
  <a href="/123/B200" date="1792285200000">今天</a>
</div>`);
  const feed = JSON.parse((await run()).output);
  const item = feed.items[0], original = item.references[0].item;
  assert.equal(item.kind, 'repost');
  assert.equal(item.description, '我的转发说明');
  assert.equal(item.link, 'https://weibo.com/123/B200');
  assert.equal(item.published, new Date(1792285200000).toISOString());
  assert.equal(original.description, '原微博正文[月亮]');
  assert.equal(original.author, '原作者');
  assert.equal(original.link, 'https://weibo.com/456/B100');
  assert.equal(original.published, new Date(1792198800000).toISOString());
  assert.deepEqual(original.images, [proxy('https://wx1.sinaimg.cn/large/original.jpg')]);
});

test('微博引用保留独立原帖，回复、转发和引用可同时记录且不把提及当作引用', async t => {
  const saved = globalThis.fetch;
  t.after(() => { globalThis.fetch = saved; });
  const calls = [];
  const original = status('100', '引用原文', {
    pics: [{ url: 'https://wx1.sinaimg.cn/large/quoted.jpg' }],
  });
  globalThis.fetch = async url => {
    calls.push(url);
    return new Response(url.includes('/ajax/profile/') ? '{}' : html([
      status('200', '引用点评', { quoted_status: original }),
      status('201', '回复并引用', { in_reply_to_status_id_str: '100', quoted_status_idstr: '100' }),
      status('202', '转发并回复和引用', {
        retweeted_status_id_str: '100', reply_to_status_idstr: '100', quoted_status_id_str: '100',
      }),
      status('203', '@原作者 https://weibo.com/456/B100'),
    ]));
  };
  const feed = JSON.parse((await run()).output);
  assert.equal(calls.length, 2, '所有关系复用已有原帖');
  assert.deepEqual(feed.items.map(item => item.kind), ['quote', 'reply', 'repost', 'post']);
  assert.deepEqual(feed.items[1].references.map(ref => ref.relation), ['reply', 'quote']);
  assert.deepEqual(feed.items[2].references.map(ref => ref.relation), ['repost', 'reply', 'quote']);
  assert.equal(feed.items[3].references, undefined);
  for (const item of feed.items.slice(0, 3)) {
    assert.deepEqual(item.images, []);
    assert.doesNotMatch(item.content, /引用原文|quoted\.jpg/);
    for (const ref of item.references) {
      assert.equal(ref.id, '100');
      assert.equal(ref.item.author, '原作者');
      assert.equal(ref.item.description, '引用原文');
      assert.equal(ref.item.link, 'https://weibo.com/456/B100');
      assert.deepEqual(ref.item.images, [proxy('https://wx1.sinaimg.cn/large/quoted.jpg')]);
    }
  }
  for (const format of ['rss', 'atom']) {
    const xml = FeedModel(feed).render(format);
    assert.equal(XMLValidator.validate(xml), true);
    const parsed = create_feed_parser(XMLParser, XMLValidator).parse_feed_document(xml, 'https://feeds.example/feed');
    assert.equal(parsed.articles[0].kind, 'quote');
    assert.equal(parsed.articles[0].references[0].relation, 'quote');
    assert.equal(parsed.articles[0].references[0].item.summary, '引用原文');
    assert.deepEqual(parsed.articles[1].references.map(ref => ref.relation), ['reply', 'quote']);
  }
});

test('微博补取引用和回复原帖，用户信息占位不当作正文，已删除状态跨关系复用', async t => {
  const saved = globalThis.fetch;
  t.after(() => { globalThis.fetch = saved; });
  const calls = [];
  globalThis.fetch = async url => {
    calls.push(url);
    if (url.includes('/ajax/profile/')) return new Response('{}');
    if (url.includes('/ajax/statuses/show?')) {
      if (url.endsWith('100')) return Response.json({ data: status('100', '补取引用原文', { user: undefined }) });
      if (url.endsWith('101')) return Response.json({ idstr: '101', state: '7' });
      return new Response('denied', { status: 403 });
    }
    return new Response(html([
      status('200', '引用一', { quoted_status: { idstr: '100', user: { screen_name: '原作者' } } }),
      status('201', '回复同一帖', { reply_to_status_id: 100 }),
      status('202', '引用已删帖', { quoted_status_id: 101 }),
      status('203', '转发同一已删帖', { retweeted_status_idstr: '101' }),
      status('204', '已知删除', { quoted_status: { idstr: '102', deleted: true } }),
      status('205', '回复已知删除', { in_reply_to_status_id: 102 }),
      status('206', '不可访问', { quoted_status_idstr: '103' }),
      status('207', '重复引用不可访问帖', { quoted_status_idstr: '103' }),
    ]));
  };
  const feed = JSON.parse((await run()).output);
  assert.deepEqual(calls.filter(url => url.includes('/ajax/statuses/show?')).map(url => new URL(url).searchParams.get('id')), ['100', '101', '103']);
  for (const item of feed.items.slice(0, 2)) assert.equal(item.references[0].item.description, '补取引用原文');
  for (const item of feed.items.slice(2, 6)) {
    assert.equal(item.references[0].unavailable, true);
    assert.equal(item.references[0].item, undefined);
  }
  for (const item of feed.items.slice(6)) {
    assert.equal(item.references[0].link, 'https://weibo.com/detail/103');
    assert.equal(item.references[0].unavailable, undefined);
    assert.equal(item.references[0].item, undefined);
  }
});
