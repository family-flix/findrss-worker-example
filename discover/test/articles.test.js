import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { home_source as source, initialize_home } from "./home_fixture.js";

const make_feeds = () => Array.from({ length: 6 }, (_, i) => ({ title: "源" + i, feed_url: "https://example.com/feed/" + i, tags: [], source_type: "website", avatar_url: "", website: "", language: "", snapshot: { saved_at: 1000, articles: items } }));
const items = [{ id: "1", title: "有封面的文章", link: "https://example.com/a", published_at: "2026/10/13 12:00", cover_url: "https://example.com/cover.jpg", cover_width: 1200, cover_height: 630 },
  { id: "2", title: "纯文字文章", link: "", published_at: "", cover_url: "" }];

function fixture(fetch) {
  const ref = value => ({ value, set(next) { this.value = next; } });
  const component = (props, children = []) => ({ props, children });
  const computed = (input, map) => ({ get value() { return map(input.value); } });
  const location = { href: "https://discover.example/" };
  const set_url = (_state, _title, url) => { location.href = url; };
  const context = vm.createContext({ URL, URLSearchParams, AbortSignal, fetch, setTimeout, clearTimeout, btoa,
    document: { readyState: "loading", addEventListener() {}, createElement() { return { set innerHTML(text) { this.content = { textContent: text }; } }; } },
    window: { location, history: { pushState: set_url, replaceState: set_url }, addEventListener() {},
      Timeless: { DOM: {}, ref, computed, View: component, Img: component, Link: component, Button: component,
      Show: props => props.when.value ? props.ok() : props.else?.(),
      For: props => ({ children: props.each.value.map(item => props.render(item)) }),
    } },
  });
  initialize_home(context, vm);
  context.model.state.feeds.set(make_feeds());
  return context;
}

function nodes(tree) {
  if (!tree || typeof tree !== "object") return [];
  return [tree, ...(tree.children || []).flatMap(nodes)];
}

test("卡片直接渲染快照，挂载与读取文章均不发起内容请求", () => {
  let calls = 0;
  const context = fixture(() => { calls++; throw new Error("不能请求内容"); });
  vm.runInContext("globalThis.view = FeedArticlesView({ vm$: model, feed: model.state.feeds.value[0] });", context);
  const rendered = nodes(context.view);
  const cover = rendered.find(node => node.props?.attributes?.n === "feed-article-cover-placeholder");
  assert.equal(cover.props.attributes.width, 1200);
  assert.equal(cover.props.attributes.height, 630);
  assert.match(cover.props.src, /^data:image\/svg\+xml,/);
  assert.equal(rendered.some(node => node.props?.attributes?.n === "feed-article-cover"), false);
  assert.equal(typeof rendered.find(node => node.props?.attributes?.n === "feed-article-cover-frame").props.onExpose, "function");
  assert.equal(rendered.filter(node => node.props?.attributes?.n === "feed-article-title").length, 2);
  assert.equal(calls, 0);
  assert.equal(context.view.props.onMounted, undefined);
  assert.equal(source.includes("/api/preview"), false);
  assert.equal(source.includes('n: "feed-public-flag"'), false);
  assert.equal(source.includes('n: "feed-managed-flag"'), false);
});

test("坏封面降级为标题与时间，空快照与尚未生成快照区分", () => {
  const context = fixture(() => { throw new Error("不能请求内容"); });
  const feed = context.model.state.feeds.value[0];
  context.model.methods.hide_article_cover(feed, "1");
  vm.runInContext("globalThis.view = FeedArticlesView({ vm$: model, feed: model.state.feeds.value[0] });", context);
  assert.equal(nodes(context.view).filter(node => node.props?.attributes?.n === "feed-article-cover-frame").length, 0);
  assert.equal(nodes(context.view).some(node => node.children?.includes("时间未知")), true);
  for (const [saved_at, require_token, message] of [[1000, false, "暂无文章"], [0, false, "快照生成中"], [0, true, "此订阅源需要访问凭证，暂时无法显示文章。"]]) {
    const feed = { ...context.model.state.feeds.value[0], feed_url: "https://example.com/" + saved_at + require_token, require_token, snapshot: { saved_at, articles: [] } };
    context.test_feed = feed;
    vm.runInContext("globalThis.view = FeedArticlesView({ vm$: model, feed: test_feed });", context);
    assert.equal(nodes(context.view).some(node => node.children?.some(child => child?.value === message)), true);
  }
});

test("LazyImg 在曝光后加载，BlurHash 占位可 SSR，失败保留占位", () => {
  const context = fixture(() => {});
  vm.runInContext('globalThis.image = LazyImgModel({src: "https://example.com/cover", blurhash: "LEHV6nWB2yk8pyo0adR*.7kCMdnj", width: 800, height: 450});', context);
  const { state, methods } = context.image;
  assert.equal(state.status.value, "pending");
  assert.equal(state.exposed.value, false);
  assert.match(decodeURIComponent(state.placeholder), /data:image\/bmp;base64,/);
  methods.expose(); assert.equal(state.exposed.value, true);
  methods.load(); assert.equal(state.status.value, "loaded");
  methods.error(); assert.equal(state.status.value, "error");
  assert.equal(state.loaded.value, false);
});

test("目录只读取一次，筛选后复用静态文章快照", async () => {
  const calls = [];
  const context = fixture(async url => {
    calls.push(url);
    return Response.json({ sources: [{ title: "源", feed_url: "https://example.com/feed", snapshot: {
      saved_at: 1000, articles: [{ title: "初始文章", published_at: 1791871200000, cover_width: 800, cover_height: 450 }],
    } }] });
  });
  await context.model.methods.init();
  const feed = context.model.state.feeds.value[0];
  assert.equal(context.model.methods.articles_for(feed).value.items[0].title, "初始文章");
  await context.model.methods.submit_search("源");
  assert.equal(context.model.methods.articles_for(context.model.state.feeds.value[0]).value.items[0].title, "初始文章");
  assert.deepEqual(calls, ["/api/catalog"]);
});

test("头像曝光前只渲染首字占位，没有头像 URL 时不发起加载", () => {
  const context = fixture(() => { throw new Error("不能请求"); });
  vm.runInContext('globalThis.avatar = LazyAvatar({src: "/api/avatar/a?v=1", initial: "A"}); globalThis.empty = LazyImgModel({src: ""});', context);
  const rendered = nodes(context.avatar);
  assert.equal(rendered.some(node => node.props?.attributes?.n === "feed-avatar-image"), false);
  assert.equal(rendered.find(node => node.props?.attributes?.n === "feed-avatar-placeholder").children[0], "A");
  assert.equal(typeof context.avatar.props.onExpose, "function");
  context.empty.methods.expose();
  assert.equal(context.empty.state.exposed.value, false);
});
