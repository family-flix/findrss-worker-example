import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { API_SCHEMA_SQL } from "../server/repository/schema.js";
import { RepositoryDiscoverySource } from "../server/repository/discovery_source.js";
import { ServiceDiscovery } from "../server/service/durable_object/discovery.js";
import { discovery_snapshot_articles, fetch_cover_dimensions, fetch_cover_metadata, image_dimensions } from "../server/infra/discovery_snapshot.js";
import { downsample_rgba, encode_cover_blurhash } from "../server/infra/cover_blurhash.js";

test("快照与任务租约共用 alarm，频繁调度不能推迟已安排的更新", async () => {
  const source = readFileSync(new URL("../server/durable_object.js", import.meta.url), "utf8");
  const schedule = vm.runInNewContext("({" + source.slice(source.lastIndexOf("  async schedule_alarm()"), source.lastIndexOf("\n}")) + "}).schedule_alarm",
    { Date: { now: () => 10000 }, MAINTENANCE_MILLISECONDS: 86400000 });
  let current = null, lease = null, snapshot = 15000, token_expiry = null;
  const writes = [];
  const object = { repo: { calls: { min_lease_expires_at: () => lease }, device_tokens: { min_expires_at: now => token_expiry > now ? token_expiry : null } },
    app: { discovery: { next_snapshot_at: () => snapshot } },
    ctx: { storage: { getAlarm: async () => current, setAlarm: async value => { current = value; writes.push(value); } } } };
  await schedule.call(object); assert.equal(current, 15000);
  snapshot = 20000; await schedule.call(object); assert.deepEqual(writes, [15000]);
  lease = 12000; await schedule.call(object); assert.equal(current, 12000);
  lease = null; snapshot = 3600000; await schedule.call(object); assert.equal(current, 12000);
  current = null; await schedule.call(object); assert.equal(current, 3600000);
  token_expiry = 11000; await schedule.call(object); assert.equal(current, 11000);
  current = null; token_expiry = null;
  await schedule.call(object); assert.equal(current, 3600000);
  current = null; snapshot = null;
  await schedule.call(object); assert.equal(current, 86410000);
});

function png(width, height) {
  const bytes = new Uint8Array(24);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]); bytes.set([73, 72, 68, 82], 12);
  const view = new DataView(bytes.buffer); view.setUint32(16, width); view.setUint32(20, height);
  return bytes;
}

test("封面降采样至 64px 保留比例与平均颜色", () => {
  const pixels = new Uint8ClampedArray(128 * 64 * 4);
  for (let i = 0; i < pixels.length; i += 4) pixels.set([255, 96, 48, 255], i);
  const small = downsample_rgba(pixels, 128, 64, 64);
  assert.equal(small.width, 64); assert.equal(small.height, 32);
  assert.deepEqual([...small.data.slice(0, 4)], [255, 96, 48, 255]);
  assert.equal(encode_cover_blurhash({ data: pixels, width: 128, height: 64 }).length, 28);
});

test("从 PNG / GIF / JPEG / WebP 文件头读取宽高，损坏或截断字节降级", () => {
  assert.deepEqual(image_dimensions(png(1200, 630)), { width: 1200, height: 630 });
  assert.deepEqual(image_dimensions(Uint8Array.from([71,73,70,56,57,97,64,1,240,0])), { width: 320, height: 240 });
  const jpeg = Uint8Array.from([255,216,255,192,0,11,8,2,208,5,0,1,1,17,0]);
  assert.deepEqual(image_dimensions(jpeg), { width: 1280, height: 720 });
  const webp = new Uint8Array(30); webp.set(Buffer.from("RIFF")); webp.set(Buffer.from("WEBPVP8X"), 8);
  webp.set([127,2,0,223,1,0], 24);
  assert.deepEqual(image_dimensions(webp), { width: 640, height: 480 });
  for (const bytes of [new Uint8Array(), jpeg.slice(0, 8), png(0, 1), Buffer.from("bad image")]) assert.equal(image_dimensions(bytes), null);
});

test("只保存三篇文章，封面尺寸失败不影响文章，同一封面只读取一次", async () => {
  let calls = 0;
  const xml = '<rss xmlns:media="http://search.yahoo.com/mrss/"><channel><title>源</title>' + Array.from({ length: 4 }, (_, i) =>
    '<item><title>标题' + i + '</title><link>https://example.com/a/' + i + '</link><pubDate>Tue, 13 Oct 2026 05:30:00 GMT</pubDate><media:thumbnail url="https://example.com/cover.png"/></item>').join('') + '</channel></rss>';
  const articles = await discovery_snapshot_articles(xml, "https://example.com/feed", async () => { calls++; return { width: 1200, height: 630, blurhash: "hash" }; });
  assert.equal(articles.length, 3); assert.equal(calls, 1);
  assert.equal(articles[0].cover_width, 1200); assert.equal(articles[0].cover_height, 630);
  assert.equal(articles[0].cover_blurhash, "hash");
  assert.ok(articles[0].published_at > 0);
  const failed = await discovery_snapshot_articles(xml, "https://example.com/feed", () => { throw new Error("offline"); });
  assert.equal(failed[0].cover_width, 0); assert.equal(failed[0].title, "标题0");
});

test("Discover 保留本地同源图片代理封面，复用 XML 元数据且不请求本地网络", async () => {
  for (const origin of ["http://127.0.0.1:8787", "http://localhost:8787", "http://[::1]:8787"]) {
    const cover = origin + "/img/weibo?url=https%3A%2F%2Fwx3.sinaimg.cn%2Forj360%2F0085qV8vgy1ii4453qtksj30u01hc7l2.jpg";
    for (const metadata of ['', ' width="1080" height="1920" blurhash="hash"']) {
      const xml = '<rss xmlns:media="http://search.yahoo.com/mrss/"><channel><item><title>度数加深了</title>' +
        '<media:thumbnail url="' + cover + '"' + metadata + '/></item></channel></rss>';
      let calls = 0;
      const articles = await discovery_snapshot_articles(xml, origin + "/rss/weibo/u/7409360499",
        () => { calls++; return null; });
      assert.equal(calls, 0, "不应通过出站请求读取本地封面");
      assert.equal(articles[0].cover_url, cover);
      assert.equal(articles[0].cover_width, metadata ? 1080 : 0);
      assert.equal(articles[0].cover_height, metadata ? 1920 : 0);
      assert.equal(articles[0].cover_blurhash, metadata ? "hash" : "");
    }
  }
});

test("Discover 仍过滤非同源私网、伪造同源与含凭据的封面地址", async () => {
  for (const cover of ["http://127.0.0.1:8788/img/weibo", "http://localhost:8787/img/weibo", "http://192.168.1.2/image",
    "http://127.0.0.1:8787@192.168.1.2/image", "http://user:password@127.0.0.1:8787/image", "javascript:alert(1)"]) {
    const xml = '<rss xmlns:media="http://search.yahoo.com/mrss/"><channel><item><title>标题</title>' +
      '<media:thumbnail url="' + cover + '"/></item></channel></rss>';
    let calls = 0;
    const articles = await discovery_snapshot_articles(xml, "http://127.0.0.1:8787/rss/weibo/u/7409360499",
      () => { calls++; return null; });
    assert.equal(calls, 0, "不应读取非公网封面");
    assert.equal(articles[0].cover_url, "", cover);
  }
});

test("完整封面计算 BlurHash，解码失败、过大、部分响应均保留宽高", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  const decode = async (bytes, type) => {
    calls++; assert.equal(bytes.length, 24); assert.equal(type, "image/png");
    return encode_cover_blurhash({ data: new Uint8ClampedArray(4 * 4 * 4).fill(255), width: 4, height: 4 });
  };
  try {
    globalThis.fetch = async (_url, options) => {
      assert.equal(options.headers.Range, "bytes=0-2097151");
      return new Response(png(800, 450));
    };
    const metadata = await fetch_cover_metadata("https://example.com/image", decode);
    assert.equal(metadata.width, 800); assert.equal(metadata.height, 450);
    assert.equal(metadata.blurhash.length, 28); assert.equal(calls, 1);
    assert.deepEqual(await fetch_cover_metadata("https://example.com/image", () => { throw new Error("bad pixels"); }), { width: 800, height: 450 });
    for (const [bytes, headers] of [[png(4000, 4000), {}], [png(800, 450), { "Content-Range": "bytes 0-23/99999" }],
      [new Uint8Array(2 * 1024 * 1024 + 1), {}]]) {
      if (bytes.length > 24) bytes.set(png(800, 450));
      globalThis.fetch = async () => new Response(bytes, { headers });
      const result = await fetch_cover_metadata("https://example.com/image", () => { throw new Error("不应解码"); });
      assert.ok(result.width > 0); assert.equal(result.blurhash, undefined);
    }
    assert.equal(calls, 1);
    globalThis.fetch = async () => new Response(null, { status: 302, headers: { Location: "http://127.0.0.1/private" } });
    await assert.rejects(fetch_cover_metadata("https://example.com/image", decode), /地址被拒绝/);
  } finally { globalThis.fetch = original; }
});

test("封面抓取限制读取量，拒绝重定向至私网，读到宽高即取消正文", async () => {
  const original = globalThis.fetch;
  let cancelled = false, count = 0;
  try {
    globalThis.fetch = async (_url, options) => {
      count++; assert.equal(options.redirect, "manual"); assert.equal(options.headers.Range, "bytes=0-65535");
      return new Response(new ReadableStream({ start(controller) { controller.enqueue(png(800, 450)); }, cancel() { cancelled = true; } }));
    };
    assert.deepEqual(await fetch_cover_dimensions("https://example.com/image"), { width: 800, height: 450 });
    assert.equal(cancelled, true);
    globalThis.fetch = async () => { count++; return new Response(null, { status: 302, headers: { Location: "http://127.0.0.1/private" } }); };
    await assert.rejects(fetch_cover_dimensions("https://example.com/image"), /地址被拒绝/);
    assert.equal(count, 2);
  } finally { globalThis.fetch = original; }
});

function fixture(load_snapshot) {
  const source = { id: "a", feed_url: "https://example.com/feed", title: "源", enabled: 1, require_token: 0 };
  let snapshot = {}, saves = 0;
  const repo = { discovery: {
    find: () => ({ ...source }),
    list: () => [{ ...source, ...snapshot, snapshot_saved_at: snapshot.saved_at }], list_tags: () => [],
    snapshot_attempt(id, feed_url, now) { snapshot = { ...snapshot, feed_url, attempted_at: now }; },
    snapshot_save(id, feed_url, articles, now, error) { if (feed_url !== snapshot.feed_url) return;
      saves++; snapshot = error ? { ...snapshot, error } : { ...snapshot, articles_json: JSON.stringify(articles), saved_at: now, error: "" }; },
    snapshot_get: () => snapshot,
    snapshot_due: (_before, limit) => { assert.equal(limit, 4); return [source]; },
    snapshot_next_at: interval => snapshot.attempted_at ? snapshot.attempted_at + interval : 0,
  } };
  const service = new ServiceDiscovery({ repo, load_snapshot, schedule_alarm: async () => {} });
  return { service, source, get saves() { return saves; } };
}

test("快照持久化后列表只读；并发刷新合并，失败保留上次内容与时间", async () => {
  let calls = 0, finish, fail = false;
  const f = fixture(() => { calls++; if (fail) throw new Error("offline"); return new Promise(resolve => { finish = resolve; }); });
  const first = f.service.refresh_discovery_snapshot("a"), second = f.service.refresh_discovery_snapshot("a");
  await new Promise(setImmediate); assert.equal(calls, 1);
  finish([{ id: "0", title: "文章", cover_width: 800, cover_height: 450 }]);
  const result = await first; await second;
  assert.equal(f.saves, 1);
  const listed = f.service.list_discovery_sources(new URL("https://api/sources"), false).sources[0];
  assert.equal(listed.snapshot.articles[0].cover_width, 800); assert.equal(calls, 1);
  fail = true;
  const stale = await f.service.refresh_discovery_snapshot("a");
  assert.equal(stale.snapshot.saved_at, result.snapshot.saved_at);
  assert.deepEqual(stale.snapshot.articles, result.snapshot.articles); assert.equal(stale.snapshot.error, "offline");
  assert.equal("error" in f.service.list_discovery_sources(new URL("https://api/sources"), false).sources[0].snapshot, false);
});

test("定时更新限并发，编辑中的旧抓取与需要 token 的内容不发布", async () => {
  let finish;
  const f = fixture(() => new Promise(resolve => { finish = resolve; }));
  assert.ok(f.service.next_snapshot_at() >= Date.now());
  const refresh = f.service.refresh_due_snapshots();
  assert.equal(f.service.refresh_due_snapshots(), refresh);
  await new Promise(setImmediate);
  f.source.feed_url = "https://example.com/new";
  finish([{ title: "旧内容" }]); await refresh;
  assert.equal(f.saves, 0);
  f.source.require_token = 1;
  await assert.rejects(f.service.refresh_discovery_snapshot("a"), { status: 400 });
  assert.deepEqual(f.service.list_discovery_sources(new URL("https://api/sources"), false).sources[0].snapshot.articles, []);
});

test("SQLite 迁移与目录 JOIN、失败保留和删除语义可实际执行", () => {
  const statements = [];
  const repo = new RepositoryDiscoverySource({ sql: { exec(sql, ...args) { statements.push([sql, args]); return { toArray: () => [] }; } } });
  repo.insert({ id: "a", title: "源", description: "", website: "", feed_url: "https://example.com/feed", category: "", tags_json: "[]", enabled: 1, require_token: 0, sort_order: 0, source_type: "website", created_at: 1, updated_at: 1 });
  repo.snapshot_attempt("a", "https://example.com/feed", 2);
  repo.snapshot_save("a", "https://example.com/feed", [{ title: "旧文章" }], 2);
  repo.snapshot_attempt("a", "https://example.com/feed", 3);
  repo.snapshot_save("a", "https://example.com/feed", [], 0, "offline");
  repo.list({ include_disabled: false, query: "源" });
  repo.snapshot_due(4, 4); repo.snapshot_next_at(3600000);
  repo.snapshot_attempt("a", "https://example.com/new", 4);
  repo.snapshot_get("a"); repo.delete("a");
  const result = spawnSync("python3", ["-c", `import sqlite3,json,sys
schema,statements=json.load(sys.stdin)
db=sqlite3.connect(':memory:');db.row_factory=sqlite3.Row;db.executescript(schema)
for i,(sql,args) in enumerate(statements):
 rows=[dict(row) for row in db.execute(sql,args).fetchall()]
 if i==5: assert json.loads(rows[0]['articles_json'])[0]['title']=='旧文章' and rows[0]['snapshot_saved_at']==2
 if sql.startswith('SELECT * FROM discovery_source_snapshots'): assert rows[0]['saved_at']==0 and rows[0]['articles_json']=='[]'
assert db.execute('SELECT COUNT(*) FROM discovery_source_snapshots').fetchone()[0]==0
`], { input: JSON.stringify([API_SCHEMA_SQL, statements]), encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
});

test("管理员刷新自有私密源只保存抓取状态，默认定时频率为 1 小时", async () => {
  let loaded = 0, interval;
  const f = fixture(async source => { loaded++; assert.equal(source.require_token, 1); return [{ title: "私密文章" }]; });
  f.source.feed_url = "{{hostname}}/rss/private";
  f.source.require_token = 1;
  f.service.repo.discovery.snapshot_next_at = value => { interval = value; return null; };
  f.service.next_snapshot_at();
  assert.equal(interval, 3600000);
  const result = await f.service.refresh_discovery_snapshot("a");
  assert.equal(loaded, 1); assert.equal(f.saves, 1);
  assert.deepEqual(result.snapshot.articles, []);
  assert.equal(f.service.repo.discovery.snapshot_get("a").articles_json, "[]");
});
