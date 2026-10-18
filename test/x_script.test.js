import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { register } from 'node:module';
import { ScriptCookieAccess } from '../server/infra/script_cookie_access.js';

register('./support/quickjs_wasm_hook.js', import.meta.url);
const { compile_script_module, execute_script } = await import('../server/infra/script_sandbox.js');
const source = await readFile(new URL('../examples/scripts/rss/x.js', import.meta.url), 'utf8');
const profile = JSON.parse(await readFile(new URL('./fixtures/x_profile.json', import.meta.url), 'utf8'));
const legacy = JSON.parse(await readFile(new URL('./fixtures/script_migration.json', import.meta.url), 'utf8')).find(row => row.file === 'x');
const compiled = await compile_script_module(source);
assert.equal(compiled.error, '');
const run = (username = 'NTCGoK9jFQURsEu') => execute_script(source, compiled.metadata, null, {
  method: 'GET', pathname: '/x/' + username, params: { username }, query: {},
}, [], '', new ScriptCookieAccess({ permissions: compiled.metadata.permissions, assert_grant() {}, cookies: () => [] }));
const stream = data => '<script>kind:"Result.Ok",value:' + JSON.stringify(JSON.stringify(data)) + '</script>';

test('X 新版真实页面从含 NUL 的流式数据读取正文、时间和视频，无需加载客户端脚本', async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  const html = '<script src="' + profile.script_url + '"></script>' + profile.scripts.map(body => '<script>' + body + '</script>').join('');
  assert.ok(html.includes('\0'));
  const calls = [];
  globalThis.fetch = async url => { calls.push(url); return new Response(html); };
  const feed = JSON.parse((await run()).output);
  assert.deepEqual(calls, ['https://x.com/NTCGoK9jFQURsEu']);
  assert.equal(feed.id, 'x:user:1452097352735477762');
  assert.equal(feed.title, 'K-pop GIF Archive 的 X 作品');
  assert.match(feed.description, /English/);
  assert.match(feed.image, /^https:\/\/pbs\.twimg\.com\//);
  assert.equal(feed.items.length, 5);
  assert.equal(feed.items[0].id, 'x:tweet:2110732449550602384');
  assert.equal(feed.items[0].published, new Date(1792072806000).toISOString());
  assert.match(feed.items[0].description, /^#Sakura/);
  assert.match(feed.items[0].enclosure.url, /1080x1920\/W1nwFx6nOqrn80rE\.mp4/);
  assert.equal(feed.updated, feed.items[0].published);
});

test('X 保留旧版 main.js、UserByScreenName 和 UserTweets 流程', async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  const calls = [];
  globalThis.fetch = async url => {
    calls.push(url);
    return new Response(legacy.responses.find(row => url.includes(row.contains)).body);
  };
  const feed = JSON.parse((await run('example')).output);
  assert.equal(calls.length, 4);
  assert.deepEqual(feed.items.map(item => item.id), legacy.expected_ids);
  assert.equal(feed.items[0].enclosure.url, 'https://video.twimg.com/high.mp4');
});

test('X 不把缺失时间线或不安全的用户 ID 当作空列表，不执行内嵌脚本', async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  for (const user of [
    { rest_id: '123' },
    { rest_id: 9007199254740992, profile_user_originals_timeline: { timeline: { instructions: [] } } },
  ]) {
    globalThis.fetch = async () => new Response(stream({ data: { user_result_by_screen_name: { result: user } } }));
    await assert.rejects(run(), error => error.problem?.code === 'UPSTREAM_INVALID_RESPONSE');
  }
  globalThis.fetch = async () => new Response('<script>throw new Error("executed");</script><title>Log in / X</title>');
  await assert.rejects(run(), error => {
    assert.equal(error.problem.code, 'UPSTREAM_INVALID_RESPONSE');
    assert.match(error.message, /登录页或验证页/);
    assert.doesNotMatch(error.message, /executed/);
    return true;
  });
});

const tweet = (id, text, fields = {}, user = 'original') => ({ rest_id: id,
  core: { user_results: { result: { core: { name: user, screen_name: user } } } },
  legacy: { full_text: text, created_at: 'Sat Oct 17 01:00:00 +0000 2026', ...fields },
});
const timeline_html = tweets => stream({ data: { user_result_by_screen_name: { result: {
  rest_id: '123', legacy: { name: '订阅用户' }, profile_user_originals_timeline: { timeline: {
    instructions: [{ entries: tweets.map(result => ({ content: { itemContent: { tweet_results: { result } } } })) }],
  } },
} } } });

test('X 转发、引用与回复保留当前帖与原帖作者和媒体，引用子项不混进时间线', async t => {
  const saved = globalThis.fetch;
  t.after(() => { globalThis.fetch = saved; });
  const original = tweet('100', '原帖正文', { extended_entities: { media: [{ type: 'photo', media_url_https: 'https://pbs.twimg.com/original.jpg' }] } });
  const calls = [];
  globalThis.fetch = async url => {
    calls.push(url);
    return new Response(timeline_html([
      tweet('200', '转发', { retweeted_status_result: { result: { tweet: original } } }, 'reposter'),
      { ...tweet('201', '引用点评', { quoted_status_id_str: '100' }, 'quoter'), quoted_status_result: { result: original } },
      tweet('202', '我的回复', { in_reply_to_status_id_str: '100', in_reply_to_screen_name: 'original' }, 'replier'),
    ]));
  };
  const feed = JSON.parse((await run('example')).output);
  assert.equal(calls.length, 1, '回复优先复用页面中已有的原帖，不重复查询');
  assert.equal(feed.items.length, 3);
  for (const [index, kind] of ['repost', 'quote', 'reply'].entries()) {
    const item = feed.items[index];
    assert.equal(item.kind, kind);
    assert.equal(item.references[0].relation, kind);
    assert.equal(item.references[0].item.id, 'x:tweet:100');
    assert.equal(item.references[0].item.author.name, 'original');
    assert.equal(item.references[0].item.link, 'https://x.com/original/status/100');
    assert.equal(item.references[0].item.published, '2026-10-17T01:00:00.000Z');
    assert.deepEqual(item.references[0].item.images, ['https://pbs.twimg.com/original.jpg']);
    assert.equal(item.images, undefined);
  }
  assert.equal(feed.items[0].link, 'https://x.com/reposter/status/200');
  assert.equal(feed.items[2].description, '我的回复');
});

for (const operation of ['TweetResultByRestId', 'TweetDetail']) test('X 使用 ' + operation + ' 补取回复原帖，共享引用只查询一次且失败保留链接', async t => {
  const saved = globalThis.fetch;
  t.after(() => { globalThis.fetch = saved; });
  const calls = [];
  const client = 'queryId:"detail_1",operationName:"' + operation + '",featureSwitches:["other"];AAAAA' + 'a'.repeat(64);
  globalThis.fetch = async url => {
    calls.push(url);
    if (url.includes('abs.twimg')) return new Response(client);
    if (url.includes('/' + operation + '?')) {
      const variables = JSON.parse(new URL(url).searchParams.get('variables'));
      const id = variables.tweetId || variables.focalTweetId;
      return id === '100' ? Response.json({ data: { tweetResult: { result: tweet('100', '补取原帖') } } }) : new Response('denied', { status: 403 });
    }
    return new Response('<script src="https://abs.twimg.com/responsive-web/client-web/main.123.js"></script>' + timeline_html([
      tweet('200', '回复一', { in_reply_to_status_id_str: '100' }),
      tweet('201', '回复二', { in_reply_to_status_id_str: '100' }),
      tweet('202', '回复已删帖', { in_reply_to_status_id_str: '999' }),
      tweet('203', '再次回复已删帖', { in_reply_to_status_id_str: '999' }),
    ]));
  };
  const feed = JSON.parse((await run('example')).output);
  assert.equal(calls.filter(url => url.includes('abs.twimg')).length, 1);
  assert.equal(calls.filter(url => url.includes('/' + operation + '?')).length, 2);
  for (const item of feed.items.slice(0, 2)) assert.equal(item.references[0].item.description, '补取原帖');
  for (const item of feed.items.slice(2)) {
    assert.equal(item.kind, 'reply');
    assert.equal(item.references[0].id, 'x:tweet:999');
    assert.equal(item.references[0].link, 'https://x.com/i/web/status/999');
    assert.equal(item.references[0].item, undefined);
  }
});

test('X 多种引用并存，原帖查询有预算，明确不可用的引用不重复查询', async t => {
  const saved = globalThis.fetch;
  t.after(() => { globalThis.fetch = saved; });
  let queries = 0;
  const client = 'queryId:"detail_1",operationName:"TweetResultByRestId",featureSwitches:[];AAAAA' + 'a'.repeat(64);
  globalThis.fetch = async url => {
    if (url.includes('abs.twimg')) return new Response(client);
    if (url.includes('/TweetResultByRestId?')) { queries++; return new Response('denied', { status: 403 }); }
    return new Response('<script src="https://abs.twimg.com/responsive-web/client-web/main.123.js"></script>' + timeline_html([
      { ...tweet('300', '回复并引用', { in_reply_to_status_id_str: '100', quoted_status_id_str: '99' }),
        quoted_status_result: { result: { __typename: 'TweetUnavailable' } } },
      ...Array.from({ length: 10 }, (_, i) => tweet(String(200 + i), '回复', { in_reply_to_status_id_str: String(100 + i) })),
    ]));
  };
  const feed = JSON.parse((await run('example')).output);
  assert.equal(queries, 8);
  assert.equal(feed.items.length, 11);
  const item = feed.items[0];
  assert.equal(item.kind, 'reply');
  assert.deepEqual(item.references.map(ref => ref.relation), ['reply', 'quote']);
  assert.equal(item.references[1].unavailable, true);
  assert.equal(item.references[1].id, 'x:tweet:99');
});
