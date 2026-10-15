import { page_source } from "./page_source.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { PaginationModel, PaginationView } from "../components/pagination.js";
import * as platform_helpers from "../components/discovery_platform.js";
import { RssRoutePatternModel } from "../../server/domain/rss_route.js";

function modal_model(fetch) {
  const ref = value => ({ value, set(next) { this.value = next; }, as(next) { this.value = next; } });
  const context = vm.createContext({ ...platform_helpers, RssRoutePatternModel, PaginationModel, PaginationView, URL, File, document: { querySelector: () => null }, window: {
    FindRSSAdminUI: { DOM: {}, ref, refarr: ref, computed: () => ({}), combine: () => ({}) },
    FindRSSAdminShell: {}, FindRSSAdminPages: {}, FindRSSAdminAuth: { fetch },
  } });
  vm.runInContext(page_source("discovery.js") + "\nglobalThis.model = DiscoveryAdminViewModel();", context);
  assert.deepEqual(JSON.parse(JSON.stringify(context.model.state.platforms.value)), [{ id: "website", label: "网页", icon: "" }]);
  return context.model;
}

test("后台可选标签使用脚本目录，匹配路由预填且手动修改保留，草稿和源标签不进入选项", async () => {
  let tags = ["科技", "视频", "无源标签"];
  const scripts = [{ status: "draft", routes: [{ path: "/demo/:id", tags: ["草稿标签"] }] },
    { status: "published", routes: [{ path: "/demo/:id", tags: ["科技"] }, { path: "/video/:id", tags: ["视频"] }] }];
  const model = modal_model(async url => Response.json(url.endsWith("/preview")
    ? { defaults: { title: "预览", website: "", description: "", tags: ["feed 标签"] } }
    : url.includes("scripts") ? { scripts }
    : { tags, sources: [{ id: "old", title: "源", tags: ["旧源标签"], feed_url: "{{hostname}}/rss/demo/1", enabled: true }] }));
  await model.methods.refresh_list();
  assert.deepEqual(Array.from(model.state.tags.value), tags);
  model.methods.create_source();
  model.methods.set_draft("feed_url", "{{hostname}}/rss/demo/2");
  await new Promise(setImmediate);
  assert.equal(model.state.draft_tags.value, "科技");
  await model.methods.preview_feed();
  assert.equal(model.state.draft_tags.value, "科技");
  model.methods.set_draft("feed_url", "{{hostname}}/atom/video/2");
  assert.equal(model.state.draft_tags.value, "视频");
  model.methods.toggle_tag("无源标签");
  model.methods.set_draft("feed_url", "{{hostname}}/rss/demo/3");
  await model.methods.preview_feed();
  assert.equal(model.state.draft_tags.value, "视频, 无源标签");
  model.methods.toggle_tag("视频");
  model.methods.toggle_tag("不存在");
  assert.equal(model.state.draft_tags.value, "无源标签");
  model.methods.close_form();
  model.methods.edit_source("old");
  model.methods.set_draft("feed_url", "{{hostname}}/rss/video/3");
  await new Promise(setImmediate);
  assert.equal(model.state.draft_tags.value, "旧源标签");
  tags = [];
  await model.methods.refresh_list();
  assert.deepEqual(Array.from(model.state.tags.value), []);
});

test("JSON 导入兼容导出格式，保留配置和模板，跳过已有及重复地址", async () => {
  const writes = [];
  const model = modal_model(async (_, options) => {
    if (!options?.body) return Response.json({ sources: [{ id: "old", title: "已有", feed_url: "https://example.com/existing", enabled: true }] });
    const source = JSON.parse(options.body);
    writes.push(source);
    return Response.json({ source: { ...source, id: "new-" + writes.length } });
  });
  await model.methods.refresh_list();
  model.methods.open_import();
  const source = { id: "ignored", title: "导入源", feed_url: "https://old.example/rss/test", feed_url_template: "{{hostname}}/rss/test",
    tags: ["标签"], enabled: false, require_token: true, source_type: "website", sort_order: 3, avatar_url: "/old-avatar", snapshot: { saved_at: 1 } };
  model.methods.set_import_text(JSON.stringify({ sources: [
    { title: "已有", feed_url: "https://example.com/existing" }, source, source,
  ] }));
  await model.methods.import_sources();
  assert.deepEqual(writes, [{ title: "导入源", feed_url: "{{hostname}}/rss/test", tags: ["标签"], enabled: false, require_token: true, source_type: "website", sort_order: 3 }]);
  assert.equal(model.state.sources.value.length, 2);
  assert.match(model.state.import_message.value, /已导入 1 个.*跳过重复地址 2 个/);
  assert.equal(model.state.import_text.value, "");
  assert.equal(model.state.import_busy.value, false);
});

test("JSON 导入先检查结构与必填项，格式错误不发请求", async () => {
  let writes = 0;
  const model = modal_model(async () => { writes++; return Response.json({}); });
  for (const text of ["bad", "null", "{}", "[]", '[{"title":"缺地址"}]', '[{"title":"有效","feed_url":"https://example.com"},null]']) {
    model.methods.set_import_text(text);
    await model.methods.import_sources();
    assert.match(model.state.import_error.value, /JSON 格式错误/);
  }
  assert.equal(writes, 0);
});

test("JSON 导入中断保留结果与剩余条目，重复提交被阻止，重试不重复新增", async () => {
  const calls = [];
  let finish;
  let fail = true;
  const model = modal_model(async (_, options) => {
    const source = JSON.parse(options.body);
    calls.push(source.title);
    if (source.title === "one") return new Promise(resolve => { finish = () => resolve(Response.json({ source: { ...source, id: "one" } })); });
    return fail ? Response.json({ error: "路由不存在" }, { status: 400 }) : Response.json({ source: { ...source, id: "two" } });
  });
  model.methods.open_import();
  model.methods.set_import_text(JSON.stringify(["one", "two"].map(title => ({ title, feed_url: "https://example.com/" + title }))));
  const pending = model.methods.import_sources();
  await model.methods.import_sources();
  model.methods.close_import();
  assert.equal(model.state.import_open.value, true);
  finish();
  await pending;
  assert.equal(model.state.sources.value.length, 1);
  assert.match(model.state.import_error.value, /第 2 项.*路由不存在/);
  assert.equal(JSON.parse(model.state.import_text.value).sources[0].title, "two");
  fail = false;
  await model.methods.import_sources();
  assert.deepEqual(calls, ["one", "two", "two"]);
  assert.equal(model.state.sources.value.length, 2);
});

test("JSON 文件读取填入文本，限制类型大小，关闭后丢弃迟到读取", async () => {
  const model = modal_model(async () => Response.json({}));
  model.methods.open_import();
  await model.methods.read_import_file([new File(['\uFEFF{"sources":[]}'], "feeds.JSON", { type: "application/json" })]);
  assert.equal(model.state.import_text.value, '{"sources":[]}');
  for (const file of [{ name: "feeds.txt", size: 1 }, { name: "feeds.json", size: 2 * 1024 * 1024 + 1 }]) {
    await model.methods.read_import_file([file]);
    assert.match(model.state.import_error.value, /JSON 文件/);
  }
  await model.methods.read_import_file([{ name: "bad.json", size: 1, async text() { throw new Error("无法读取"); } }]);
  assert.match(model.state.import_error.value, /读取失败.*无法读取/);
  let finish;
  const pending = model.methods.read_import_file([{ name: "late.json", size: 1, text: () => new Promise(resolve => { finish = resolve; }) }]);
  assert.equal(model.state.import_reading.value, true);
  model.methods.close_import();
  model.methods.open_import();
  model.methods.set_import_text("new draft");
  finish("late result");
  await pending;
  assert.equal(model.state.import_text.value, "new draft");
  assert.equal(model.state.import_reading.value, false);
});

test("后台列表与表单读取脚本平台注册，自定义路由推断平台且手动选择保留", async () => {
  const icon = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M1 2h3v4H1z"/></svg>';
  const platform = { name: "独立平台", icon };
  const scripts = [{ kind: "rss", platform, path: "/different/:id", routes: [{ path: "/different/:id", platform }] }];
  const model = modal_model(async url => Response.json(url.endsWith("/preview") ? { feed_url: "https://example.com/rss/different/123",
    defaults: { title: "预览", website: "", description: "", tags: [], source_type: "website" } } : url.includes("scripts") ? { scripts } : {
    sources: [], platforms: [{ id: "website", label: "网页" }, { id: "独立平台", label: "独立平台", icon }],
  }));
  await model.methods.refresh_list();
  assert.deepEqual(Array.from(model.state.platforms.value, platform => platform.id), ["website", "独立平台"]);
  assert.equal(model.state.platforms.value[1].icon, icon);
  assert.equal(platform_helpers.discovery_platform_icon_url("独立平台", model.state.platforms.value), "data:image/svg+xml," + encodeURIComponent(icon));
  model.methods.create_source();
  await new Promise(setImmediate);
  model.methods.set_draft("feed_url", "{{hostname}}/rss/different/123");
  assert.equal(model.state.draft_source_type.value, "独立平台");
  await model.methods.preview_feed();
  assert.equal(model.state.draft_source_type.value, "独立平台", "预览不覆盖脚本声明的平台");
  model.methods.set_draft("source_type", "website");
  model.methods.set_draft("feed_url", "{{hostname}}/atom/different/123");
  assert.equal(model.state.draft_source_type.value, "website");
});

test("后台接口列表替换默认平台并保留名称，脚本加载不改写列表，刷新移除旧平台", async () => {
  let platforms = [{ id: "custom", label: "接口名称" }, { id: "zhihu", label: "接口知乎名称" }];
  const model = modal_model(async url => Response.json(url.includes("scripts")
    ? { scripts: [{ platform: "脚本平台", path: "/demo", routes: [{ platform: "脚本平台", path: "/demo" }] }] }
    : { sources: [{ id: "a", source_type: "x", feed_url: "https://example.com/feed" }], platforms }));
  await model.methods.refresh_list();
  assert.deepEqual(JSON.parse(JSON.stringify(model.state.platforms.value)), platforms);
  model.methods.create_source();
  await new Promise(setImmediate);
  assert.deepEqual(JSON.parse(JSON.stringify(model.state.platforms.value)), platforms);
  platforms = [];
  await model.methods.refresh_list();
  assert.equal(model.state.platforms.value.length, 0);
});

test("后台刷新快照合并重复点击，保留失败前的快照并展示错误，外部私密源不刷新", async () => {
  const calls = [];
  let finish;
  const model = modal_model(async (url, options) => {
    calls.push([url, options?.method]);
    if (url.endsWith("/snapshot")) return new Promise(resolve => { finish = resolve; });
    return Response.json({ sources: [{ id: "one", title: "源", enabled: true, feed_url: "https://example.com/feed",
      snapshot: { saved_at: 10, articles: [{ title: "上次文章" }], error: "" } },
      { id: "private", title: "私有源", enabled: true, require_token: true, feed_url: "https://example.com/private" }] });
  });
  await model.methods.refresh_list();
  const pending = model.methods.refresh_snapshot("one");
  await model.methods.refresh_snapshot("one");
  await model.methods.refresh_snapshot("private");
  assert.equal(calls.length, 2);
  assert.deepEqual(Array.from(model.state.snapshot_refreshing.value), ["one"]);
  finish(Response.json({ snapshot: { saved_at: 10, articles: [{ title: "上次文章" }], error: "上游离线" } }));
  await pending;
  assert.equal(model.state.sources.value[0].snapshot.saved_at, 10);
  assert.equal(model.state.sources.value[0].snapshot.articles[0].title, "上次文章");
  assert.equal(model.state.snapshot_errors.value.get("one"), "上游离线");
  assert.equal(model.state.list_error.value, "");
  assert.equal(model.state.snapshot_refreshing.value.length, 0);
});

test("快照请求失败按源展示，重试仅清除当前源错误，成功后恢复", async () => {
  const pending = new Map();
  const model = modal_model(url => new Promise(resolve => pending.set(url.split("/").at(-2), resolve)));
  model.state.sources.as(["one", "two"].map(id => ({ id, require_token: false })));
  model.state.list_error.set("列表错误");
  const first = model.methods.refresh_snapshot("one");
  const second = model.methods.refresh_snapshot("two");
  pending.get("one")(Response.json({ error: "设备离线" }, { status: 503 }));
  pending.get("two")(Response.json({ error: "上游超时" }, { status: 502 }));
  await Promise.all([first, second]);
  assert.equal(model.state.snapshot_errors.value.get("one"), "设备离线");
  assert.equal(model.state.snapshot_errors.value.get("two"), "上游超时");
  assert.equal(model.state.snapshot_refreshing.value.length, 0);
  const retry = model.methods.refresh_snapshot("one");
  assert.equal(model.state.snapshot_errors.value.get("one"), "");
  assert.equal(model.state.snapshot_errors.value.get("two"), "上游超时");
  pending.get("one")(Response.json({ snapshot: { saved_at: 20, articles: [], error: "" } }));
  await retry;
  assert.equal(model.state.snapshot_errors.value.get("one"), "");
  assert.equal(model.state.sources.value[0].snapshot.saved_at, 20);
  assert.equal(model.state.list_error.value, "列表错误");
});

test("后台可强制刷新自有私密源 XML，并更新快照状态而不显示文章", async () => {
  const calls = [];
  const model = modal_model(async (url, options) => {
    calls.push([url, options?.method]);
    return url.endsWith("/snapshot") ? Response.json({ snapshot: { saved_at: 0, articles: [], error: "" },
      cache: { status: "fresh", saved_at: 100, expires_at: 600100, persistent: true } }) : Response.json({ sources: [
      { id: "private", title: "私密源", require_token: true, feed_url: "{{hostname}}/rss/private",
        cache: { status: "empty", saved_at: 0 }, snapshot: { saved_at: 0, articles: [] } },
    ] });
  });
  await model.methods.refresh_list();
  await model.methods.refresh_snapshot("private");
  assert.deepEqual(calls[1], ["/admin/api/discovery/sources/private/snapshot", "POST"]);
  assert.equal(model.state.sources.value[0].cache.status, "fresh");
  assert.equal(model.state.sources.value[0].snapshot.articles.length, 0);
});

test("打开订阅源表单只请求 kind rss 的脚本；加载失败保留地址并可重新打开重试", async () => {
  let fail = false;
  const calls = [];
  const scripts = [{ kind: "rss", path: "/zhihu/answer", enabled: false, routes: [{ path: "/zhihu/answer" }, { path: "/zhihu/hot" }] }];
  const model = modal_model(async url => {
    calls.push(url);
    return fail ? Response.json({ error: "路由列表不可用" }, { status: 500 }) : Response.json({ scripts });
  });
  model.methods.create_source();
  await new Promise(setImmediate);
  assert.deepEqual(JSON.parse(JSON.stringify(model.state.scripts.value)), scripts);
  assert.equal(model.state.scripts_loading.value, false);
  assert.deepEqual(calls, ["/admin/api/scripts?kind=rss"]);
  model.methods.close_form();
  fail = true;
  model.methods.create_source();
  model.methods.set_draft("feed_url", "{{hostname}}/rss/z");
  await new Promise(setImmediate);
  assert.match(model.state.scripts_error.value, /路由列表不可用/);
  assert.equal(model.state.draft_feed_url.value, "{{hostname}}/rss/z");
  assert.equal(model.state.form_open.value, true);
  model.methods.close_form();
  fail = false;
  model.methods.create_source();
  await new Promise(setImmediate);
  assert.equal(model.state.scripts_error.value, "");
  assert.equal(calls.length, 3);
});

test("新增与编辑共用弹窗，取消清空草稿，保存失败保留表单，成功关闭", async () => {
  let fail = false;
  let finish;
  const calls = [];
  const source = { id: "one", title: "科技日报", feed_url: "https://example.com/rss/demo",
    feed_url_template: "{{hostname}}/rss/demo", tags: ["科技"], category: "science", enabled: false,
    website: "https://example.com", description: "科技资讯", sort_order: 0, require_token: false };
  const { state, methods } = modal_model((url, options) => {
    calls.push({ url, options });
    return new Promise(resolve => { finish = () => resolve(fail
      ? Response.json({ error: "保存失败" }, { status: 500 }) : Response.json({ source })); });
  });
  assert.equal(state.form_open.value, false);
  methods.create_source();
  assert.equal(state.form_open.value, true);
  assert.equal(state.draft_enabled.value, true);
  methods.set_draft("title", "草稿");
  methods.close_form();
  assert.equal(state.form_open.value, false);
  assert.equal(state.draft_title.value, "");
  state.sources.as([source]);
  methods.edit_source("one");
  assert.equal(state.form_open.value, true);
  assert.equal(state.draft_feed_url.value, "{{hostname}}/rss/demo");
  fail = true;
  let pending = methods.save_source();
  methods.close_form();
  assert.equal(state.form_open.value, true, "保存期间不可关闭");
  finish();
  await pending;
  assert.equal(state.form_open.value, true);
  assert.equal(state.draft_title.value, "科技日报");
  assert.equal(state.form_error.value, "保存失败");
  fail = false;
  pending = methods.save_source();
  finish();
  await pending;
  assert.equal(calls.at(-1).options.method, "PATCH");
  assert.equal(JSON.parse(calls.at(-1).options.body).enabled, false);
  assert.equal(state.form_open.value, false);
  assert.equal(state.editing_id.value, "");
  assert.equal(state.form_message.value, "科技日报 已保存。");
  methods.create_source();
  pending = methods.save_source();
  finish();
  await pending;
  assert.equal(calls.at(-1).options.method, "POST");
  assert.equal(JSON.parse(calls.at(-1).options.body).enabled, true);
});

test("头像上传失败保留弹窗，重试更新已创建源而不重复新增", async () => {
  const calls = [];
  let avatar_fails = true;
  const { state, methods } = modal_model(async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith("/avatar") && avatar_fails) return Response.json({ error: "上传失败" }, { status: 500 });
    return Response.json({ source: { id: "created", title: "示例源", enabled: true } });
  });
  methods.create_source();
  methods.set_draft("title", "示例源");
  methods.set_avatar_file(new File(["icon"], "avatar.png", { type: "image/png" }));
  await methods.save_source();
  assert.equal(state.form_open.value, true);
  assert.equal(state.editing_id.value, "created");
  assert.ok(state.avatar_file.value);
  assert.match(state.form_error.value, /已保存，但头像上传失败/);
  avatar_fails = false;
  await methods.save_source();
  assert.equal(calls.filter(call => call.options.method === "POST").length, 1);
  assert.equal(calls.filter(call => call.options.method === "PATCH").length, 1);
  assert.equal(state.sources.value.length, 1);
  assert.equal(state.form_open.value, false);
});

test("RSS 地址输入及失焦不读取订阅源，点击按钮才读取", () => {
  const nodes = [];
  const component = (props, children) => { nodes.push({ props, children }); return {}; };
  const calls = [];
  const ref = (value) => ({ value, set(next) { this.value = next; }, as(next) { this.value = next; } });
  const context = vm.createContext({ ...platform_helpers, RssRoutePatternModel, PaginationModel, PaginationView, URL, document: { querySelector: () => null }, window: {
    Timeless: { DOM: {}, ref, refarr: ref, computed: (source, map) => ({ get value() { return map(source.value); } }),
      combine: (sources, map) => ({ get value() { return map(Object.fromEntries(Object.entries(sources).map(([key, source]) => [key, source.value]))); } }),
      View: component, Input: component, FeedAddressEditor: component, Button: component, Select: component, Textarea: component, Dialog: component, Icon: component,
      Show: () => ({}), For: () => ({}),
    },
    FindRSSAdminShell: {}, FindRSSAdminPages: {}, FindRSSAdminAuth: { fetch() {} },
  } });
  context.window.FindRSSAdminUI = context.window.Timeless;
  context.window.FindRSSAdminUI.Card = context.window.Timeless.View;
  context.window.FindRSSAdminUI.Field = context.window.Timeless.View;
  context.window.FindRSSAdminUI.FilePicker = context.window.Timeless.Input;
  vm.runInContext(page_source("discovery.js") + '\nglobalThis.model = DiscoveryAdminViewModel();', context);
  context.model.methods.preview_feed = () => calls.push(context.model.state.draft_feed_url.value);
  vm.runInContext('SourceFormView({ store: model });', context);
  const input = nodes.find((node) => node.props.attributes?.n === 'discovery-source-feed-input');
  const button = nodes.find((node) => node.props.attributes?.n === 'discovery-source-preview-button');
  input.props.onInput({ target: { value: 'https://example.com/rss' } });
  assert.equal(context.model.state.draft_feed_url.value, 'https://example.com/rss');
  assert.equal(input.props.onChange, undefined);
  assert.equal(input.props.onBlur, undefined);
  assert.equal(button.props.disabled.value, false);
  context.model.state.editing_id.set("existing-source");
  assert.equal(button.props.disabled.value, false, "编辑订阅源时也能主动读取信息");
  context.model.state.saving.set(true);
  assert.equal(button.props.disabled.value, true);
  context.model.state.saving.set(false);
  context.model.state.previewing.set(true);
  assert.equal(button.props.disabled.value, true);
  context.model.state.previewing.set(false);
  assert.deepEqual(calls, []);
  button.props.onClick();
  assert.deepEqual(calls, ['https://example.com/rss']);
});

test("编辑订阅源可重复读取同一地址，只更新草稿并保留读取过程中修改的字段", async () => {
  const source = { id: "existing", title: "原名称", feed_url: "https://example.com/rss", website: "https://example.com",
    description: "原简介", tags: ["原标签"], sort_order: 0, enabled: false, require_token: true, source_type: "website" };
  const calls = [];
  let finish;
  const { state, methods } = modal_model((url, options) => {
    if (url === "/admin/api/scripts?kind=rss") return Promise.resolve(Response.json({ scripts: [] }));
    calls.push({ url, options });
    return new Promise(resolve => { finish = () => resolve(Response.json({ feed_url: source.feed_url,
      defaults: { title: "读取的名称", website: "https://example.com/new", description: "读取的简介", tags: ["新标签"], source_type: "zhihu" } })); });
  });
  state.sources.as([source]);
  methods.edit_source(source.id);
  const first = methods.preview_feed();
  assert.equal(state.previewing.value, true);
  await methods.preview_feed();
  assert.equal(calls.length, 1, "读取期间不重复发送请求");
  methods.set_draft("title", "手动修改的名称");
  methods.set_draft("source_type", "website");
  finish();
  await first;
  assert.equal(calls[0].url, "/admin/api/discovery/preview");
  assert.equal(calls[0].options.method, "POST");
  assert.equal(JSON.parse(calls[0].options.body).feed_url, source.feed_url);
  assert.equal(state.draft_title.value, "手动修改的名称");
  assert.equal(state.draft_description.value, "读取的简介");
  assert.equal(state.draft_website.value, "https://example.com/new");
  assert.equal(state.draft_tags.value, "新标签");
  assert.equal(state.draft_source_type.value, "website");
  assert.equal(state.editing_id.value, source.id);
  assert.equal(state.draft_enabled.value, false);
  assert.equal(state.draft_require_token.value, true);
  assert.equal(state.sources.value[0].title, "原名称", "读取不保存订阅源");
  assert.equal(state.previewing.value, false);
  const second = methods.preview_feed();
  assert.equal(calls.length, 2, "读取成功后允许再次读取同一地址");
  finish();
  await second;
  assert.equal(state.draft_title.value, "读取的名称");
  assert.equal(state.sources.value[0].title, "原名称");
});

test("新增源回填默认值，异步旧地址不覆盖新草稿，头像随源保存上传", async () => {
  const calls = [];
  let finish;
  const ref = (value) => ({ value, set(next) { this.value = next; }, as(next) { this.value = next; } });
  const context = vm.createContext({ ...platform_helpers, RssRoutePatternModel, PaginationModel, PaginationView, URL, File, Uint8Array, atob, document: { querySelector: () => null }, window: {
    Timeless: { DOM: {}, ref, refarr: ref, computed: () => ({}), combine: () => ({}) },
    FindRSSAdminShell: {}, FindRSSAdminPages: {}, FindRSSAdminAuth: { fetch(url, options) {
      calls.push({ url, options });
      if (url.endsWith('/preview')) return new Promise((resolve) => { finish = resolve; });
      return Promise.resolve(Response.json({ source: { id: 'new', title: '源', enabled: true } }));
    } },
  } });
  context.window.FindRSSAdminUI = context.window.Timeless;
  context.window.FindRSSAdminUI.Card = context.window.Timeless.View;
  context.window.FindRSSAdminUI.Field = context.window.Timeless.View;
  context.window.FindRSSAdminUI.FilePicker = context.window.Timeless.Input;
  vm.runInContext(page_source("discovery.js") + '\nglobalThis.model = DiscoveryAdminViewModel();', context);
  const model = context.model;
  const payload = { feed_url: 'https://example.com/rss', defaults: { title: '源', website: 'https://example.com', description: '介绍', category: 'science', tags: ['标签'], source_type: 'website' }, avatar: { data: 'aWNvbg==', content_type: 'image/png' } };
  model.methods.set_draft('feed_url', '{{hostname}}/rss/first');
  let pending = model.methods.preview_feed();
  model.methods.set_draft('feed_url', '{{hostname}}/rss/second');
  finish(Response.json(payload));
  await pending;
  assert.equal(model.state.draft_title.value, '');
  pending = model.methods.preview_feed();
  model.methods.set_draft('title', '手动名称');
  finish(Response.json(payload));
  await pending;
  assert.equal(model.state.draft_title.value, '手动名称');
  assert.equal(model.state.draft_tags.value, '标签');
  assert.equal(model.state.draft_category, undefined);
  assert.equal(model.state.avatar_file.value.type, 'image/png');
  await model.methods.save_source();
  const saved = calls.find((call) => call.options.method === 'POST' && call.url.endsWith('/sources'));
  assert.equal(JSON.parse(saved.options.body).feed_url, '{{hostname}}/rss/second');
  assert.ok(calls.some((call) => call.url.endsWith('/new/avatar') && call.options.method === 'PUT'));
});

test("读取信息时拦截非 RSS/Atom 模板地址，修正后及外部地址仍可读取", async () => {
  const calls = [];
  const model = modal_model(async (_url, options) => {
    const { feed_url } = JSON.parse(options.body);
    calls.push(feed_url);
    return Response.json({ feed_url, defaults: { title: "源", tags: [] } });
  });
  for (const address of ["{{hostname}}", "{{hostname}}/feed.xml", "{{hostname}}/admin",
    "{{hostname}}/rss-other/test", "{{hostname}}/atom.xml", "{{hostname}}.example.com/rss/test",
    "{{hostname}}/rss/../../admin", "{{hostname}}/atom/%2e%2e/feed.xml"]) {
    model.methods.set_draft("feed_url", address);
    await model.methods.preview_feed();
    assert.equal(model.state.form_error.value, "模板订阅源地址必须以 {{hostname}}/rss/ 或 {{hostname}}/atom/ 开头");
    assert.equal(model.state.form_message.value, "");
    assert.equal(model.state.previewing.value, false);
  }
  assert.deepEqual(calls, []);
  for (const address of ["{{hostname}}/rss/demo?offset=1", "{{hostname}}/atom/demo", "https://example.com/feed.xml"]) {
    model.methods.set_draft("feed_url", address);
    await model.methods.preview_feed();
    assert.equal(model.state.form_error.value, "");
    assert.equal(calls.at(-1), address);
  }
});

test("读取订阅源信息失败时展示具体错误描述，清除读取中提示且允许重试", async () => {
  const message = "脚本执行失败：脚本异常：小红书笔记缺少有效的 noteId";
  let calls = 0;
  const ref = value => ({ value, set(next) { this.value = next; }, as(next) { this.value = next; } });
  const context = vm.createContext({ ...platform_helpers, RssRoutePatternModel, PaginationModel, PaginationView, URL, document: { querySelector: () => null }, window: {
    Timeless: { DOM: {}, ref, refarr: ref, computed: () => ({}), combine: () => ({}) }, FindRSSAdminShell: {}, FindRSSAdminPages: {},
    FindRSSAdminAuth: { fetch: async () => { calls++; return Response.json({ error: message }, { status: 502 }); } },
  } });
  context.window.FindRSSAdminUI = context.window.Timeless;
  vm.runInContext(page_source("discovery.js") + "\nglobalThis.model = DiscoveryAdminViewModel();", context);
  const model = context.model;
  model.methods.set_draft("feed_url", "{{hostname}}/rss/xiaohongshu/user/5756ecbb5e87e74222938eac");
  await model.methods.preview_feed();
  assert.equal(model.state.form_error.value, message);
  assert.equal(model.state.form_message.value, "");
  assert.equal(model.state.previewing.value, false);
  await model.methods.preview_feed();
  assert.equal(calls, 2);
});


test("后台编辑将旧分类带入标签，保存不再设置分类，新增地址识别平台", async () => {
  let saved;
  const source = { id: "old", title: "旧源", feed_url: "https://example.com/feed", category: "technology", tags: ["文章"], enabled: true, source_type: "x" };
  const model = modal_model(async (url, options) => {
    if (options?.method === "PATCH") saved = JSON.parse(options.body);
    return Response.json({ sources: [source], source, scripts: [{ kind: "rss", platform: "douyin", path: "/douyin/user/:id" }] });
  });
  model.methods.start();
  await new Promise(setImmediate);
  model.methods.edit_source("old");
  assert.equal(model.state.draft_tags.value, "文章, 科技");
  await model.methods.save_source();
  assert.equal(saved.category, "");
  assert.deepEqual(saved.tags, ["文章", "科技"]);
  assert.equal(saved.source_type, "x");
  model.methods.create_source();
  await new Promise(setImmediate);
  model.methods.set_draft("feed_url", "{{hostname}}/atom/douyin/user/a");
  assert.equal(model.state.draft_source_type.value, "douyin");
  model.methods.set_draft("source_type", "zhihu");
  model.methods.set_draft("feed_url", "{{hostname}}/rss/x/user/a");
  assert.equal(model.state.draft_source_type.value, "zhihu");
});


test("操作后刷新列表时较早的读取迟到不会覆盖最新订阅源或重设加载状态", async () => {
  const pending = [];
  const model = modal_model(() => new Promise(resolve => pending.push(resolve)));
  const first = model.methods.refresh_list();
  const latest = model.methods.refresh_list();
  pending[1](Response.json({ sources: [{ id: "new", title: "最新源", feed_url: "https://example.com/new" }] }));
  await latest;
  assert.equal(model.state.sources.value[0].id, "new");
  assert.equal(model.state.loading.value, false);
  pending[0](Response.json({ sources: [{ id: "old", title: "旧源", feed_url: "https://example.com/old" }] }));
  await first;
  assert.equal(model.state.sources.value[0].id, "new");
  assert.equal(model.state.loading.value, false);
});
