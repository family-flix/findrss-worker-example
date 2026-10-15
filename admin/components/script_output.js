import javascript from "js-beautify/js/lib/beautify.js";
import html from "js-beautify/js/lib/beautify-html.js";
import css from "js-beautify/js/lib/beautify-css.js";

const options = { indent_size: 2, preserve_newlines: true, max_preserve_newlines: 2, end_with_newline: false };

function inferred_content_type(text) {
  try { JSON.parse(text); return "application/json"; } catch {}
  if (/^\s*(?:<\?xml\b|<(?:rss|feed|svg)\b)/i.test(text)) return "application/xml";
  if (/^\s*<(?:!doctype\s+html|[a-z][\w:-]*(?:\s|\/?>))/i.test(text)) return "text/html";
  return "text/plain";
}

// QuickJS 的 output 是 JSON 序列化后的返回值；响应描述的 body 才是实际正文。
export function ScriptDebugOutputModel(output) {
  let source = typeof output === "string" ? output : "执行失败，未生成输出";
  let content_type;
  try {
    const value = JSON.parse(source);
    if (value && typeof value === "object" && typeof value.body === "string") {
      source = value.body;
      content_type = typeof value.content_type === "string" ? value.content_type : "text/plain";
    } else if (typeof value === "string") {
      source = value;
    } else {
      content_type = "application/json";
    }
  } catch {}
  content_type = (content_type || inferred_content_type(source)).split(";", 1)[0].trim().toLowerCase();
  let mode = "text/plain", label = "文本", format = value => value;
  if (content_type === "application/json" || content_type.endsWith("+json")) {
    mode = "application/json"; label = "JSON";
    // 保留原始数字与转义字符串，避免 JSON.parse → stringify 改写大整数。
    format = value => { JSON.parse(value); return javascript.js_beautify(value, options); };
  } else if (content_type === "text/html" || content_type === "application/xhtml+xml") {
    mode = "text/html"; label = "HTML";
    format = value => html.html_beautify(value, { ...options, indent_inner_html: true });
  } else if (content_type === "text/xml" || content_type === "application/xml" || content_type.endsWith("+xml")) {
    mode = "application/xml"; label = "XML";
    format = value => html.html_beautify(value, { ...options, inline: [], inline_custom_elements: false,
      void_elements: ["?xml", "!doctype"] });
  } else if (/^(?:text|application)\/(?:x-)?(?:java|ecma)script$/.test(content_type)) {
    mode = "javascript"; label = "JavaScript";
    format = value => javascript.js_beautify(value, options);
  } else if (content_type === "text/css") {
    mode = "text/css"; label = "CSS";
    format = value => css.css_beautify(value, options);
  }
  let formatted = source;
  try { formatted = format(source); } catch { /* 非法正文保留原文，仍可检查声明的响应类型。 */ }
  return Object.freeze({ source, formatted, content_type, mode, label });
}
