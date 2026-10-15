import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { page_source } from "./page_source.mjs";

const pages = ["dashboard", "discovery", "script", "cookies", "redemptions", "users", "activity", "messages", "login"];

test("每个后台页面都有独立模型，视图不再定义页面模型，模型不创建视图节点", () => {
  for (const name of pages) {
    const read = suffix => readFileSync(new URL("../pages/" + name + suffix, import.meta.url), "utf8");
    const view = read(".js"), model = read(".model.js");
    assert.ok(view.includes("./" + name + ".model.js"), name);
    assert.doesNotMatch(view, /\bfunction\s+\w*Model\s*\(/, name);
    assert.match(model, /\bfunction\s+\w*Model\s*\(/, name);
    assert.doesNotMatch(model, /\b(?:View|Button|Input|Select|Textarea|Dialog|For|Show)\s*\(/, name);
    assert.doesNotThrow(() => new vm.Script(page_source(name + ".js")), name);
    assert.doesNotMatch(model, new RegExp('from ["\\\']\\./' + name + '\\.js["\\\']'), name);
  }
});
