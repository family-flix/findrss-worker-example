// 从旧示例抽出的通用工具；以内置 ES 模块加载，不依赖 source/main 或宿主对象。
export function script_util_source() {
  return String.raw`
function decode_entities(value) {
  return String(value ?? "").replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (entity, code) => {
    if (code[0] !== "#") return { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " }[code.toLowerCase()];
    const point = /^#x/i.test(code) ? parseInt(code.slice(2), 16) : Number(code.slice(1));
    return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff) ? String.fromCodePoint(point) : entity;
  });
}
function plain_text(value) {
  return decode_entities(String(value ?? "").replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<br\s*\/?\s*>|<\/p\s*>/gi, "\n").replace(/<[^>]*>/g, "")).trim();
}
function escape_html(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function absolute_url(value, base = "") {
  try {
    let reference = String(value ?? "").trim();
    if (!reference) return Result.Ok("");
    if (/[\s\\\u0000-\u001f\u007f]/.test(reference)) return Result.Err("URL 包含非法字符", "UPSTREAM_INVALID_RESPONSE");
    const origin = String(base).match(/^https?:\/\/[^/?#@\s\\]+(?=[/?#]|$)/i)?.[0];
    if (reference.startsWith("//")) reference = (origin?.split(":")[0] || "https") + ":" + reference;
    if (/^https?:\/\/[^/?#@]+(?:[/?#]|$)/i.test(reference)) return Result.Ok(reference);
    if (!origin || /^[a-z][a-z\d+.-]*:/i.test(reference) || reference.startsWith("#")) return Result.Err("URL 或相对地址的 base 无效", "UPSTREAM_INVALID_RESPONSE");
    if (reference.startsWith("?")) return Result.Ok(base.split(/[?#]/)[0] + reference);
    const parts = [], suffix = reference.match(/[?#][\s\S]*$/)?.[0] || "";
    const pathname = reference.split(/[?#]/)[0];
    const path = pathname.startsWith("/") ? pathname : base.slice(origin.length).split(/[?#]/)[0].replace(/[^/]*$/, "") + pathname;
    for (const part of path.split("/")) { if (part === "..") parts.pop(); else if (part && part !== ".") parts.push(part); }
    return Result.Ok(origin + "/" + parts.join("/") + (path.endsWith("/") && parts.length ? "/" : "") + suffix);
  } catch (error) { return Result.Err(error, "UPSTREAM_INVALID_RESPONSE"); }
}
function timestamp(value) {
  try {
    if (value === undefined || value === null || value === "" || value === 0 || value === "0") return Result.Ok(undefined);
    if (typeof value === "number" || /^\d{10,13}$/.test(String(value))) {
      const number = Number(value), millis = number < 1e12 ? number * 1000 : number;
      return Number.isFinite(millis) && millis > 0 && millis < 8640000000000000
        ? Result.Ok(millis) : Result.Err("时间戳无效", "UPSTREAM_INVALID_RESPONSE");
    }
    let date = String(value).trim();
    if (/^\d{4}[-/]\d{2}[-/]\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?)?$/.test(date)) date = date.replace(/\//g, "-").replace(" ", "T") + (date.length === 10 ? "T00:00:00" : date.length === 16 ? ":00" : "") + "+08:00";
    const millis = Date.parse(date);
    return Number.isFinite(millis) && millis > 0 ? Result.Ok(millis) : Result.Err("日期无效", "UPSTREAM_INVALID_RESPONSE");
  } catch (error) { return Result.Err(error, "UPSTREAM_INVALID_RESPONSE"); }
}
function array_at(value, path = "") {
  try {
    for (const key of path.split(".").filter(Boolean)) value = value?.[key];
    return Array.isArray(value) ? Result.Ok(value) : Result.Err("缺少列表：" + (path || "根数组"), "UPSTREAM_INVALID_RESPONSE");
  } catch (error) { return Result.Err(error, "UPSTREAM_INVALID_RESPONSE"); }
}
function identity(value) {
  try {
    if (typeof value === "number" && !Number.isSafeInteger(value)) return Result.Err("ID 超出安全整数范围", "UPSTREAM_INVALID_RESPONSE");
    if (!["string", "number", "bigint"].includes(typeof value)) return Result.Err("缺少稳定 ID", "UPSTREAM_INVALID_RESPONSE");
    const id = String(value).trim();
    return id ? Result.Ok(id) : Result.Err("缺少稳定 ID", "UPSTREAM_INVALID_RESPONSE");
  } catch (error) { return Result.Err(error, "UPSTREAM_INVALID_RESPONSE"); }
}
async function request_text(ctx, url, options = {}) {
  try {
    return await ctx.fetchText(url, { ...options, headers: {
      Accept: "application/json,text/html,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8", "User-Agent": "Mozilla/5.0",
      ...options.headers,
    } });
  } catch (error) { return Result.Err(error); }
}
async function request_json(ctx, url, options = {}) {
  try {
    const fetched = await request_text(ctx, url, options);
    return fetched.error ? fetched : parseJSON(fetched.data);
  } catch (error) { return Result.Err(error); }
}
function embedded_json(value, marker) {
  try {
    const input_text = String(value);
    if (!(marker instanceof RegExp)) return Result.Err("内嵌 JSON marker 必须是正则表达式", "INVALID_PARAMETER");
    const match = new RegExp(marker.source, marker.flags.replace(/[gy]/g, "")).exec(input_text);
    if (!match) return Result.Err("页面缺少内嵌 JSON", "UPSTREAM_INVALID_RESPONSE");
    const input = input_text.slice(match.index + match[0].length).trimStart();
    if (input[0] !== "{" && input[0] !== "[") return Result.Err("内嵌数据不是 JSON 对象或数组", "UPSTREAM_INVALID_RESPONSE");
    let depth = 0, string = false, escaped = false;
    for (let i = 0; i < input.length; i++) {
      const char = input[i];
      if (string) { if (escaped) escaped = false; else if (char === "\\") escaped = true; else if (char === '"') string = false; }
      else if (char === '"') string = true;
      else if (char === "{" || char === "[") depth++;
      else if ((char === "}" || char === "]") && --depth === 0) return parseJSON(input.slice(0, i + 1));
    }
    return Result.Err("内嵌 JSON 不完整", "UPSTREAM_INVALID_RESPONSE");
  } catch (error) { return Result.Err(error, "UPSTREAM_INVALID_RESPONSE"); }
}
function document_nodes(value, xml = false) {
  try {
    if (xml && /<!DOCTYPE/i.test(value)) return Result.Err("XML 不支持 DOCTYPE", "UPSTREAM_INVALID_RESPONSE");
    const root = { tag: "root", attrs: Object.create(null), children: [], text: "" }, stack = [root];
    const markup = xml ? String(value).replace(/<!--[^]*?-->/g, "") : String(value).replace(/<!--[^]*?-->|<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "");
    for (const match of markup.matchAll(/<!\[CDATA\[[\s\S]*?\]\]>|<[^>]*>|[^<]+/g)) {
      const token = match[0], closing = token.match(/^<\/([\w:-]+)/);
      if (closing) { for (let i = stack.length - 1; i > 0; i--) if (stack[i].tag === closing[1].toLowerCase()) { stack.length = i; break; } continue; }
      const opening = token.match(/^<([\w:-]+)/), parent = stack[stack.length - 1];
      if (!opening) { if (token.startsWith("<![CDATA[")) parent.children.push({ tag: "text", attrs: {}, children: [], text: token.slice(9, -3) });
        else if (!token.startsWith("<")) parent.children.push({ tag: "text", attrs: {}, children: [], text: decode_entities(token) }); continue; }
      const attrs = Object.create(null);
      for (const attr of token.matchAll(/([^\s=<>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) attrs[attr[1].toLowerCase()] = decode_entities(attr[2] ?? attr[3] ?? attr[4]);
      const node = { tag: opening[1].toLowerCase(), attrs, children: [], text: "" };
      Object.defineProperty(node, "parent", { value: parent });
      parent.children.push(node);
      if (!/\/\s*>$/.test(token) && (xml || !/^(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/.test(node.tag))) stack.push(node);
    }
    return Result.Ok(root);
  } catch (error) { return Result.Err(error, "UPSTREAM_INVALID_RESPONSE"); }
}
function descendants(root) {
  const result = [], stack = [...(root?.children || [])].reverse();
  while (stack.length) { const node = stack.pop(); result.push(node); for (let i = node.children.length - 1; i >= 0; i--) stack.push(node.children[i]); }
  return result;
}
function matches(node, selector) {
  const simple = selector.replace(/\[[^\]]*\]/g, "");
  const tag = simple.match(/^[\w:-]+/)?.[0];
  if (tag && node.tag !== tag) return false;
  const id = simple.match(/#([\w-]+)/)?.[1];
  if (id && node.attrs.id !== id) return false;
  for (const name of simple.matchAll(/\.([\w-]+)/g)) if (!String(node.attrs.class || "").split(/\s+/).includes(name[1])) return false;
  for (const attr of selector.matchAll(/\[([\w:-]+)(?:(\^=|\$=|=)["']?([^\]"']*)["']?)?\]/g)) {
    const value = Object.prototype.hasOwnProperty.call(node.attrs, attr[1]) ? node.attrs[attr[1]] : undefined;
    if (value === undefined || (attr[2] === "=" && value !== attr[3]) || (attr[2] === "^=" && !value.startsWith(attr[3])) || (attr[2] === "$=" && !value.endsWith(attr[3]))) return false;
  }
  return true;
}
// shortcut: 沿用示例的轻量选择器；需要完整 CSS/DOM 语义时换专用解析器。
function select(root, selector) {
  let nodes = [root], direct = false;
  for (const part of selector.replace(/>/g, " > ").trim().split(/\s+/)) {
    if (part === ">") { direct = true; continue; }
    nodes = [...new Set(nodes.flatMap(node => (direct ? node?.children || [] : descendants(node)).filter(child => matches(child, part))))];
    direct = false;
  }
  return nodes;
}
function text_of(node) { return descendants({ children: node ? [node] : [] }).map(child => child.text || "").join("").replace(/\s+/g, " ").trim(); }
function first(root, selector) { return select(root, selector)[0]; }
function field(root, selector) { return text_of(first(root, selector)); }
function attribute(root, selector, name) { return first(root, selector)?.attrs[name] || ""; }
function rows(root, selector) {
  try {
    const nodes = select(root, selector);
    return nodes.length ? Result.Ok(nodes) : Result.Err("页面缺少内容列表：" + selector, "UPSTREAM_INVALID_RESPONSE");
  } catch (error) { return Result.Err(error, "UPSTREAM_INVALID_RESPONSE"); }
}
function feed_items(value, base) {
  try {
    const parsed = document_nodes(value, true);
    if (parsed.error) return parsed;
    const channel = first(parsed.data, "rss > channel") || first(parsed.data, "rdf:rdf"), atom = first(parsed.data, "feed");
    if (!channel && !atom) return Result.Err("上游没有返回 RSS/Atom", "UPSTREAM_INVALID_RESPONSE");
    const items = [];
    for (const node of select(channel || atom, channel ? "item" : "entry")) {
      const links = select(node, "link");
      const link = absolute_url(channel ? text_of(links[0]) : links.find(link => !link.attrs.rel || link.attrs.rel === "alternate")?.attrs.href, base);
      if (link.error) return link;
      const id = identity(field(node, channel ? "guid" : "id") || link.data);
      if (id.error) return id;
      items.push({ id: id.data, title: field(node, "title"), link: link.data,
        description: field(node, "description") || field(node, "summary"),
        content: field(node, "content:encoded") || field(node, "content"),
        published: field(node, channel ? "pubdate" : "published") || undefined,
        updated: field(node, "updated") || undefined,
        image: attribute(node, "media:thumbnail", "url") || undefined });
    }
    return Result.Ok(items);
  } catch (error) { return Result.Err(error, "UPSTREAM_INVALID_RESPONSE"); }
}
function map_results(values, mapper) {
  try {
    if (!Array.isArray(values) || typeof mapper !== "function") return Result.Err("map_results 需要数组和返回 Result 的函数", "INVALID_PARAMETER");
    const items = [];
    for (let index = 0; index < values.length; index++) {
      const result = mapper(values[index], index, values);
      if (!result || typeof result !== "object" || !("error" in result) || !("data" in result)) return Result.Err("map_results 的回调必须返回 Result", "UPSTREAM_INVALID_RESPONSE");
      if (result.error) return result;
      items.push(result.data);
    }
    return Result.Ok(items);
  } catch (error) { return Result.Err(error); }
}
function replace_results(value, pattern, mapper) {
  try {
    let failure = null;
    const replaced = String(value).replace(pattern, (...args) => {
      if (failure) return "";
      const result = mapper(...args);
      if (!result || typeof result !== "object" || !("error" in result) || !("data" in result)) { failure = Result.Err("replace_results 的回调必须返回 Result", "UPSTREAM_INVALID_RESPONSE"); return ""; }
      if (result.error) { failure = result; return ""; }
      return result.data;
    });
    return failure || Result.Ok(replaced);
  } catch (error) { return Result.Err(error); }
}
export const utils = Object.freeze({
  decode_entities, decode_html: decode_entities, plain_text, escape_html, absolute_url, timestamp,
  array_at, identity, request_text, request_json, embedded_json, document_nodes,
  descendants, matches, select, text_of, first, field, attribute, rows, feed_items, map_results, replace_results, parseJSON,
});
`;
}
