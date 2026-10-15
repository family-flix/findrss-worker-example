import assert from "node:assert/strict";
import test from "node:test";
import { home_source as source, initialize_home } from "./home_fixture.js";
import vm from "node:vm";

function fixture(writeText) {
  let now = 0, next_timer = 0;
  const timers = new Map();
  const ref = value => ({ value, set(next) { this.value = next; } });
  const component = (props, children) => ({ props, children });
  const context = vm.createContext({ navigator: { clipboard: { writeText } },
    document: { readyState: "loading", addEventListener() {} },
    window: { Timeless: { DOM: {}, ref, View: component, Button: component,
      computed: (input, map) => ({ get value() { return map(input.value); } }),
    } },
    setTimeout(callback, delay) { const id = ++next_timer; timers.set(id, { callback, at: now + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
  });
  initialize_home(context, vm);
  return { context, model: context.model, advance(ms) {
    now += ms;
    for (const [id, timer] of timers) if (timer.at <= now) { timers.delete(id); timer.callback(); }
  } };
}

test("成功复制后显示勾选，恰好两秒后恢复，各卡片状态独立", async () => {
  const writes = [];
  const { model, advance } = fixture(async url => writes.push(url));
  const first = "https://example.com/rss/one", second = "https://example.com/rss/two";
  await model.methods.copy_feed_url(first);
  assert.equal(model.methods.copy_status(first).value, "copied");
  advance(1000);
  await model.methods.copy_feed_url(second);
  advance(999);
  assert.equal(model.methods.copy_status(first).value, "copied");
  advance(1);
  assert.equal(model.methods.copy_status(first).value, "idle");
  assert.equal(model.methods.copy_status(second).value, "copied");
  advance(1000);
  assert.equal(model.methods.copy_status(second).value, "idle");
  assert.deepEqual(writes, [first, second]);
});

test("等待剪贴板时避免重复写入，再次复制后重新计时；失败不显示勾选", async () => {
  let finish, writes = 0;
  const { model, advance } = fixture(() => { writes++; return new Promise(resolve => { finish = resolve; }); });
  const url = "https://example.com/feed";
  const first = model.methods.copy_feed_url(url);
  assert.equal(model.methods.copy_status(url).value, "copying");
  await model.methods.copy_feed_url(url);
  assert.equal(writes, 1);
  finish(); await first;
  advance(1500);
  const second = model.methods.copy_feed_url(url);
  finish(); await second;
  advance(500);
  assert.equal(model.methods.copy_status(url).value, "copied");
  advance(1500);
  assert.equal(model.methods.copy_status(url).value, "idle");
  const failed = fixture(async () => { throw new Error("clipboard denied"); });
  await failed.model.methods.copy_feed_url(url);
  assert.equal(failed.model.methods.copy_status(url).value, "error");
  failed.advance(2000);
  assert.equal(failed.model.methods.copy_status(url).value, "idle");
});

test("卡片只保留复制按钮，成功样式和读屏反馈同步改变", async () => {
  const { context, model, advance } = fixture(async () => {});
  vm.runInContext('globalThis.view = FeedCopyButtonView({ vm$: model, feed: { title: "源", feed_url: "https://example.com/feed" } });', context);
  const [button, status] = context.view.children;
  assert.equal(button.children[0].props.attributes.n, "feed-copy-icon");
  assert.equal(button.props.class.value, "btn feed-copy-button");
  await model.methods.copy_feed_url("https://example.com/feed");
  assert.equal(button.props.class.value, "btn feed-copy-button is-copied");
  assert.equal(status.children[0].value, "RSS 地址已复制");
  advance(2000);
  assert.equal(button.props.class.value, "btn feed-copy-button");
  assert.equal(source.includes('n: "feed-preview-button"'), false);
  assert.equal(source.includes('n: "feed-open-link"'), false);
  assert.equal(source.includes("PreviewPanelView"), false);
});
