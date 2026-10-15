import assert from "node:assert/strict";
import test from "node:test";
import { TextSelection } from "prosemirror-state";
import { FeedAddressEditorModel } from "../components/feed_address_model.js";

const scripts = [
  { kind: "rss", name: "知乎回答", path: "/zhihu/answer", enabled: true },
  { kind: "rss", name: "知乎", enabled: false, routes: [
    { path: "/zhihu/hot" }, { path: "/zhihu/user/:id" },
    { path: "/zhihu/images" },
  ] },
  { kind: "rss", name: "微博", path: "/weibo/hot", enabled: true },
  { kind: "rss", name: "重复路径", path: "/zhihu/answer", enabled: true },
];
const key = (model, key, extra = {}) => model.keydown({ key, ...extra });
function focused_model(options) {
  const model = FeedAddressEditorModel({ scripts, ...options });
  model.set_focus(true);
  return model;
}

function selected_text(model) {
  const { editor_state } = model.snapshot();
  return editor_state.doc.textBetween(editor_state.selection.from, editor_state.selection.to);
}

test("空地址只有占位提示，不产生默认文本或 Tab 补全", () => {
  const changes = [];
  const model = focused_model({ onChange: value => changes.push(value) });
  assert.equal(model.snapshot().text, "");
  assert.equal(model.snapshot().placeholder_visible, true);
  assert.equal(key(model, "Tab"), false);
  assert.deepEqual(changes, []);
  model.insert_text("{");
  assert.equal(model.snapshot().text, "{");
  assert.equal(model.snapshot().placeholder_visible, false);
  key(model, "z", { metaKey: true });
  assert.equal(model.snapshot().text, "");
  assert.equal(model.snapshot().placeholder_visible, true);
});

test("动态路径补全选中首个参数，替换后 Tab 按新位置选中后续参数", () => {
  const model = focused_model({ value: "{{hostname}}/rss/z", scripts: [
    { kind: "rss", path: "/zhihu/user/:id{[0-9]+}/:kind?/:page" },
  ] });
  assert.equal(key(model, "Tab"), true);
  assert.equal(model.snapshot().text, "{{hostname}}/rss/zhihu/user/:id/:kind/:page");
  assert.equal(selected_text(model), ":id");
  model.insert_text("123456789");
  assert.equal(key(model, "Tab"), true);
  assert.equal(selected_text(model), ":kind");
  model.insert_text("answer");
  key(model, "Tab", { shiftKey: true });
  assert.equal(selected_text(model), "123456789");
  model.insert_text("7");
  key(model, "Tab");
  assert.equal(selected_text(model), "answer");
  key(model, "Tab");
  assert.equal(selected_text(model), ":page");
  model.insert_text("2");
  assert.equal(key(model, "Tab"), true);
  assert.equal(model.snapshot().text, "{{hostname}}/rss/zhihu/user/7/answer/2");
  assert.equal(model.snapshot().snippet, null);
  assert.equal(model.snapshot().editor_state.selection.from, model.snapshot().text.length);
  assert.equal(key(model, "Tab"), false, "退出片段后 Tab 恢复焦点切换");
});

test("片段跟踪多次输入和空参数；Esc、失焦、外部回填及跨参数编辑退出导航", () => {
  const options = { value: "https://feeds.example.com/atom/demo/", scripts: [{ kind: "rss", path: "/demo/:first/:second" }] };
  const model = focused_model(options);
  key(model, "Tab");
  model.insert_text("a");
  model.insert_text("bc");
  key(model, "Tab");
  assert.equal(selected_text(model), ":second");
  model.insert_text("");
  key(model, "Tab", { shiftKey: true });
  assert.equal(selected_text(model), "abc");
  assert.equal(key(model, "Escape"), true);
  assert.equal(model.snapshot().snippet, null);
  assert.equal(key(model, "Tab"), false);
  for (const exit of [
    model => model.set_focus(false),
    model => model.set_value("https://example.com/feed.xml"),
    model => model.dispatch(model.snapshot().editor_state.tr.setSelection(TextSelection.create(model.snapshot().editor_state.doc, 0))),
    model => model.dispatch(model.snapshot().editor_state.tr.insertText("changed", 0, 5)),
  ]) {
    const model = focused_model(options);
    key(model, "Tab");
    assert.ok(model.snapshot().snippet);
    exit(model);
    assert.equal(model.snapshot().snippet, null);
  }
});

test("hostname 逐字提示，未接受的尾文不进入草稿；Tab 补全可撤销", () => {
  const changes = [];
  const model = focused_model({ onChange: value => changes.push(value) });
  model.insert_text("{");
  assert.equal(model.snapshot().text, "{");
  assert.equal(model.snapshot().ghost, "{hostname}}");
  assert.deepEqual(changes, ["{"]);
  assert.equal(key(model, "Tab", { shiftKey: true }), false);
  assert.equal(key(model, "Tab"), true);
  assert.equal(model.snapshot().text, "{{hostname}}");
  assert.equal(key(model, "z", { metaKey: true }), true);
  assert.equal(model.snapshot().text, "{", "只撤销补全，保留输入前缀");
  key(model, "z", { metaKey: true, shiftKey: true });
  assert.equal(model.snapshot().text, "{{hostname}}");
  model.insert_text("/rss/");
  key(model, "z", { ctrlKey: true });
  assert.equal(model.snapshot().text, "{{hostname}}", "补全后的输入单独撤销");
  key(model, "z", { ctrlKey: true });
  assert.equal(model.snapshot().text, "{");
  model.set_value("{{host");
  assert.equal(model.snapshot().ghost, "name}}");
});

test("RSS/Atom 匹配 脚本全部声明路径、保留域名与模板并去重", () => {
  const model = focused_model();
  for (const prefix of ["", "{{hostname}}", "https://feeds.example.com:8787", "http://localhost"]) {
    for (const format of ["rss", "atom"]) {
      model.set_value(prefix + "/" + format + "/z");
      const snapshot = model.snapshot();
      assert.deepEqual(snapshot.suggestions.map(route => route.value), [
        prefix + "/" + format + "/zhihu/answer", prefix + "/" + format + "/zhihu/hot",
        prefix + "/" + format + "/zhihu/images",
        prefix + "/" + format + "/zhihu/user/:id",
      ]);
      assert.equal(snapshot.suggestions[1].disabled, true);
      assert.equal(snapshot.ghost, "hihu/answer");
      assert.equal(key(model, "ArrowDown"), true);
      assert.equal(model.snapshot().ghost, "hihu/hot");
      key(model, "Tab");
      assert.equal(model.snapshot().text, prefix + "/" + format + "/zhihu/hot");
    }
  }
});

test("选择、收起、失焦、输入法及只读状态保留正常键盘行为", () => {
  const model = focused_model({ value: "/rss/z" });
  key(model, "ArrowUp");
  assert.equal(model.snapshot().selected, 3);
  assert.equal(key(model, "Escape"), true);
  assert.equal(model.snapshot().ghost, "");
  assert.equal(key(model, "Tab"), false);
  assert.equal(key(model, "Escape"), false, "收起后再次 Esc 交还弹窗");
  model.insert_text("h");
  assert.equal(model.snapshot().suggestions.length, 4);
  const state = model.snapshot().editor_state;
  model.dispatch(state.tr.setSelection(TextSelection.create(state.doc, 2)));
  assert.equal(model.snapshot().suggestions.length, 0, "中间编辑不补全");
  model.set_value("/rss/z");
  model.set_composing(true);
  assert.equal(model.snapshot().ghost, "");
  assert.equal(key(model, "Enter"), false);
  model.set_composing(false);
  model.set_focus(false);
  assert.equal(model.snapshot().suggestions.length, 0);
  model.set_focus(true);
  model.set_disabled(true);
  model.insert_text("oops");
  assert.equal(model.snapshot().text, "/rss/z");
  assert.equal(model.accept(), false);
});

test("地址为有长度上限的单行纯文本，查询参数和普通 URL 不触发路由提示", () => {
  const model = focused_model();
  model.insert_text("{{hostname}}\n/rss/\r\nz");
  assert.equal(model.snapshot().text, "{{hostname}}/rss/z");
  model.set_scripts([{ kind: "rss", path: "/zhihu/answer" }]);
  assert.equal(model.snapshot().suggestions.length, 1);
  for (const address of ["", "https://example.com/feed.xml", "/rss/zhihu/hot?filter=/rss/z", "{{hostname}}/rss/z#hash"]) {
    model.set_value(address);
    assert.equal(model.snapshot().suggestions.length, 0);
    assert.equal(key(model, "Enter"), true, "阻止换行");
  }
  model.set_value("x".repeat(2047));
  model.insert_text("123");
  assert.equal(model.snapshot().text.length, 2048);
  const state = model.snapshot().editor_state;
  model.dispatch(state.tr.insertText("overflow"));
  assert.equal(model.snapshot().text.length, 2048);
});

test("智能提示只列 kind rss，热榜的主路径和多路由都不参与补全", () => {
  const mixed_scripts = [
    { kind: "hot", path: "/demo/hot", routes: [{ path: "/demo/rss" }, { path: "/demo/hidden" }] },
    { kind: "hot", path: "/demo/rank" },
    { path: "/demo/unknown" },
    { kind: "rss", name: "RSS 源", path: "/demo/rss", enabled: false, routes: [{ path: "/demo/rss" }, { path: "/demo/user/:id" }] },
  ];
  const model = focused_model({ scripts: mixed_scripts });
  for (const format of ["rss", "atom"]) {
    model.set_value("{{hostname}}/" + format + "/demo/");
    assert.deepEqual(model.snapshot().suggestions.map(route => route.path), ["/demo/rss", "/demo/user/:id"]);
    assert.equal(model.snapshot().suggestions[0].label, "RSS 源");
    assert.equal(model.snapshot().suggestions[0].disabled, true);
  }
  model.set_scripts(mixed_scripts.filter(script => script.kind !== "rss"));
  assert.deepEqual(model.snapshot().suggestions, []);
  assert.equal(key(model, "Tab"), false);
});
