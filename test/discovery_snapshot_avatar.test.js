import assert from "node:assert/strict";
import test from "node:test";
import { create_memory_bucket } from "@findrss/object-store";
import { create_api_object_store } from "../server/infra/object_store.js";
import { load_discovery_profile, load_discovery_snapshot } from "../server/infra/discovery_snapshot.js";
import { ServiceDiscovery } from "../server/service/durable_object/discovery.js";
import { FINDRSS_LOGO_PNG } from "../server/lib/brand.js";

const png = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0X8AAAAASUVORK5CYII=", "base64"));
const original_fetch = globalThis.fetch;
const feed_xml = icon => `<rss><channel><title>视频号</title>${icon ? `<image><url>${icon}</url></image>` : ""}
  <item><title>视频</title><link>https://example.com/video</link></item></channel></rss>`;

test("添加预读返回真实作者资料和头像，不获取文章封面，头像失败不返回不完整资料", async t => {
  t.after(() => { globalThis.fetch = original_fetch; });
  const reads = [];
  const source = { feed_url: "{{hostname}}/rss/wxchannels/finder", require_token: true };
  const serve = async (format, path, request) => {
    assert.equal(format, "rss"); assert.equal(path, "/wxchannels/finder");
    assert.equal(new URL(request.url).pathname, "/_admin/feed/rss/wxchannels/finder");
    return { body: '<rss><channel><title>真实作者</title><description>作者简介</description><link>https://example.com/author</link>' +
      '<image><url>https://example.com/avatar.png</url></image><item><title>文章</title><enclosure url="https://example.com/cover.png" type="image/png"/></item></channel></rss>' };
  };
  globalThis.fetch = async url => { reads.push(String(url)); return new Response(png); };
  const profile = await load_discovery_profile(source, "https://feeds.example", serve);
  assert.equal(profile.defaults.title, "真实作者"); assert.equal(profile.defaults.description, "作者简介");
  assert.equal(profile.avatar.content_type, "image/png");
  assert.deepEqual(reads, ["https://example.com/avatar.png"]);
  assert.equal(profile.articles, undefined);
  globalThis.fetch = async () => { throw new Error("offline"); };
  await assert.rejects(load_discovery_profile(source, "https://feeds.example", serve), /头像读取失败/);
});

function fixture(t, { xml = feed_xml("https://example.com/avatar.png"), require_token = false, serve_image } = {}) {
  t.after(() => { globalThis.fetch = original_fetch; });
  const bucket = create_memory_bucket(), avatars = new Map();
  const source = { id: "channel", title: "视频号", feed_url: "{{hostname}}/rss/wxchannels/account",
    enabled: 1, require_token, avatar_updated_at: 0 };
  let snapshot = {}, published = 0;
  const repo = { discovery: {
    find: id => id === source.id ? { ...source, avatar_object_key: avatars.get(id)?.object_key } : undefined,
    list: () => [{ ...source, ...snapshot, avatar_object_key: avatars.get(source.id)?.object_key }],
    snapshot_attempt() {},
    snapshot_get: () => snapshot,
    snapshot_save(_id, _url, articles, saved_at, error, fingerprint) {
      snapshot = { articles_json: JSON.stringify(articles), saved_at, error, fingerprint };
    },
    snapshot_due: () => [source],
    avatar_get: id => avatars.get(id),
    avatar_put(id, content_type, bytes, updated_at, object_key) {
      avatars.set(id, { content_type, bytes, updated_at, object_key });
    },
    set_avatar_ts(_id, ts) { source.avatar_updated_at = ts; },
  } };
  const serve_route = async (format, pathname, request, options) => {
    if (format === "raw") return serve_image(pathname, request, options);
    return { body: xml };
  };
  globalThis.fetch = async url => {
    assert.equal(String(url), "https://example.com/avatar.png");
    return new Response(png, { headers: { "Content-Type": "image/png" } });
  };
  const service = new ServiceDiscovery({ repo, storage: { transactionSync: fn => fn() },
    object_store: create_api_object_store({ API_STORAGE: bucket }), public_origin: "https://findrss.cloud",
    load_snapshot: (source, origin, signal) => load_discovery_snapshot(source, origin, serve_route, signal) });
  service.publish_catalog = async () => { published++; };
  return { service, bucket, avatars, source, get snapshot() { return snapshot; }, get published() { return published; } };
}

test("手动与定时快照补齐图标，内容相同不重写，变化时替换并清理旧对象", async t => {
  const f = fixture(t);
  const first = await f.service.refresh_discovery_snapshot("channel");
  assert.match(first.avatar_url, /^\/public\/avatar\/channel\/[a-f0-9-]+$/);
  const first_timestamp = f.source.avatar_updated_at;
  assert.equal(f.snapshot.saved_at > 0, true);
  assert.equal(f.snapshot.error, "");
  assert.equal(f.snapshot.articles_json.includes("视频"), true);
  const first_key = f.avatars.get("channel").object_key;
  assert.equal(f.published, 1);
  assert.equal(f.service.public_catalog().sources[0].avatar_url, first.avatar_url);
  await f.service.refresh_due_snapshots();
  assert.equal(f.bucket.calls.put, 1);
  assert.equal(f.source.avatar_updated_at, first_timestamp);
  const changed = Uint8Array.from([...png, 1]);
  globalThis.fetch = async () => new Response(changed);
  const updated = await f.service.refresh_discovery_snapshot("channel");
  assert.notEqual(updated.avatar_url, first.avatar_url);
  assert.equal(f.bucket.objects.has(first_key), false);
  assert.equal(f.bucket.objects.size, 1);
  assert.deepEqual(new Uint8Array((await f.service.get_discovery_avatar("channel")).bytes), changed);
});

test("头像抓取或存储失败不影响文章快照，也不移除旧头像", async t => {
  const f = fixture(t);
  const first = await f.service.refresh_discovery_snapshot("channel");
  const original_key = f.avatars.get("channel").object_key;
  for (const fail of [
    () => { globalThis.fetch = async () => { throw new Error("offline"); }; },
    () => { globalThis.fetch = async () => new Response("<svg></svg>"); },
    () => {
      globalThis.fetch = async () => new Response(Uint8Array.from([...png, 2]));
      f.bucket.fail_next({ op: "put" });
    },
  ]) {
    fail();
    const result = await f.service.refresh_discovery_snapshot("channel");
    assert.equal(result.snapshot.error, "");
    assert.equal(result.snapshot.articles[0].title, "视频");
    assert.equal(result.avatar_url, first.avatar_url);
    assert.equal(f.avatars.get("channel").object_key, original_key);
    assert.equal(f.bucket.objects.size, 1);
  }
});

test("没有图标时保留已有头像，不发起额外请求", async t => {
  const f = fixture(t, { xml: feed_xml("") });
  await f.service.put_discovery_avatar(new Request("https://internal/avatar", { method: "PUT", body: png }), "channel");
  globalThis.fetch = async () => assert.fail("没有图标不应请求图片");
  const result = await f.service.refresh_discovery_snapshot("channel");
  assert.match(result.avatar_url, /\/public\/avatar\/channel\//);
  assert.equal(f.bucket.calls.put, 1);
});

test("快照头像上传期间修改来源或手动上传头像，不提交旧结果且清理临时对象", async t => {
  for (const change_avatar of [false, true]) {
    const f = fixture(t);
    const put = f.bucket.put.bind(f.bucket);
    let intercepted = false;
    f.bucket.put = async (...args) => {
      if (!intercepted) {
        intercepted = true;
        if (change_avatar) await f.service.put_discovery_avatar(new Request("https://internal/avatar", {
          method: "PUT", body: Uint8Array.from([...png, 3]),
        }), "channel");
        else f.source.feed_url = "{{hostname}}/rss/wxchannels/other";
      }
      return put(...args);
    };
    await f.service.refresh_discovery_snapshot("channel");
    assert.equal(f.bucket.objects.size, change_avatar ? 1 : 0);
    if (change_avatar) assert.deepEqual(new Uint8Array((await f.service.get_discovery_avatar("channel")).bytes), Uint8Array.from([...png, 3]));
    else assert.equal(f.source.avatar_updated_at, 0);
  }
});

test("私密 Atom 源也同步图标，但不保存文章内容", async t => {
  const f = fixture(t, { require_token: true,
    xml: '<feed xmlns="http://www.w3.org/2005/Atom"><title>私密视频号</title><icon>https://example.com/avatar.png</icon><entry><title>私密视频</title><id>one</id></entry></feed>' });
  const result = await f.service.refresh_discovery_snapshot("channel");
  assert.match(result.avatar_url, /\/public\/avatar\/channel\//);
  assert.deepEqual(result.snapshot.articles, []);
  assert.equal(f.snapshot.articles_json, "[]");
  assert.match(f.snapshot.fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(f.published, 1);
});

test("同源图标执行图片代理并保留 Referer；默认品牌图标无需回环请求", async t => {
  const f = fixture(t, { xml: feed_xml("https://findrss.cloud/img/weibo?user=123"),
    serve_image(pathname, request) {
      assert.equal(pathname, "/img/weibo");
      assert.equal(request.url, "https://internal/_public/feed/raw/img/weibo?user=123");
      assert.equal(request.headers.get("Authorization"), null);
      return { route: { allowed_hosts: ["example.com"] }, raw: {
        kind: "img", url: "https://example.com/avatar.png", headers: { Referer: "https://weibo.com/" },
      } };
    } });
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "https://example.com/avatar.png");
    assert.equal(options.headers.referer, "https://weibo.com/");
    return new Response(png, { headers: { "Content-Type": "image/png" } });
  };
  assert.match((await f.service.refresh_discovery_snapshot("channel")).avatar_url, /\/public\/avatar\/channel\//);
  const brand = fixture(t, { xml: feed_xml("https://findrss.cloud/findrss-logo.png") });
  globalThis.fetch = async () => assert.fail("默认图标不应请求网络");
  await brand.service.refresh_discovery_snapshot("channel");
  assert.deepEqual(new Uint8Array((await brand.service.get_discovery_avatar("channel")).bytes), FINDRSS_LOGO_PNG);
});

test("外部订阅源同域图标走公网抓取，头像重定向至私网仍被拒绝", async t => {
  const f = fixture(t);
  f.source.feed_url = "https://example.com/feed";
  globalThis.fetch = async url => String(url) === "https://example.com/feed"
    ? new Response(feed_xml("https://example.com/avatar.png")) : new Response(png);
  assert.match((await f.service.refresh_discovery_snapshot("channel")).avatar_url, /\/public\/avatar\/channel\//);
  const avatar_url = f.service.public_catalog().sources[0].avatar_url;
  globalThis.fetch = async url => String(url) === "https://example.com/feed"
    ? new Response(feed_xml("https://example.com/avatar.png"))
    : new Response(null, { status: 302, headers: { Location: "http://127.0.0.1/private" } });
  const result = await f.service.refresh_discovery_snapshot("channel");
  assert.equal(result.snapshot.error, "");
  assert.equal(result.avatar_url, avatar_url);
});

test("取消快照时终止头像抓取，不提交图标", async t => {
  const f = fixture(t), controller = new AbortController();
  globalThis.fetch = async (_url, { signal }) => {
    controller.abort(new Error("cancelled"));
    signal.throwIfAborted();
  };
  await assert.rejects(f.service.refresh_discovery_snapshot("channel", "", { signal: controller.signal }), /cancelled/);
  assert.equal(f.bucket.calls.put, 0);
});
