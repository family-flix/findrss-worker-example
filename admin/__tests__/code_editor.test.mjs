import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { source_value, subscribe_source, dispose_all } from "../components/frui/shared.js";

test("CodeMirror 同步 Model 草稿、只读状态，并在卸载时释放订阅", () => {
  function ref(value) {
    const handlers = new Set();
    return { value, handlers,
      subscribe({ onChange }) { handlers.add(onChange); return () => handlers.delete(onChange); },
      set(next) { this.value = next; for (const handler of handlers) handler(next); },
    };
  }
  const value = ref("export const route = {};");
  const disabled = ref(true);
  const wrapper = new Map(), input = new Map(), wrapper_style = {};
  let options, change_handler, text, resets = 0, destroyed = false;
  const editor = {
    getWrapperElement: () => ({ style: wrapper_style, setAttribute: (key, value) => wrapper.set(key, value) }),
    getInputField: () => ({ setAttribute: (key, value) => input.set(key, value) }),
    getValue: () => text,
    setValue(next) { text = next; change_handler(editor, { origin: "setValue" }); },
    clearHistory() { resets++; },
    on(name, handler) { assert.equal(name, "change"); change_handler = handler; },
    setOption(key, value) { options[key] = value; },
    toTextArea() { destroyed = true; },
  };
  const CodeEditor = vm.runInNewContext(
    "(" + readFileSync(new URL("../components/code_editor.js", import.meta.url), "utf8")
      .match(/function CodeEditor\([^]*?\n\}/)[0] + ")",
    { Textarea: props => props, source_value, subscribe_source, dispose_all,
      CodeMirror: { fromTextArea(textarea, config) { text = textarea.value; options = config; return editor; } } },
  );
  let changes = 0;
  const view = CodeEditor({ value, disabled, wrapperStyle: { height: "360px" },
    attributes: { n: "script-code", "aria-label": "脚本内容" },
    onInput(event) { changes++; value.set(event.target.value); },
  });
  view.onMounted({ target: { get$elm: () => ({ value: value.value }) } });
  assert.equal(options.mode, "javascript");
  assert.equal(wrapper_style.height, "360px");
  assert.equal(options.lineNumbers, true);
  assert.equal(options.readOnly, "nocursor");
  assert.equal(options.extraKeys.Tab, false);
  assert.equal(wrapper.get("data-n"), "script-code-editor");
  assert.equal(input.get("aria-label"), "脚本内容");
  disabled.set(false);
  assert.equal(options.readOnly, false);

  text = "// 手动编辑\nexport const route = { path: '/new' };";
  change_handler(editor, { origin: "+input" });
  assert.equal(value.value, text);
  assert.equal(changes, 1);
  assert.equal(resets, 0, "用户输入保留撤销历史");
  value.set("// 填入模板");
  assert.equal(text, "// 填入模板");
  assert.equal(changes, 1, "Model 更新不回触发输入");
  assert.equal(resets, 1);
  value.set("");
  assert.equal(text, "");
  disabled.set(true);
  assert.equal(options.readOnly, "nocursor");
  view.onUnmounted();
  assert.equal(destroyed, true);
  assert.equal(value.handlers.size, 0);
  assert.equal(disabled.handlers.size, 0);
});

test("只读输出允许选择复制，响应类型切换时更新 mode，并释放 mode 订阅", () => {
  const make_ref = value => {
    const handlers = new Set();
    return { value, handlers,
      subscribe({ onChange }) { handlers.add(onChange); return () => handlers.delete(onChange); },
      set(next) { this.value = next; for (const handler of handlers) handler(next); },
    };
  };
  const mode = make_ref("application/json"), disabled = make_ref(false), readonly = make_ref(true);
  let options, change_handler;
  const editor = {
    getWrapperElement: () => ({ style: {}, setAttribute() {} }), getInputField: () => ({ setAttribute() {} }),
    getValue: () => '{}', on(_name, handler) { change_handler = handler; },
    setOption(key, value) { options[key] = value; }, toTextArea() {},
  };
  const CodeEditor = vm.runInNewContext(
    "(" + readFileSync(new URL("../components/code_editor.js", import.meta.url), "utf8")
      .match(/function CodeEditor\([^]*?\n\}/)[0] + ")",
    { Textarea: props => props, source_value, subscribe_source, dispose_all,
      CodeMirror: { fromTextArea(_textarea, config) { options = config; return editor; } } },
  );
  const view = CodeEditor({ value: "{}", mode, disabled, readOnly: readonly,
    attributes: { n: "response", "aria-label": "路由输出" } });
  view.onMounted({ target: {} });
  assert.equal(options.readOnly, true, "只读而不禁用焦点，允许选择复制");
  assert.equal(options.mode, "application/json");
  mode.set("text/html");
  assert.equal(options.mode, "text/html");
  mode.set("application/xml");
  assert.equal(options.mode, "application/xml");
  disabled.set(true);
  assert.equal(options.readOnly, "nocursor");
  disabled.set(false);
  assert.equal(options.readOnly, true, "重新启用后仍然只读");
  assert.doesNotThrow(() => change_handler(editor, { origin: "+input" }), "只读输出不要求 onInput");
  view.onUnmounted();
  assert.equal(mode.handlers.size, 0);
  assert.equal(readonly.handlers.size, 0);
  assert.equal(disabled.handlers.size, 0);
});
