// 共享正文抽取器。
//
// Workers 里没有 DOMParser，这里用 node-html-parser 把阅读端 `frontend/src/biz/html_extract.js` 的启发式
// （`extract_readable_html` / `best_content_block` / `absolutize_urls`）逐条移植过来，
// 让「后台同步时抓」与「打开文章时抓」抽出来的正文尽量一致：
//
// 1. 去掉 `script, style, noscript, template, iframe, object, embed, form, svg, nav, header,
//    footer, aside`（对齐 html_extract.js 的同一份清单）；
// 2. `rules.content_selector` 命中则以该节点为根，否则跑 `best_content_block` 的移植版，
//    再兜底 `<body>`；
// 3. 按 `rules.remove_selectors` 逐个 `remove()`；
// 4. `href` / `src` 相对地址绝对化（对齐 `absolutize_urls`）；
// 5. 返回 `innerHTML`（不截断：调用方把整份正文写进 R2）。
//
// **只跑结构规则，不跑正则**：结构删除可证明幂等（二次执行结果不变），正则替换不幂等
// （`foo => foofoo` 跑两次就变样），所以 `rules.regex` 只在浏览器端执行一次。正则是确定性
// 的，换设备重跑结果一致。
//
// 抽取质量的兜底手段是每源的 `content_selector`——启发式不够用时用户能自己指定。

/** 与 `frontend/src/biz/html_extract.js` 的 `extract_readable_html` 同一份删除清单。 */
const stripped_selector =
  "script, style, noscript, template, iframe, object, embed, form, svg, nav, header, footer, aside";

/**
 * @param {import("node-html-parser").HTMLElement | null} element
 * @returns {number}
 */
function text_length(element) {
  return element === null ? 0 : element.textContent.trim().length;
}

/**
 * 启发式正文块打分：段落文本量减去链接文本量（`frontend/src/biz/html_extract.js` 的 `best_content_block` 移植版）。
 * @param {import("node-html-parser").HTMLElement} root
 * @returns {import("node-html-parser").HTMLElement | null}
 */
function best_content_block(root) {
  const body = root.querySelector("body");
  if (body === null) return null;
  /** @type {import("node-html-parser").HTMLElement | null} */
  let best = null;
  let best_score = 0;
  for (const element of body.querySelectorAll("div, section, article, main, td")) {
    let paragraph_text = 0;
    for (const paragraph of element.querySelectorAll("p")) paragraph_text += text_length(paragraph);
    if (paragraph_text < 200) continue;
    let link_text = 0;
    for (const anchor of element.querySelectorAll("a")) link_text += text_length(anchor);
    const score = paragraph_text - link_text;
    if (score > best_score) {
      best_score = score;
      best = element;
    }
  }
  return best;
}

/** @param {unknown} value @param {string} base @returns {string} */
function resolve_absolute_url(value, base) {
  const raw = String(value ?? "").trim();
  if (raw === "") return "";
  try {
    const url = new URL(raw, base || undefined);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

/**
 * 文档声明的 `<base href>` 优先（对齐 `absolutize_urls`：`<base>` 会改变相对地址的解析结果）。
 * @param {import("node-html-parser").HTMLElement} root
 * @param {string} base
 * @returns {string}
 */
function document_base(root, base) {
  const declared = root.querySelector("base[href]");
  if (declared === null) return base;
  const resolved = resolve_absolute_url(declared.getAttribute("href"), base);
  return resolved === "" ? base : resolved;
}

/**
 * 选择器来自用户输入，语法非法时必须当成「没命中」而不是抛错中断整次抓取。
 * @param {import("node-html-parser").HTMLElement} root
 * @param {string} selector
 * @returns {import("node-html-parser").HTMLElement | null}
 */
function safe_query(root, selector) {
  try {
    return root.querySelector(selector);
  } catch {
    return null;
  }
}

/** @param {import("node-html-parser").HTMLElement} root @param {string} selector */
function safe_query_all(root, selector) {
  try {
    return root.querySelectorAll(selector);
  } catch {
    return [];
  }
}

/**
 * 只把 `href` / `src` / `data-src` 相对地址绝对化，不做任何结构裁剪。
 *
 * 「全文处理器」的输出必须过这一道：处理器是纯字符串操作（沙箱里没有 DOM），
 * 正文里的图片是 `data-src`、链接是相对路径，不绝对化的话浏览器端会拿阅读端
 * 的地址去解析。`data-src` 必须一起处理——微信正文的图片全是它。
 * @param {string} html
 * @param {string} base_url
 * @returns {string}
 */
function absolutize_article_html(html, base_url, parse) {
  if (typeof html !== "string" || html === "") return "";
  /** @type {import("node-html-parser").HTMLElement} */
  let root;
  try {
    root = parse(html);
  } catch {
    return "";
  }
  const base = document_base(root, base_url);
  for (const element of root.querySelectorAll("[href], [src], [data-src]")) {
    for (const attribute of ["href", "src", "data-src"]) {
      const value = element.getAttribute(attribute);
      if (value === null || value === undefined || String(value).trim() === "") continue;
      const resolved = resolve_absolute_url(value, base);
      if (resolved !== "") element.setAttribute(attribute, resolved);
    }
  }
  return root.innerHTML;
}

/**
 * 原文 HTML → 可读正文字节（结构规则已应用、相对地址已绝对化）。
 * @param {string} html
 * @param {string} base_url
 * @param {{ content_selector?: string, remove_selectors?: string[] }} [rules]
 * @returns {string}
 */
function extract_article_html(html, base_url, rules, parse) {
  if (typeof html !== "string" || html === "") return "";
  /** @type {import("node-html-parser").HTMLElement} */
  let root;
  try {
    root = parse(html);
  } catch {
    return "";
  }
  for (const element of root.querySelectorAll(stripped_selector)) element.remove();

  const selector = typeof rules.content_selector === "string" ? rules.content_selector.trim() : "";
  const candidate =
    (selector === "" ? null : safe_query(root, selector)) ??
    // 与 html_extract.js 的候选链逐条对齐：显式语义标签优先，其次才是打分启发式，最后兜底 body。
    root.querySelector("article") ??
    root.querySelector("[role=main]") ??
    root.querySelector("main") ??
    best_content_block(root) ??
    root.querySelector("body");
  if (candidate === null) return "";

  for (const rule of Array.isArray(rules.remove_selectors) ? rules.remove_selectors : []) {
    if (typeof rule !== "string" || rule.trim() === "") continue;
    for (const element of safe_query_all(candidate, rule.trim())) element.remove();
  }

  const base = document_base(root, base_url);
  for (const element of candidate.querySelectorAll("[href], [src]")) {
    for (const attribute of ["href", "src"]) {
      const value = element.getAttribute(attribute);
      if (value === null || value === undefined || String(value).trim() === "") continue;
      const resolved = resolve_absolute_url(value, base);
      if (resolved !== "") element.setAttribute(attribute, resolved);
    }
  }
  return candidate.innerHTML;
}

export function create_html_extractor(parse) {
  return Object.freeze({
    absolutize_article_html: (html, base_url) => absolutize_article_html(html, base_url, parse),
    extract_article_html: (html, base_url, rules = {}) =>
      extract_article_html(html, base_url, rules, parse),
  });
}
