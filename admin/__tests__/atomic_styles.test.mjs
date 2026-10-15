import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { syntax } from "csso";
import { build } from "esbuild";
import vm from "node:vm";

const root = fileURLToPath(new URL("../", import.meta.url));
const stylesheet = readFileSync(resolve(root, "style.css"), "utf8");
const utilities = [];
const class_names = new Set();
syntax.walk(syntax.parse(stylesheet), { visit: "Rule", enter(rule) {
  if (rule.prelude.type !== "SelectorList") return;
  const selectors = rule.prelude.children.toArray();
  if (selectors.every(selector => selector.children.toArray().every(node => node.type === "TypeSelector" || node.type === "Percentage"))) return;
  assert.equal(selectors.length, 1, syntax.generate(rule.prelude));
  const nodes = selectors[0].children.toArray();
  assert.equal(nodes[0].type, "ClassSelector", syntax.generate(rule.prelude));
  assert.ok(nodes.slice(1).every(node => ["PseudoClassSelector", "PseudoElementSelector", "AttributeSelector"].includes(node.type)), syntax.generate(rule.prelude));
  class_names.add(nodes[0].name);
  const declarations = rule.block.children.toArray();
  assert.equal(declarations.length, 1, syntax.generate(rule.prelude));
  utilities.push({ name: nodes[0].name, property: declarations[0].property, selector: syntax.generate(rule.prelude), body: syntax.generate(declarations[0]) });
} });

test("后台样式只声明单属性原子类，尺寸由调用方 style 提供", () => {
  assert.ok(utilities.length > 100);
  assert.doesNotMatch(stylesheet, /@import/);
  for (const { selector, body } of utilities) {
    assert.match(selector, /^\.[a-z][a-z0-9-]*/, selector);
    assert.equal(body.split(";").filter(value => value.trim()).length, 1, selector);
    assert.doesNotMatch(body, /\b\d+(?:\.\d+)?(?:px|rem|em|vh|vw|dvh)\b/, selector);
  }
});

test("页面与本地组件声明的静态类均来自同一份原子样式", () => {
  function check_directory(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name !== "__tests__") { check_directory(resolve(directory, entry.name)); continue; }
      if (!entry.isFile() || !/\.(js|html)$/.test(entry.name)) continue;
      const path = resolve(directory, entry.name), source = readFileSync(path, "utf8");
      const pattern = entry.name.endsWith(".html") ? /\bclass="([^"]*)"/g : /(?:\bclass|["']class["']):\s*["']([^"'\n]*)["']/g;
      for (const [, value] of source.matchAll(pattern)) {
        for (const name of value.trim().split(/\s+/).filter(Boolean)) assert.ok(class_names.has(name), path + ": " + name);
      }
    }
  }
  check_directory(root);
});

test("响应式原子类从宽屏到窄屏排列，覆盖显式传入的默认尺寸", () => {
  const widths = [...stylesheet.matchAll(/@media \(max-width:\s*(\d+)px\)/g)].map(match => Number(match[1]));
  assert.deepEqual(widths, [...widths].sort((a, b) => b - a));
  for (const { selector, body } of utilities.filter(rule => /^\.max-\d+-/.test(rule.selector))) {
    assert.match(body, /var\(--max-.*\)\s*!important/, selector);
  }
});

test("原子类按属性合并，调用方和响应式状态覆盖默认值", async () => {
  const bundle = await build({ entryPoints: [resolve(root, "components/frui/atomic.js")], bundle: true,
    format: "cjs", write: false });
  const context = vm.createContext({ setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {} });
  vm.runInContext(readFileSync(resolve(root, "../public/assets/timeless/0.34.2/timeless.umd.min.js"), "utf8"), context);
  context.module = { exports: {} };
  vm.runInContext(bundle.outputFiles[0].text, context);
  const { atomic_classes, atomic_class_group } = context.module.exports;
  for (const { name, property } of utilities) {
    const expected = property === "background-color" ? "background" : property.replace(/^-+/, "");
    assert.ok(atomic_class_group(name).endsWith(expected), name + ": " + property);
  }
  assert.equal(atomic_classes("background-color-surface-raised background-transparent"), "background-transparent");
  assert.equal(atomic_classes("width-100-percent w-auto hover-color-color-text color-color-danger"), "w-auto hover-color-color-text color-color-danger");
  assert.equal(atomic_classes("max-640-width w-full max-640-width"), "w-full max-640-width");
  const source = context.Timeless.ref("display-flex hidden");
  const merged = atomic_classes(source);
  assert.equal(merged.value, "hidden");
  source.set("display-flex");
  assert.equal(merged.value, "display-flex");
  merged.destroy(); source.destroy();
});
