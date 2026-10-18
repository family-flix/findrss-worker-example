import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { register } from 'node:module';
import { FeedModel } from '../server/domain/feed_format.js';
import { ScriptCookieAccess } from '../server/infra/script_cookie_access.js';
import { XMLParser } from 'fast-xml-parser';

register('./support/quickjs_wasm_hook.js', import.meta.url);
const { compile_script_module, execute_script } = await import('../server/infra/script_sandbox.js');
const source = await readFile(new URL('../examples/scripts/rss/instagram.js', import.meta.url), 'utf8');
const fixture = JSON.parse(await readFile(new URL('./fixtures/instagram_profile.json', import.meta.url), 'utf8'));
// 261016 的列表响应：保留媒体结构，替换 CDN 地址并移除请求凭据。
const media_fixture = JSON.parse(await readFile(new URL('./fixtures/instagram_media.json', import.meta.url), 'utf8'));
const connection = 'xdt_api__v1__feed__user_timeline_graphql_connection';
const context = { method: 'GET', pathname: '/instagram/rachelc00k', params: { username: '@RachelC00k' }, query: {} };
const link = 'https://www.instagram.com/rachelc00k/';
const profile = '<script type="application/json">["DTSGInitialData",[],{"token":"page-dtsg"}];["LSD",[],{"token":"page-lsd"}]</script>';
const cookies = ['sessionid', 'csrftoken'].map(name => ({ name, value: 'fixture-' + name, domain: '.instagram.com', path: '/', secure: true }));
const compiled = await compile_script_module(source);
assert.equal(compiled.error, '');
const access = () => new ScriptCookieAccess({ permissions: compiled.metadata.permissions, assert_grant() {}, cookies: () => cookies });
const run = (request = context, grant = access()) => execute_script(source, { ...compiled.metadata, debug: true }, null, request, [], '', grant);

test('Instagram 查询 GraphQL taken_at，按真实发布时间排序并生成 RSS/Atom 日期', async t => {
  assert.equal(compiled.metadata.kind, 'rss');
  assert.equal(compiled.metadata.routes[0].path, '/instagram/:username');
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    assert.equal(options.headers.Cookie, 'sessionid=fixture-sessionid; csrftoken=fixture-csrftoken');
    if (url === link) {
      assert.equal(options.method, 'GET');
      assert.match(options.headers['user-agent'], /iPhone/);
      assert.equal(options.headers.referer, link);
      return new Response(profile);
    }
    assert.equal(url, 'https://www.instagram.com/graphql/query');
    assert.equal(options.method, 'POST');
    assert.equal(options.headers['x-csrftoken'], 'fixture-csrftoken');
    assert.equal(options.headers['x-ig-app-id'], '936619743392459');
    assert.equal(options.headers['x-fb-friendly-name'], 'PolarisProfilePostsQuery');
    const form = new URLSearchParams(options.body);
    assert.equal(form.get('doc_id'), '28834890909485062');
    assert.equal(form.get('fb_dtsg'), 'page-dtsg');
    assert.equal(form.get('lsd'), 'page-lsd');
    assert.equal(form.get('__a'), '1');
    assert.equal(form.get('jazoest'), '2' + [...'page-dtsg'].reduce((sum, char) => sum + char.charCodeAt(0), 0));
    const variables = JSON.parse(form.get('variables'));
    assert.equal(variables.username, 'rachelc00k');
    assert.equal(variables.data.count, 12);
    return Response.json(fixture);
  };
  const result = await run();
  const feed = JSON.parse(result.output);
  const expected = fixture.data[connection].edges.map(entry => entry.node).sort((a, b) => b.taken_at - a.taken_at);
  assert.equal(calls.length, 2);
  assert.equal(feed.kind, 'rss');
  assert.equal('entries' in feed, false);
  assert.deepEqual(feed.items.map(item => item.id), expected.map(node => 'instagram:post:' + node.pk));
  const model = FeedModel(feed);
  const rss = model.render('rss');
  const atom = model.render('atom');
  for (const [index, item] of feed.items.entries()) {
    const node = expected[index];
    assert.equal(item.published, new Date(node.taken_at * 1000).toISOString());
    assert.equal(item.description, node.caption.text);
    assert.equal(item.image, node.image_versions2.candidates[0].url);
    assert.equal(item.link, 'https://www.instagram.com/p/' + node.code + '/');
    assert.equal(item.author.name, node.user.full_name);
    assert.ok(rss.includes('<pubDate>' + new Date(node.taken_at * 1000).toUTCString() + '</pubDate>'));
    assert.ok(atom.includes('<published>' + item.published + '</published>'));
  }
  assert.equal(feed.updated, feed.items[0].published);
  assert.ok(!JSON.stringify(result).includes('fixture-sessionid'));
  assert.ok(!JSON.stringify(result).includes('fixture-csrftoken'));
});

test('Instagram 日期缺失时不使用 caption.created_at 或抓取时间代替，空列表仍输出 RSS', async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  const response = structuredClone(fixture);
  delete response.data[connection].edges[0].node.taken_at;
  globalThis.fetch = async url => url === link ? new Response(profile) : Response.json(response);
  const feed = JSON.parse((await run()).output);
  assert.equal(feed.items.at(-1).id, 'instagram:post:' + fixture.data[connection].edges[0].node.pk);
  assert.equal(feed.items.at(-1).published, undefined);
  response.data[connection].edges = [];
  const empty = JSON.parse((await run()).output);
  assert.equal(empty.kind, 'rss');
  assert.deepEqual(empty.items, []);
});

test('Instagram 261016 列表的 7 个视频和 5 个完整图集直接生成 RSS/Atom，无需逐条请求', async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  const calls = [];
  globalThis.fetch = async url => {
    calls.push(url);
    assert.ok(url === link || url === 'https://www.instagram.com/graphql/query');
    return url === link ? new Response(profile) : Response.json(media_fixture);
  };
  const feed = JSON.parse((await run()).output);
  assert.equal(calls.length, 2);
  assert.equal(feed.items.length, 12);
  // 原始列表第六条（除前三条置顶后为第三条）按真实发布时间排在第九条，不能丢失。
  const relocated = 'https://www.instagram.com/p/DcqyOKLyUnt/';
  assert.equal(media_fixture.data[connection].edges[5].node.code, 'DcqyOKLyUnt');
  assert.equal(feed.items.findIndex(item => item.link === relocated), 8);
  const nodes = media_fixture.data[connection].edges.map(entry => entry.node);
  assert.equal(nodes.filter(node => node.media_type === 2).length, 7);
  assert.deepEqual(nodes.filter(node => node.media_type === 8).map(node => node.carousel_media_count), [3, 4, 4, 4, 7]);
  const model = FeedModel(feed);
  const parser = new XMLParser({ ignoreAttributes: false });
  const rss_items = parser.parse(model.render('rss')).rss.channel.item;
  const atom_items = parser.parse(model.render('atom')).feed.entry;
  assert.equal(rss_items.length, 12);
  assert.equal(atom_items.length, 12);
  assert.equal(rss_items[8].link, relocated);
  assert.equal(atom_items[8].id, 'instagram:post:3975210496441272813');
  for (const item of feed.items) {
    const node = nodes.find(node => item.id === 'instagram:post:' + node.pk);
    assert.equal(item.description, node.caption.text);
    const rss = rss_items.find(value => value.link === item.link);
    const atom = atom_items.find(value => value.id === item.id);
    assert.equal(rss['content:encoded'], item.content);
    assert.equal(atom.content['#text'], item.content);
    if (node.media_type === 8) {
      const images = node.carousel_media.map(child => child.image_versions2.candidates[0].url);
      assert.equal(images.length, node.carousel_media_count);
      assert.equal(item.type, 'gallery');
      assert.deepEqual(item.images, images);
      assert.equal((item.content.match(/<img /g) || []).length, images.length);
      assert.equal(item.enclosure, undefined);
      for (const image of images) {
        assert.ok(item.content.includes(image));
        assert.ok(rss['media:content'].some(media => media['@_url'] === image && media['@_medium'] === 'image'));
        assert.ok(atom['media:content'].some(media => media['@_url'] === image && media['@_medium'] === 'image'));
      }
    } else {
      assert.equal(item.type, 'video');
      assert.equal(item.enclosure.url, node.video_versions[0].url);
      assert.equal(item.enclosure.type, 'video/mp4');
      assert.ok(item.content.includes('<video controls'));
      assert.ok(item.content.includes('poster="' + item.image + '"'));
      assert.ok(item.content.includes('src="' + item.enclosure.url + '"'));
      assert.equal(rss.enclosure['@_url'], item.enclosure.url);
      assert.ok(atom.link.some(value => value['@_rel'] === 'enclosure' && value['@_url'] === item.enclosure.url));
    }
  }
});

test('Instagram 混合图集保留图片与多个视频顺序，选择有效高清地址并转义正文', async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  const node = structuredClone(media_fixture.data[connection].edges.find(entry => entry.node.media_type === 8).node);
  const photo = structuredClone(node.carousel_media[0]);
  const video = structuredClone(media_fixture.data[connection].edges[0].node);
  const caption = '<script>alert("caption")</script> & text\nnext line';
  node.caption.text = caption;
  photo.caption = null;
  photo.accessibility_caption = '" onerror="alert(1)';
  photo.image_versions2.candidates.unshift({ url: 'https://untrusted.example/image.jpg', width: 9000, height: 9000 });
  video.caption = { text: 'child <caption>' };
  video.video_versions = [
    { url: 'https://untrusted.example/video.mp4', width: 9000, height: 9000 },
    { url: 'javascript:alert(1)', width: 9000, height: 9000 },
    { url: 'https://cdninstagram.com/small.mp4', width: 320, height: 180 },
    { url: 'https://cdninstagram.com/large.mp4?x=1&y=2', width: 1920, height: 1080 },
  ];
  const second_video = { ...video, video_versions: [{ url: 'https://cdninstagram.com/second.mp4' }] };
  node.carousel_media = [photo, video, second_video];
  node.carousel_media_count = 3;
  globalThis.fetch = async url => url === link ? new Response(profile) : Response.json({ data: { [connection]: { edges: [{ node }] } } });
  const item = JSON.parse((await run()).output).items[0];
  assert.equal(item.description, caption);
  assert.deepEqual(item.images, [photo.image_versions2.candidates[1].url]);
  assert.equal(item.enclosure.url, 'https://cdninstagram.com/large.mp4?x=1&y=2');
  assert.ok(item.content.startsWith('<p>&lt;script&gt;'));
  assert.ok(item.content.includes('<br>next line</p>'));
  assert.ok(item.content.includes('child &lt;caption&gt;'));
  assert.ok(item.content.includes('alt="&quot; onerror=&quot;alert(1)"'));
  assert.ok(item.content.includes('large.mp4?x=1&amp;y=2'));
  assert.equal((item.content.match(/<video /g) || []).length, 2);
  assert.ok(item.content.indexOf('<img ') < item.content.indexOf('<video '));
  assert.ok(item.content.indexOf('large.mp4') < item.content.indexOf('second.mp4'));
  assert.ok(!item.content.includes('untrusted.example'));
  assert.ok(!item.content.includes('javascript:'));
});

test('Instagram 校验参数及授权，保留 HTTP、GraphQL、登录页和页面参数错误', async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response(''); };
  await assert.rejects(run({ ...context, params: { username: '../accounts' } }), /username 必须/);
  await assert.rejects(run(context, null), /Cookie 权限/);
  assert.equal(calls, 0);
  await assert.rejects(run(), /缺少查询参数/);
  for (const response of [
    () => new Response('', { status: 429 }),
    () => Response.json({ errors: [{ message: 'Login required' }] }),
    () => new Response('for (;;);' + JSON.stringify({ error: 1357004 })),
    () => new Response('<html>Login</html>'),
  ]) {
    globalThis.fetch = async url => url === link ? new Response(profile) : response();
    await assert.rejects(run(), /HTTP 429|作品查询失败|未返回 JSON/);
  }
});
