import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { ScriptDebugOutputModel } from "../components/script_output.js";

const response = (body, content_type) => JSON.stringify({ body, content_type });

test("JSON 返回值展开缩进，保留大整数和字符串转义，响应描述只显示实际正文", () => {
  const raw = '{"id":9007199254740993123,"items":[{"title":"中文","content":"line\\nnext"}]}';
  const output = ScriptDebugOutputModel(raw);
  assert.equal(output.mode, "application/json");
  assert.match(output.formatted, /\n  "id": 9007199254740993123,/);
  assert.match(output.formatted, /line\\nnext/);
  assert.equal(output.source, raw);
  assert.deepEqual(JSON.parse(output.formatted), JSON.parse(raw));
  for (const content_type of ["application/json; charset=utf-8", "application/problem+json", "Application/JSON"]) {
    const result = ScriptDebugOutputModel(response(raw, content_type));
    assert.equal(result.source, raw);
    assert.equal(result.mode, "application/json");
    assert.equal(result.formatted, output.formatted);
    assert.doesNotMatch(result.formatted, /content_type/);
  }
});

test("HTML 与其中的脚本/样式格式化，保留 pre、textarea 与文本中的 HTML 字符串", () => {
  const raw = '<!doctype html><html><body><h1>标题</h1><pre>a  b\n c</pre><textarea>a  b</textarea><script>const x={a:1};</script><style>a{color:red}</style></body></html>';
  const output = ScriptDebugOutputModel(response(raw, "text/html; charset=utf-8"));
  assert.equal(output.mode, "text/html");
  assert.match(output.formatted, /\n    <h1>标题<\/h1>/);
  assert.match(output.formatted, /<pre>a  b\n c<\/pre>/);
  assert.match(output.formatted, /<textarea>a  b<\/textarea>/);
  assert.match(output.formatted, /const x = \{\n\s+a: 1/);
  assert.match(output.formatted, /color: red/);
  assert.equal(ScriptDebugOutputModel(JSON.stringify(raw)).mode, "text/html");
});

test("XML、RSS、Atom 与 SVG 根据 MIME 高亮，保留命名空间、CDATA、实体和大小写", () => {
  const raw = '<?xml version="1.0"?><rss xmlns:media="urn:media"><channel><link>https://example.com</link><Item ID="A"><media:content><![CDATA[<p>原文</p>]]></media:content><title>A &amp; B</title></Item></channel></rss>';
  for (const content_type of ["application/xml", "text/xml", "application/rss+xml", "application/atom+xml", "image/svg+xml"]) {
    const output = ScriptDebugOutputModel(response(raw, content_type));
    assert.equal(output.mode, "application/xml");
    assert.match(output.formatted, /\n  <channel>\n    <link>https:\/\/example.com<\/link>/);
    assert.match(output.formatted, /<Item ID="A">/);
    assert.match(output.formatted, /xmlns:media="urn:media"/);
    assert.match(output.formatted, /<!\[CDATA\[<p>原文<\/p>\]\]>/);
    assert.match(output.formatted, /A &amp; B/);
  }
  assert.equal(ScriptDebugOutputModel(JSON.stringify(raw)).mode, "application/xml");
});

test("JS/CSS 响应选择相应模式；未知类型、纯文本和非法 JSON 安全保留正文", () => {
  const js = ScriptDebugOutputModel(response('const x={a:1};', 'application/javascript'));
  assert.equal(js.mode, "javascript");
  assert.match(js.formatted, /const x = \{\n  a: 1/);
  const css = ScriptDebugOutputModel(response('a{color:red}', 'text/css'));
  assert.equal(css.mode, "text/css");
  assert.match(css.formatted, /a \{\n  color: red/);
  for (const content_type of ["text/plain", "application/octet-stream"]) {
    const plain = ScriptDebugOutputModel(response('x  y\n z', content_type));
    assert.equal(plain.mode, "text/plain");
    assert.equal(plain.formatted, 'x  y\n z');
  }
  const invalid = ScriptDebugOutputModel(response('{"broken":', 'application/json'));
  assert.equal(invalid.mode, "application/json");
  assert.equal(invalid.formatted, '{"broken":');
  assert.equal(ScriptDebugOutputModel(undefined).formatted, "执行失败，未生成输出");
  const descriptor = ScriptDebugOutputModel('{"url":"https://example.com/image.png","headers":{}}');
  assert.equal(descriptor.mode, "application/json");
  assert.match(descriptor.formatted, /"url": "https:/);
});

test("CodeMirror Node tokenizer 实际识别 JSON/XML/HTML 内嵌 JS/CSS，不依赖浏览器", () => {
  const require = createRequire(import.meta.url);
  const CodeMirror = require("codemirror/addon/runmode/runmode.node.js");
  // 与组件加载完全相同的 mode 文件。
  const source = readFileSync(new URL("../components/code_editor.js", import.meta.url), "utf8");
  for (const [, path] of source.matchAll(/import "(codemirror\/mode\/[^\"]+)";/g)) require(path);
  const tokens = output => {
    const values = [];
    CodeMirror.runMode(output.formatted, output.mode, (text, style) => values.push({ text, style }));
    return values;
  };
  const json = tokens(ScriptDebugOutputModel('{"title":"text","count":12}'));
  assert.ok(json.some(token => token.text === '"title"' && token.style?.split(" ").includes("property")));
  assert.ok(json.some(token => token.text === "12" && token.style === "number"));
  const html = tokens(ScriptDebugOutputModel(response('<div class="a"><script>const n=1;</script><style>a{color:red}</style></div>', "text/html")));
  assert.ok(html.some(token => token.text === "div" && token.style === "tag"));
  assert.ok(html.some(token => token.text === "const" && token.style === "keyword"));
  assert.ok(html.some(token => token.text === "color" && token.style === "property"));
  const xml = tokens(ScriptDebugOutputModel(response('<feed><entry>text</entry></feed>', "application/atom+xml")));
  assert.ok(xml.some(token => token.text === "entry" && token.style === "tag"));
  assert.ok(!xml.some(token => token.style === "error"));
});
