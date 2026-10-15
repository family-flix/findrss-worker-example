// 共享订阅源解析器：从 RSS/Atom XML 或 JSON Feed 产出标准 article 形状。
//
// 阅读端的客户端解析器（旧 `frontend/app.js` 的 `parse_feed_xml`）已随「前端不抓订阅源」
// 一起删除，这里是**唯一**的订阅源解析实现，article 字段语义由 test/feed_parse.test.js
// 守住。刻意不复用 api 的 `feed_format.js`：
// 那套是「脚本 JSON → XML」的输出侧归一，时间启发式与 enclosure 折叠都与阅读端语义相反。
//
// 解析选项的两处关键取舍：
// - `preserveOrder: true`：正文是混合内容，必须保留文本与子元素的文档顺序，否则
//   `<description>前 <b>粗</b> 后</description>` 的摘要会被打乱。
// - `trimValues: false`：与 DOMParser 的 textContent 一致，空白交给 strip_tags / trim 处理。
//
// 解析器由调用方注入，包本身保持零依赖，API 与阅读端各用自己已安装的 fast-xml-parser。

/** 解析出无法继续时的错误文案，与阅读端保持一致。 */
const INVALID_XML_ERROR = "订阅源返回了无法解析的 XML";
const NOT_A_FEED_ERROR = "目标地址不是 RSS/Atom 文档";

/** fxp preserveOrder 下属性节点挂在元素的这个键上。 */
const ATTRIBUTES_KEY = ":@";

const parser_options = {
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  trimValues: false,
  parseTagValue: false,
  parseAttributeValue: false,
  // 普通转义也计入展开次数，固定 1000 次会误拒含大量 HTML 正文的合法源。
  // 总次数在 parse_document 中随输入长度设定，其余实体保护显式保留。
  processEntities: {
    enabled: true,
    maxEntitySize: 10000,
    maxExpansionDepth: 10,
    maxEntityCount: 1000,
    maxExpandedLength: 100000,
    maxTotalExpansions: 1000,
  },
  htmlEntities: true,
  // 保留 `media:thumbnail` / `content:encoded` / `itunes:image` 等带前缀的限定名，
  // 阅读端的 querySelector 正是按限定名匹配的。
  removeNSPrefix: false,
  preserveOrder: true,
};

/**
 * 限定名的本地部分。仅用于识别根元素，子节点一律走限定名。
 * @param {string} name
 * @returns {string}
 */
function local_name(name) {
  const index = name.indexOf(":");
  return index === -1 ? name : name.slice(index + 1);
}

/** @param {unknown} value @returns {boolean} */
function is_object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * 元素/文本项的名字：元素取唯一非属性键（`:@`、`#text` 之类除外），文本节点返回 null。
 * @param {unknown} entry
 * @returns {string | null}
 */
function element_name(entry) {
  if (!is_object(entry)) return null;
  for (const key of Object.keys(entry)) {
    if (key === ATTRIBUTES_KEY || key.startsWith("#")) continue;
    return key;
  }
  return null;
}

/** @param {unknown} entry @returns {unknown[]} */
function element_children(entry) {
  const name = element_name(entry);
  if (name === null) return [];
  const children = /** @type {Record<string, unknown>} */ (entry)[name];
  return Array.isArray(children) ? children : [];
}

/** @param {unknown} entry @returns {Record<string, unknown>} */
function element_attributes(entry) {
  const attributes = is_object(entry) ? entry[ATTRIBUTES_KEY] : undefined;
  return is_object(attributes) ? /** @type {Record<string, unknown>} */ (attributes) : {};
}

/** @param {unknown} entry @param {string} name @returns {string} */
function attribute(entry, name) {
  const value = element_attributes(entry)["@_" + name];
  return typeof value === "string" ? value : "";
}

/**
 * 属性原始值；缺失为 null（区分「没有该属性」与「空串属性」）。
 * @param {unknown} entry
 * @param {string} name
 * @returns {string | null}
 */
function attribute_or_null(entry, name) {
  const value = element_attributes(entry)["@_" + name];
  return value === undefined ? null : String(value);
}

/** @param {unknown[]} children @returns {string} */
function text_of_children(children) {
  let result = "";
  for (const child of children) result += text_of(child);
  return result;
}

/**
 * 子树文本，语义对齐 DOM 的 textContent。
 * @param {unknown} entry
 * @returns {string}
 */
function text_of(entry) {
  if (element_name(entry) === null) {
    return is_object(entry) && typeof entry["#text"] === "string" ? entry["#text"] : "";
  }
  return text_of_children(element_children(entry));
}

/** @param {unknown} entry @returns {string} */
function text_content(entry) {
  return text_of(entry).trim();
}

/** @param {unknown} node @returns {unknown[]} */
function node_children(node) {
  return Array.isArray(node) ? node : element_children(node);
}

/**
 * 全部后代元素（限定名精确匹配），文档顺序。
 * @param {unknown} node
 * @param {string} name
 * @returns {unknown[]}
 */
function descendants(node, name) {
  const result = [];
  const walk = (children) => {
    for (const entry of children) {
      if (element_name(entry) === name) result.push(entry);
      walk(element_children(entry));
    }
  };
  walk(node_children(node));
  return result;
}

/**
 * 文档顺序里带指定属性的后代元素（等价于 `a[attr], b[attr]` 多选择器组）。
 * 无该属性者不入选——阅读端的 querySelectorAll 同样要求属性存在，
 * 命中集合与顺序都必须一致。
 * @param {unknown} node
 * @param {string[]} names
 * @param {string} attribute_name
 * @returns {unknown[]}
 */
function descendants_with_attribute(node, names, attribute_name) {
  const result = [];
  const wanted = new Set(names);
  const walk = (children) => {
    for (const entry of children) {
      const name = element_name(entry);
      if (name !== null && wanted.has(name) &&
        element_attributes(entry)["@_" + attribute_name] !== undefined) {
        result.push(entry);
      }
      walk(element_children(entry));
    }
  };
  walk(node_children(node));
  return result;
}

/**
 * 文档顺序里第一个指定限定名的后代元素。
 * @param {unknown} node
 * @param {string} name
 * @returns {unknown}
 */
function first_of(node, name) {
  const found = descendants(node, name);
  return found.length === 0 ? undefined : found[0];
}

/**
 * 直接子元素里第一个指定限定名者。
 * @param {unknown} node
 * @param {string} name
 * @returns {unknown}
 */
function child(node, name) {
  for (const entry of node_children(node)) {
    if (element_name(entry) === name) return entry;
  }
  return undefined;
}

/** @param {string} value */
function escape_html_text(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/** @param {string} value */
function escape_html_attribute(value) {
  return escape_html_text(value).replaceAll('"', "&quot;");
}

/**
 * 把一个节点序列化为 HTML 标记（innerHTML 语义）。
 * @param {unknown} entry
 * @returns {string}
 */
function serialize_html(entry) {
  const name = element_name(entry);
  if (name === null) {
    return is_object(entry) && typeof entry["#text"] === "string"
      ? escape_html_text(entry["#text"])
      : "";
  }
  let attributes = "";
  for (const [key, value] of Object.entries(element_attributes(entry))) {
    if (!key.startsWith("@_")) continue;
    attributes += " " + key.slice(2) + '="' + escape_html_attribute(String(value)) + '"';
  }
  let inner = "";
  for (const child_entry of element_children(entry)) inner += serialize_html(child_entry);
  return "<" + name + attributes + ">" + inner + "</" + name + ">";
}

/**
 * 正文取值：`type="xhtml"` 取子节点序列化，其余（含缺省、html、空串）取文本。
 * 其他 type 一律视为无法处理，返回空串——与阅读端 html_content 一致。
 * @param {unknown} entry
 * @returns {string}
 */
function html_content(entry) {
  if (entry === undefined || entry === null) return "";
  const type = attribute_or_null(entry, "type");
  if (type === "xhtml") {
    let result = "";
    for (const child_entry of element_children(entry)) result += serialize_html(child_entry);
    return result;
  }
  if (type === null || type === "" || type === "html") return text_of(entry);
  return "";
}

/** @param {string} value */
function strip_tags(value) {
  return String(value)
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * 订阅源级别的图标地址。优先级：`image > url`（RSS 的标准写法）→
 * `itunes:image@href` → `icon` → `logo`。首个可归一为绝对地址者胜。
 *
 * 一律取**直接子元素**（`child`）而不是 `first_of`：`first_of` 会下钻到条目里，
 * 把某篇文章的配图当成源头像。Atom 的 `logo` 有时是相对地址，交给 base 归一。
 * @param {unknown} node
 * @param {string} base_url
 * @returns {string}
 */
function feed_icon_url(node, base_url) {
  const image = child(node, "image");
  if (image !== undefined) {
    const resolved = resolve_absolute_url(text_content(child(image, "url")), base_url);
    if (resolved !== "") return resolved;
  }
  const itunes = descendants_with_attribute(node, ["itunes:image", "image"], "href");
  if (itunes.length > 0) {
    const resolved = resolve_absolute_url(attribute(itunes[0], "href"), base_url);
    if (resolved !== "") return resolved;
  }
  for (const name of ["icon", "logo"]) {
    const resolved = resolve_absolute_url(text_content(child(node, name)), base_url);
    if (resolved !== "") return resolved;
  }
  return "";
}

/**
 * 源简介：去标签、压空白、截 500 字。上游没给就是空串（不是「未命名」那类兜底）。
 * @param {unknown} entry 上游的 description / subtitle 元素
 * @returns {string}
 */
function feed_description(entry) {
  if (entry === undefined) return "";
  return strip_tags(text_content(entry)).slice(0, 500);
}

/**
 * 已解析文档的根元素名 → kind。刻意不调 `detect_feed_kind`（它会重解析一遍）。
 * @param {{ name: string }} document
 * @returns {"rss" | "atom" | "rdf"}
 */
function document_kind(document) {
  if (document.name === "feed") return "atom";
  if (document.name.toUpperCase() === "RDF") return "rdf";
  return "rss";
}

/** @param {string} value @param {string} base @returns {string} */
function resolve_absolute_url(value, base) {
  const raw = String(value || "").trim();
  if (raw === "") return "";
  try {
    const url = new URL(raw, base || undefined);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

/**
 * 正文里第一个 `<img src>`（等价于 DOMParser + querySelector("img[src]")）。
 * `[^>]*` 不跨越标签边界，因此没有 src 的 <img> 会被跳过。
 */
const inline_image_pattern = /<img\b[^>]*?\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i;

/** @param {string} markup @returns {string} */
function first_inline_image(markup) {
  const match = inline_image_pattern.exec(markup);
  if (match === null) return "";
  return match[1] ?? match[2] ?? match[3] ?? "";
}

/** @param {string} value @returns {string} */
function lower(value) {
  return String(value || "").toLowerCase();
}

/**
 * 列表缩略图。优先级：media:thumbnail → media:content(image) → enclosure(image) →
 * itunes:image → 正文/摘要里的第一个 <img>，首个可归一为绝对地址者胜。
 * @param {unknown} item
 * @param {string} base_url
 * @returns {string}
 */
function extract_thumbnail(item, base_url) {
  const candidates = [];
  const media_thumbnails = descendants_with_attribute(item, ["media:thumbnail", "thumbnail"], "url");
  if (media_thumbnails.length > 0) candidates.push(attribute(media_thumbnails[0], "url"));
  for (const media of descendants_with_attribute(item, ["media:content", "content"], "url")) {
    const medium = lower(attribute(media, "medium"));
    const type = lower(attribute(media, "type"));
    if (medium === "image" || type.startsWith("image")) {
      candidates.push(attribute(media, "url"));
      break;
    }
  }
  for (const enclosure of descendants_with_attribute(item, ["enclosure"], "url")) {
    if (lower(attribute(enclosure, "type")).startsWith("image")) {
      candidates.push(attribute(enclosure, "url"));
    }
  }
  const itunes = descendants_with_attribute(item, ["itunes:image", "image"], "href");
  if (itunes.length > 0) candidates.push(attribute(itunes[0], "href"));
  const markup = html_content(first_of(item, "content:encoded")) ||
    html_content(first_of(item, "encoded")) ||
    html_content(first_of(item, "content")) ||
    html_content(first_of(item, "description")) ||
    html_content(first_of(item, "summary"));
  if (markup !== "") candidates.push(first_inline_image(markup));
  for (const candidate of candidates) {
    const resolved = resolve_absolute_url(candidate, base_url);
    if (resolved !== "") return resolved;
  }
  return "";
}

/**
 * 文章图片列表（X/微博类「文本 + 多图」的载体）。收集全部图片型的
 * `media:content` / `content`（`medium="image"` 或 `type` 以 `image/` 开头），
 * 再收集图片型的 `enclosure`，按各自文档顺序、去重保序。
 *
 * 一张都没有时回退到已算好的 `thumbnail`（它可能是 `media:thumbnail`、标签订阅源的
 * `itunes:image` 或正文首图）。`thumbnail` 由调用方传入，避免在回退路径上再算一遍。
 * @param {unknown} item
 * @param {string} base_url
 * @param {string} thumbnail
 * @returns {string[]}
 */
function extract_images(item, base_url, thumbnail) {
  const images = [];
  const push = (value) => {
    const resolved = resolve_absolute_url(value, base_url);
    if (resolved !== "" && !images.includes(resolved)) images.push(resolved);
  };
  for (const media of descendants_with_attribute(item, ["media:content", "content"], "url")) {
    const medium = lower(attribute(media, "medium"));
    const type = lower(attribute(media, "type"));
    if (medium === "image" || type.startsWith("image/")) push(attribute(media, "url"));
  }
  for (const enclosure of descendants_with_attribute(item, ["enclosure"], "url")) {
    if (lower(attribute(enclosure, "type")).startsWith("image/")) push(attribute(enclosure, "url"));
  }
  if (images.length === 0 && thumbnail !== "") images.push(thumbnail);
  return images;
}

/**
 * 视频资源优先取 media:content，其次 enclosure；medium=video 或 video/* 表示视频。
 * 资源地址直接作为 video_url，显式 key 优先于地址中的 key 参数。
 * @param {unknown} item
 * @param {string} base_url
 * @returns {{ video_url: string, video_key: string, video_poster: string }}
 */
function extract_video(item, base_url) {
  const youtube_id = text_content(first_of(item, "yt:videoId")).trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(youtube_id)) {
    return {
      video_url: `https://www.youtube.com/embed/${youtube_id}`,
      video_key: "",
      video_poster: extract_thumbnail(item, base_url),
    };
  }
  const candidates = [
    ...descendants_with_attribute(item, ["media:content", "content"], "url"),
    ...descendants_with_attribute(item, ["enclosure"], "url"),
  ];
  for (const candidate of candidates) {
    const medium = lower(attribute(candidate, "medium"));
    const type = lower(attribute(candidate, "type"));
    if (medium !== "video" && !type.startsWith("video/")) continue;
    const video_url = resolve_absolute_url(attribute(candidate, "url"), base_url);
    if (video_url === "") continue;
    const parsed = new URL(video_url);
    return {
      video_url,
      video_key: attribute(candidate, "key").trim() || String(parsed.searchParams.get("key") || ""),
      video_poster: resolve_absolute_url(parsed.searchParams.get("poster") || "", base_url) ||
        extract_thumbnail(item, base_url),
    };
  }
  return { video_url: "", video_key: "", video_poster: "" };
}

// 有序媒体列表；同一 Media RSS group 中的默认原图与以它为缩略图的视频配对。
function extract_media(item, base_url, namespaces) {
  const nodes = [];
  const walk = (node) => {
    for (const entry of node_children(node)) {
      if (element_name(entry) !== null) { nodes.push(entry); walk(entry); }
    }
  };
  walk(item);
  const pairs = [];
  for (const group of nodes) {
    const name = element_name(group);
    const prefix = name.includes(":") ? name.split(":")[0] : "";
    if (local_name(name) !== "group" || namespaces.get(group)?.[prefix] !== "http://search.yahoo.com/mrss/") continue;
    const contents = node_children(group).filter(node => {
      const name = element_name(node);
      if (!name) return false;
      const prefix = name.includes(":") ? name.split(":")[0] : "";
      return local_name(name) === "content" && namespaces.get(node)?.[prefix] === "http://search.yahoo.com/mrss/";
    });
    if (contents.length !== 2) continue;
    const image = contents.find(node => attribute(node, "medium") === "image" && attribute(node, "isDefault") === "true");
    const video = contents.find(node => attribute(node, "medium") === "video");
    if (!image || !video) continue;
    const url = resolve_absolute_url(attribute(image, "url"), base_url);
    const video_url = resolve_absolute_url(attribute(video, "url"), base_url);
    const thumbnail = first_of(video, "media:thumbnail");
    if (!thumbnail || resolve_absolute_url(attribute(thumbnail, "url"), base_url) !== url) continue;
    if (url && video_url) pairs.push({ node: group, kind: "live_photo", url, video_url,
      poster: url, key: attribute(video, "key"), width: Number(attribute(video, "width")) || 0,
      height: Number(attribute(video, "height")) || 0 });
  }
  const media = [], seen = new Set();
  const push = (value) => {
    const identity = value.kind + ":" + value.url;
    if (seen.has(identity)) return;
    seen.add(identity);
    const { node, ...data } = value;
    media.push(data);
  };
  for (const node of nodes) {
    const pair = pairs.find(value => value.node === node);
    if (pair) { push(pair); continue; }
    const name = element_name(node);
    const is_atom = local_name(name) === "link" && attribute(node, "rel") === "enclosure";
    if (!["media:content", "content", "enclosure"].includes(name) && !is_atom) continue;
    const url = resolve_absolute_url(attribute(node, is_atom ? "href" : "url"), base_url);
    if (!url) continue;
    const paired = pairs.find(value => value.url === url || value.video_url === url);
    if (paired) { push(paired); continue; }
    const type = lower(attribute(node, "type")), medium = lower(attribute(node, "medium"));
    const kind = medium === "image" || type.startsWith("image/") ? "image" :
      medium === "video" || type.startsWith("video/") ? "video" :
      medium === "audio" || type.startsWith("audio/") || ((is_atom || name === "enclosure") && /\.(?:mp3|m4a|aac|ogg|opus|wav|flac)$/i.test(new URL(url).pathname)) ? "audio" : "";
    if (!kind) continue;
    const parsed = new URL(url);
    push({ kind, url, type, key: attribute(node, "key") || parsed.searchParams.get("key") || "",
      poster: resolve_absolute_url(attribute(node, "poster") || attribute(first_of(node, "media:thumbnail"), "url") || parsed.searchParams.get("poster") || "", base_url),
      width: Number(attribute(node, "width")) || 0, height: Number(attribute(node, "height")) || 0 });
  }
  return media;
}

/**
 * Atom 条目的 alternate 链接（无 rel 视为 alternate）。
 * @param {unknown} node
 * @returns {unknown}
 */
function find_alternate_link(node) {
  for (const link of descendants(node, "link")) {
    if ((attribute(link, "rel") || "alternate") === "alternate") return link;
  }
  return undefined;
}

/**
 * @param {unknown} item
 * @param {string} base_url
 * @returns {object}
 */
function extract_entry_type(item) {
  for (const node of node_children(item)) {
    const name = element_name(node);
    if (!name || local_name(name) !== "category") continue;
    if ((attribute(node, "domain") || attribute(node, "scheme")) !== "urn:content-type") continue;
    const type = attribute(node, "term") || text_content(node);
    if (["article", "gallery", "video", "live"].includes(type)) return type;
  }
  return "";
}

function parse_rss_item(item, base_url, namespaces) {
  const link = text_content(first_of(item, "link"));
  const media = extract_media(item, base_url, namespaces);
  const thumbnail = extract_thumbnail(item, base_url) || media.find(value => ["image", "live_photo"].includes(value.kind))?.url || media.find(value => value.poster)?.poster || "";
  const video = extract_video(item, base_url);
  const first_video = media.find(value => value.kind === "video");
  return {
    guid: text_content(first_of(item, "guid")) || link,
    ...(extract_entry_type(item) ? { type: extract_entry_type(item) } : {}),
    title: text_content(first_of(item, "title")) || "(无标题)",
    link,
    published_at: publication_time(item, [
      ["", "pubDate"],
      ["http://purl.org/dc/terms/", "issued"],
      ["http://purl.org/dc/elements/1.1/", "date"],
      ["http://purl.org/dc/terms/", "date"],
    ], namespaces),
    summary: strip_tags(text_content(first_of(item, "description"))),
    thumbnail,
    images: [...new Set([...extract_images(item, base_url, thumbnail), ...media.filter(value => ["image", "live_photo"].includes(value.kind)).map(value => value.url)])],
    media,
    ...video,
    ...(video.video_url || !first_video ? {} : { video_url: first_video.url, video_key: first_video.key, video_poster: first_video.poster }),
    content_html: html_content(first_of(item, "content:encoded")) ||
      html_content(first_of(item, "encoded")) ||
      html_content(first_of(item, "description")),
  };
}

/**
 * @param {unknown} entry
 * @param {string} base_url
 * @returns {object}
 */
function parse_atom_entry(entry, base_url, namespaces) {
  const link_url = attribute(find_alternate_link(entry), "href");
  const media = extract_media(entry, base_url, namespaces);
  const thumbnail = extract_thumbnail(entry, base_url) || media.find(value => ["image", "live_photo"].includes(value.kind))?.url || media.find(value => value.poster)?.poster || "";
  const video = extract_video(entry, base_url);
  const first_video = media.find(value => value.kind === "video");
  return {
    guid: text_content(first_of(entry, "id")) || link_url,
    ...(extract_entry_type(entry) ? { type: extract_entry_type(entry) } : {}),
    title: text_content(first_of(entry, "title")) || "(无标题)",
    link: link_url,
    published_at: publication_time(entry, [
      ["http://www.w3.org/2005/Atom", "published"],
      ["http://www.w3.org/2005/Atom", "updated"],
    ], namespaces),
    summary: strip_tags(text_content(first_of(entry, "summary")) || text_content(first_of(entry, "media:description"))),
    thumbnail,
    images: [...new Set([...extract_images(entry, base_url, thumbnail), ...media.filter(value => ["image", "live_photo"].includes(value.kind)).map(value => value.url)])],
    media,
    ...video,
    ...(video.video_url || !first_video ? {} : { video_url: first_video.url, video_key: first_video.key, video_poster: first_video.poster }),
    content_html: html_content(first_of(entry, "content")) || html_content(first_of(entry, "summary")) ||
      escape_html_text(text_content(first_of(entry, "media:description"))),
  };
}

function escape_bare_ampersands(xml) {
  // CDATA、注释、处理指令和 DTD 不属于普通文本，不能改写其中的内容。
  return xml.replace(/<!\[CDATA\[[\s\S]*?\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!DOCTYPE\b(?:[^>\[]|\[[\s\S]*?\])*>|&(?!(?:#\d+|#x[\da-fA-F]+|[A-Za-z_:][\w.:-]*);)/g,
    value => value === "&" ? "&amp;" : value);
}

/**
 * 解析文档并取出根元素。
 * @param {string} xml
 * @returns {{ name: string, entry: unknown, root: unknown[] }}
 */
function parse_document(xml, XMLParser, XMLValidator) {
  if (typeof xml !== "string" || xml.trim() === "") {
    throw new Error(INVALID_XML_ERROR);
  }
  xml = escape_bare_ampersands(xml);
  const validation = XMLValidator.validate(xml);
  if (validation !== true) {
    const detail = validation?.err;
    throw new Error(detail
      ? `${INVALID_XML_ERROR}（第 ${detail.line} 行，第 ${detail.col} 列：${String(detail.msg).slice(0, 240)}）`
      : INVALID_XML_ERROR);
  }
  let parsed;
  try {
    parsed = new XMLParser({ ...parser_options, processEntities: {
      ...parser_options.processEntities,
      // 每个实体引用至少占数个输入字符；允许普通实体随文档增长，仍有有限上限。
      maxTotalExpansions: Math.max(1000, xml.length),
    } }).parse(xml);
  } catch (failure) {
    const detail = String(failure?.message || "").slice(0, 240);
    throw new Error(detail ? `${INVALID_XML_ERROR}：${detail}` : INVALID_XML_ERROR);
  }
  if (!Array.isArray(parsed)) throw new Error(INVALID_XML_ERROR);
  for (const entry of parsed) {
    const name = element_name(entry);
    if (name === null || name.startsWith("?") || name.startsWith("!")) continue;
    return { name: local_name(name), entry, root: parsed };
  }
  throw new Error(NOT_A_FEED_ERROR);
}

/**
 * 判断 RSS/Atom/RDF/JSON Feed 文档类型，无法解析时抛错。
 * @param {string} xml
 * @returns {"rss" | "atom" | "rdf" | "json"}
 */
function detect_feed_kind(xml, XMLParser, XMLValidator) {
  if (is_json_document(xml)) {
    parse_json_feed(xml, "");
    return "json";
  }
  const document = parse_document(xml, XMLParser, XMLValidator);
  if (document.name === "feed") return "atom";
  if (document.name === "rss") return "rss";
  if (document.name.toUpperCase() === "RDF") return "rdf";
  if (first_of(document.root, "channel") !== undefined) return "rss";
  throw new Error(NOT_A_FEED_ERROR);
}

// 命名空间按作用域继承，前缀本身不是字段身份；条目局部声明可以覆盖根声明。
function document_namespaces(root) {
  const result = new WeakMap();
  const walk = (node, inherited) => {
    const scope = { ...inherited };
    for (const [name, value] of Object.entries(element_attributes(node))) {
      if (name === "@_xmlns") scope[""] = value;
      else if (name.startsWith("@_xmlns:")) scope[name.slice(8)] = value;
    }
    result.set(node, scope);
    for (const entry of element_children(node)) {
      if (element_name(entry) !== null) walk(entry, scope);
    }
  };
  for (const node of root) if (element_name(node) !== null) walk(node, {});
  return result;
}

// 只读条目直接子字段，跳过无效值；0（Unix epoch）也是有效时间。
// channel.pubDate / lastBuildDate 与 created / modified 不作为文章发布时间。
function publication_time(node, fields, namespaces) {
  for (const [uri, name] of fields) {
    for (const entry of element_children(node)) {
      const qualified = element_name(entry);
      if (qualified === null || local_name(qualified) !== name) continue;
      const prefix = qualified.includes(":") ? qualified.split(":")[0] : "";
      const scope = namespaces.get(entry) || {};
      const actual_uri = scope[prefix] || "";
      if (actual_uri !== uri && !(uri === "" && actual_uri === "http://purl.org/rss/1.0/") &&
        !(uri === "http://www.w3.org/2005/Atom" && qualified === name && actual_uri === "")) continue;
      const timestamp = Date.parse(text_content(entry));
      if (Number.isFinite(timestamp)) return timestamp;
    }
  }
  return 0;
}

/**
 * 解析一个订阅源文档。
 *
 * 返回的 `description` / `icon` / `site_url` / `kind` 都来自**这一次已解析的文档**
 * （不二次解析）：`site_url` 就是既有的 `base_url`（同一套相对链接基准），
 * `kind` 由根元素名映射。
 * @param {string} xml
 * @param {string} [feed_url] 订阅地址；用于把相对链接/缩略图归一为绝对地址。
 * @returns {{
 *   title: string, description: string, icon: string, site_url: string,
 *   kind: "rss" | "atom" | "rdf" | "json", articles: object[], extra?: object,
 * }}
 */
function parse_feed_document(xml, feed_url, XMLParser, XMLValidator) {
  if (is_json_document(xml)) return parse_json_feed(xml, feed_url);
  const document = parse_document(xml, XMLParser, XMLValidator);
  const namespaces = document_namespaces(document.root);
  const origin = String(feed_url || "");
  const kind = document_kind(document);
  if (document.name === "feed") {
    const feed = document.entry;
    const alternate = find_alternate_link(feed);
    const base_url = resolve_absolute_url(attribute(alternate, "href"), origin) || origin;
    const entries = [];
    for (const entry of node_children(feed)) {
      if (element_name(entry) === "entry") entries.push(entry);
    }
    return {
      title: text_content(child(feed, "title")) || "未命名订阅源",
      description: feed_description(child(feed, "subtitle")),
      icon: feed_icon_url(feed, base_url),
      site_url: base_url,
      kind,
      ...feed_extra(feed, document.entry),
      articles: entries.map((entry) => parse_atom_entry(entry, base_url, namespaces)),
    };
  }
  const channel = child(document.entry, "channel") ?? first_of(document.root, "channel");
  if (channel === undefined) throw new Error(NOT_A_FEED_ERROR);
  const base_url = resolve_absolute_url(text_content(first_of(channel, "link")), origin) || origin;
  return {
    title: text_content(child(channel, "title")) || "未命名订阅源",
    description: feed_description(child(channel, "description")),
    icon: feed_icon_url(channel, base_url),
    site_url: base_url,
    kind,
    ...feed_extra(channel, document.entry),
    articles: descendants(document.root, "item").map((item) => parse_rss_item(item, base_url, namespaces)),
  };
}

function is_json_document(value) {
  return typeof value === "string" && /^[\s\uFEFF]*[\[{]/.test(value);
}

function json_string(value) {
  return typeof value === "string" ? value : "";
}

// JSON Feed 与 XML 共用 article 形状；按内容识别，不依赖扩展名或响应 MIME。
function parse_json_feed(source, feed_url) {
  let feed;
  try {
    feed = JSON.parse(source.trim());
  } catch {
    throw new Error("订阅源返回了无法解析的 JSON");
  }
  if (!is_object(feed) || !["https://jsonfeed.org/version/1", "https://jsonfeed.org/version/1.1"].includes(feed.version) ||
      typeof feed.title !== "string" || !Array.isArray(feed.items)) throw new Error("目标地址不是有效的 JSON Feed 文档");
  const base_url = resolve_absolute_url(json_string(feed.home_page_url), feed_url) || feed_url;
  const articles = feed.items.map((item) => {
    if (!is_object(item) || typeof item.id !== "string" ||
        (typeof item.content_html !== "string" && typeof item.content_text !== "string")) {
      throw new Error("JSON Feed 文章缺少有效的 id 或正文");
    }
    const content_html = json_string(item.content_html) || escape_html_text(json_string(item.content_text)).replace(/\r\n|\r|\n/g, "<br>");
    const media = [];
    for (const attachment of Array.isArray(item.attachments) ? item.attachments : []) {
      if (!is_object(attachment)) continue;
      const url = resolve_absolute_url(json_string(attachment.url), base_url);
      const type = json_string(attachment.mime_type).toLowerCase();
      const kind = ["image", "audio", "video"].find(value => type.startsWith(value + "/"));
      if (!url || !kind || media.some(value => value.url === url)) continue;
      media.push({ kind, url, type, key: "", poster: "", width: 0, height: 0 });
    }
    const thumbnail = resolve_absolute_url(json_string(item.image), base_url) ||
      resolve_absolute_url(json_string(item.banner_image), base_url) ||
      media.find(value => value.kind === "image")?.url || resolve_absolute_url(first_inline_image(content_html), base_url);
    const images = [...new Set([thumbnail, ...media.filter(value => value.kind === "image").map(value => value.url)].filter(Boolean))];
    const video = media.find(value => value.kind === "video");
    const published = Date.parse(json_string(item.date_published));
    const modified = Date.parse(json_string(item.date_modified));
    return {
      guid: item.id,
      title: json_string(item.title) || "(无标题)",
      link: resolve_absolute_url(json_string(item.url) || json_string(item.external_url), base_url),
      published_at: Number.isFinite(published) ? published : Number.isFinite(modified) ? modified : 0,
      summary: json_string(item.summary) || json_string(item.content_text) || strip_tags(content_html),
      thumbnail, images, media,
      video_url: video?.url || "", video_key: "", video_poster: video ? thumbnail : "",
      content_html,
    };
  });
  return {
    title: feed.title || "未命名订阅源",
    description: json_string(feed.description),
    icon: resolve_absolute_url(json_string(feed.icon) || json_string(feed.favicon), base_url),
    site_url: base_url,
    kind: "json",
    articles,
  };
}

// 只认 feed/channel 的直接扩展节点；坏 JSON 不影响正常订阅。
function feed_extra(parent, root) {
  for (const entry of node_children(parent)) {
    const name = element_name(entry);
    if (name === null || !name.includes(":") || local_name(name) !== "extra") continue;
    const namespace = "xmlns:" + name.split(":")[0];
    const uri = attribute(entry, namespace) || attribute(parent, namespace) || attribute(root, namespace);
    if (uri !== "https://findrss.cloud/ns/reader") continue;
    const json = text_content(entry);
    if (json.length > 16384) return {};
    try {
      const value = JSON.parse(json);
      return is_object(value) ? { extra: value } : {};
    } catch {
      return {};
    }
  }
  return {};
}

export function create_feed_parser(XMLParser, XMLValidator) {
  return Object.freeze({
    detect_feed_kind: (xml) => detect_feed_kind(xml, XMLParser, XMLValidator),
    parse_feed_document: (xml, feed_url = "") =>
      parse_feed_document(xml, feed_url, XMLParser, XMLValidator),
  });
}
