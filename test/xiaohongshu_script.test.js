import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { register } from 'node:module';
import { ScriptCookieAccess } from '../server/infra/script_cookie_access.js';
import { FeedModel } from '../server/domain/feed_format.js';
import { XMLParser } from 'fast-xml-parser';

register('./support/quickjs_wasm_hook.js', import.meta.url);
const { compile_script_module, execute_script } = await import('../server/infra/script_sandbox.js');
const source = await readFile(new URL('../examples/scripts/rss/xiaohongshu.js', import.meta.url), 'utf8');
const compiled = await compile_script_module(source);
assert.equal(compiled.error, '');
// 261016 主页卡片、260819 图文详情、260614 视频详情；仅保留相关结构，替换地址和访问令牌。
const fixture = JSON.parse(await readFile(new URL('./fixtures/xiaohongshu_notes.json', import.meta.url), 'utf8'));
const uid = '5a13b53b4eacab190f3d0667';
const link = 'https://www.xiaohongshu.com/user/profile/' + uid;
const state_html = state => '<script>window.__INITIAL_STATE__=' + JSON.stringify(state).replace(/</g, '\\u003c') + ';</script>';
const detail_html = note => state_html({ note: { noteDetailMap: { [note.noteId]: { note } } } });
const run = (query = {}) => execute_script(source, compiled.metadata, null, {
  method: 'GET', pathname: '/xiaohongshu/user/profile/' + uid,
  params: { uid }, query,
}, [], '', new ScriptCookieAccess({
  permissions: compiled.metadata.permissions, assert_grant() {},
  cookies: () => [{ name: 'web_session', value: 'fixture-session', domain: '.xiaohongshu.com', path: '/', secure: true }],
}));

test('小红书笔记将 time 毫秒时间戳输出为 RSS/Atom 发布时间，缺失时间不补日期', async t => {
  assert.equal(compiled.metadata.routes[0].path, '/xiaohongshu/user/profile/:uid');
  assert.equal(compiled.metadata.routes[0].example, '/xiaohongshu/user/profile/5d2aec020000000012037401');
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  const times = [1791916160000, undefined, 1792080550000];
  const notes = times.map((time, index) => ({ noteCard: {
    noteId: String(index + 1).padStart(24, '0'), displayTitle: '笔记 ' + index, time,
  } }));
  globalThis.fetch = async url => {
    if (url === link) return new Response(state_html({ user: {
      userPageData: { basicInfo: { nickname: '博主' } }, notes: [notes],
    } }));
    const card = notes.find(entry => url.includes(entry.noteCard.noteId)).noteCard;
    const note = { ...fixture.details[0], noteId: card.noteId };
    delete note.time;
    return new Response(detail_html(note));
  };
  const result = await run({ full_content: 'true' });
  const feed = JSON.parse(result.output);
  assert.deepEqual(feed.items.map(item => item.published), [
    new Date(times[2]).toISOString(), new Date(times[0]).toISOString(), undefined,
  ]);
  assert.equal(feed.items[0].id, 'xiaohongshu:note:' + notes[2].noteCard.noteId);
  assert.equal(feed.updated, feed.items[0].published);
  const model = FeedModel(feed);
  const rss = model.render('rss');
  const atom = model.render('atom');
  assert.equal((rss.match(/<pubDate>/g) || []).length, 2);
  assert.equal((atom.match(/<published>/g) || []).length, 2);
  for (const time of [times[0], times[2]]) {
    assert.ok(rss.includes('<pubDate>' + new Date(time).toUTCString() + '</pubDate>'));
    assert.ok(atom.includes('<published>' + new Date(time).toISOString() + '</published>'));
  }
});

test('小红书 261016 的 30 张卡片逐条携带令牌和授权 Cookie 请求详情，完整输出图集和视频', async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  const notes = fixture.user.notes.flat();
  assert.equal(notes.length, 30);
  assert.equal(notes.filter(entry => entry.noteCard.type === 'video').length, 15);
  assert.ok(notes.every(entry => !entry.noteCard.desc && !entry.noteCard.imageList));
  const user = structuredClone(fixture.user);
  user.notes.push([user.notes[0][0]]); // 重复卡片不能重复请求或输出。
  const details = new Map(notes.map(entry => [entry.id, {
    ...structuredClone(fixture.details[entry.noteCard.type === 'video' ? 1 : 0]),
    noteId: entry.id, time: entry.noteCard.time,
  }]));
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push(url);
    assert.equal(options.headers.Cookie, 'web_session=fixture-session');
    assert.match(options.headers['user-agent'], /Chrome\/154/);
    if (url === link) return new Response(state_html({ user }));
    const parsed = new URL(url);
    assert.equal(parsed.origin, 'https://www.xiaohongshu.com');
    assert.equal(parsed.searchParams.get('xsec_token'), 'fixture-token-+/=');
    assert.equal(parsed.searchParams.get('xsec_source'), 'pc_user');
    assert.equal(options.headers.referer, link);
    const id = parsed.pathname.slice('/explore/'.length);
    assert.ok(details.has(id));
    return new Response(detail_html(details.get(id)));
  };
  const result = await run({ full_content: 'true' });
  const feed = JSON.parse(result.output);
  assert.equal(feed.kind, 'rss');
  assert.equal(feed.items.length, 30);
  assert.equal(calls.length, 31);
  assert.equal(new Set(calls).size, 31);
  const model = FeedModel(feed);
  const parser = new XMLParser({ ignoreAttributes: false });
  const rss = parser.parse(model.render('rss')).rss.channel.item;
  const atom = parser.parse(model.render('atom')).feed.entry;
  assert.equal(rss.length, 30);
  assert.equal(atom.length, 30);
  for (const item of feed.items) {
    const note = details.get(item.id.slice('xiaohongshu:note:'.length));
    assert.equal(item.title, note.title);
    assert.equal(item.description, note.desc);
    assert.equal(item.published, new Date(note.time).toISOString());
    const rss_item = rss.find(value => value.link === item.link);
    const atom_item = atom.find(value => value.id === item.id);
    assert.equal(rss_item['content:encoded'], item.content);
    assert.equal(atom_item.content['#text'], item.content);
    const images = note.imageList.map(image => image.infoList.find(info => info.imageScene === 'WB_DFT').url.replace(/^http:/, 'https:'));
    assert.equal(item.image, images[0]);
    if (note.type === 'video') {
      const video = note.video.media.stream.h264[0].masterUrl.replace(/^http:/, 'https:');
      assert.equal(item.type, 'video');
      assert.equal(item.enclosure.url, video);
      assert.equal(item.enclosure.type, 'video/mp4');
      assert.ok(item.content.includes('<video controls'));
      assert.ok(item.content.includes('poster="' + images[0] + '"'));
      assert.ok(item.content.includes(video.replace(/&/g, '&amp;')));
      assert.equal(rss_item.enclosure['@_url'], video);
      assert.ok(atom_item.link.some(value => value['@_rel'] === 'enclosure' && value['@_url'] === video));
    } else {
      assert.equal(item.type, 'gallery');
      assert.deepEqual(item.images, images);
      assert.equal((item.content.match(/<img /g) || []).length, 2);
      assert.equal(item.enclosure, undefined);
      for (const image of images) {
        assert.ok(item.content.includes(image));
        assert.ok(rss_item['media:content'].some(value => value['@_url'] === image));
        assert.ok(atom_item['media:content'].some(value => value['@_url'] === image));
      }
    }
  }
  assert.ok(!JSON.stringify(result).includes('fixture-session'));
});

test('小红书优先选择高清 H.264 MP4、支持备用地址，正文与媒体属性安全转义', async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  const note = structuredClone(fixture.details[1]);
  note.desc = '<script>alert("caption")</script> & text\nnext line undefined';
  note.video.media.stream.h264 = [
    { masterUrl: 'https://sns-video-v2.xhscdn.com/low.mp4', width: 320, height: 180 },
    { masterUrl: 'javascript:alert(1)', width: 9000, height: 9000 },
    { masterUrl: 'https://sns-video-v2.xhscdn.com/video.m3u8', format: 'm3u8', width: 9000, height: 9000 },
    { masterUrl: '', backupUrls: ['javascript:alert(1)', 'http://sns-video-v2.xhscdn.com/hd.mp4?x=1&y="2"'], width: 1920, height: 1080 },
  ];
  note.video.media.stream.h265 = [{ masterUrl: 'https://sns-video-v2.xhscdn.com/hevc.mp4', width: 3840, height: 2160 }];
  globalThis.fetch = async url => new Response(url === link ? state_html({ user: {
    userPageData: { basicInfo: { nickname: '作者' } },
    notes: [[{ noteCard: { noteId: note.noteId, time: 1 } }]],
  } }) : detail_html(note));
  const feed = JSON.parse((await run({ full_content: '1' })).output);
  const item = feed.items[0];
  assert.equal(item.published, new Date(note.time).toISOString());
  assert.equal(item.description, note.desc);
  assert.ok(item.content.includes('&lt;script&gt;alert(&quot;caption&quot;)&lt;/script&gt; &amp; text<br>next line undefined'));
  assert.ok(item.content.includes('hd.mp4?x=1&amp;y=&quot;2&quot;'));
  assert.ok(!item.content.includes('<script>'));
});

test('小红书详情登录验证、ID 不匹配、媒体不全和 HTTP 错误不会退回封面摘要', async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  const note = structuredClone(fixture.details[1]);
  const user = { userPageData: { basicInfo: { nickname: '作者' } }, notes: [
    [{ noteCard: { noteId: note.noteId, displayTitle: '列表标题', cover: note.imageList[0] } }],
  ] };
  const mismatch = { ...note, noteId: '000000000000000000000001' };
  const no_body = { ...note };
  delete no_body.desc;
  const cases = [
    { body: '<html>请登录或完成验证</html>', code: 'UPSTREAM_INVALID_RESPONSE' },
    { body: detail_html(mismatch), code: 'UPSTREAM_INVALID_RESPONSE' },
    { body: detail_html(no_body), code: 'UPSTREAM_INVALID_RESPONSE' },
    { body: detail_html({ ...note, video: {} }), code: 'UPSTREAM_INVALID_RESPONSE' },
    { body: detail_html({ ...note, type: 'normal', imageList: [] }), code: 'UPSTREAM_INVALID_RESPONSE' },
    { body: detail_html({ ...note, type: 'normal', imageList: [{ url: 'javascript:alert(1)' }] }), code: 'UPSTREAM_INVALID_RESPONSE' },
    { body: 'denied', status: 403, code: 'UPSTREAM_ACCESS_DENIED' },
  ];
  for (const value of cases) {
    globalThis.fetch = async url => new Response(url === link ? state_html({ user }) : value.body,
      { status: url === link ? 200 : value.status || 200 });
    await assert.rejects(run({ full_content: 'true' }), error => {
      assert.equal(error.problem.code, value.code);
      if (!value.status) assert.match(error.problem.error, /详情/);
      return true;
    });
  }
});

test('小红书默认及关闭 full_content 时只请求主页，保留首屏标题、封面和时间', async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  const calls = [];
  globalThis.fetch = async url => {
    calls.push(url);
    assert.equal(url, link);
    return new Response(state_html({ user: fixture.user }));
  };
  for (const query of [{}, { full_content: 'false' }, { full_content: '0' }, { full_content: '' }]) {
    calls.length = 0;
    const feed = JSON.parse((await run(query)).output);
    assert.equal(feed.items.length, 30);
    assert.deepEqual(calls, [link]);
    for (const item of feed.items) {
      const card = fixture.user.notes.flat().find(entry => item.id === 'xiaohongshu:note:' + entry.id).noteCard;
      assert.equal(item.title, card.displayTitle.trim());
      assert.equal(item.description, card.displayTitle);
      assert.equal(item.published, new Date(card.time).toISOString());
      assert.equal(item.image, card.cover.urlDefault.replace(/^http:/, 'https:'));
      assert.equal(item.enclosure, undefined);
      assert.ok(!item.content);
      assert.ok(!item.images?.length);
    }
  }
});
