// 脚本产出的协议无关 feed JSON 的领域模型：归一化 + 序列化。
// 同一份 JSON 按请求前缀渲染成 RSS 2.0（/rss/<route>）或 Atom 1.0（/atom/<route>），
// 转义统一在渲染端完成，脚本不再接触 XML。
// 纯模块，不依赖 Cloudflare API，可在 node --test 下直接覆盖。

const RSS_XMLNS = 'xmlns:atom="http://www.w3.org/2005/Atom" ' +
  'xmlns:media="http://search.yahoo.com/mrss/" ' +
  'xmlns:content="http://purl.org/rss/1.0/modules/content/" ' +
  'xmlns:dc="http://purl.org/dc/elements/1.1/"';
const ATOM_XMLNS = 'xmlns="http://www.w3.org/2005/Atom" ' +
  'xmlns:media="http://search.yahoo.com/mrss/"';

/** Atom 要求的 feed/entry id 兜底（脚本既没给 id 也没给 link 时）。 */
const FALLBACK_FEED_ID = "urn:findrss:feed";

/**
 * 时间字段统一接受秒 / 毫秒 / 可解析字符串，归一为毫秒时间戳。
 * 与示例脚本保持一致：小于 1e12 的数值按秒处理。
 * @param {unknown} value
 * @returns {number | null}
 */
function parse_time(value) {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value <= 0) return null;
    return value < 1_000_000_000_000 ? value * 1000 : value;
  }
  if (typeof value === "string") {
    const text = value.trim();
    if (text === "") return null;
    const parsed = Date.parse(text);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

/**
 * 去除首尾空白；非字符串或全空白返回空串（渲染时即省略该元素）。
 * @param {unknown} value
 * @returns {string}
 */
function trimmed(value) {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * 正文/标题类字段保留原始字符串（不 trim 内容），全空白视为缺省。
 * @param {unknown} value
 * @returns {string}
 */
function body_text(value) {
  return typeof value === "string" && value.trim() !== "" ? value : "";
}

/**
 * 归一 person 字段；无有效内容时返回 null。
 * @param {unknown} value
 * @returns {{ name: string, email: string, uri: string } | null}
 */
function normalize_person(value) {
  if (typeof value === "string") {
    const name = value.trim();
    return name === "" ? null : { name, email: "", uri: "" };
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const name = trimmed(value.name);
  const email = trimmed(value.email);
  const uri = trimmed(value.uri);
  if (name === "" && email === "" && uri === "") return null;
  return { name, email, uri };
}

/**
 * 归一 image 字段；无有效 url 时返回 null。
 * @param {unknown} value
 * @returns {{ url: string, title: string, link: string } | null}
 */
function normalize_image(value) {
  if (typeof value === "string") {
    const url = value.trim();
    return url === "" ? null : { url, title: "", link: "" };
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const url = trimmed(value.url);
  if (url === "") return null;
  return { url, title: trimmed(value.title), link: trimmed(value.link) };
}

/**
 * @param {unknown} value
 * @returns {{ url: string, type: string, length: string, key: string } | null}
 */
function normalize_enclosure(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const url = trimmed(value.url);
  if (url === "") return null;
  let length = "";
  if (typeof value.length === "number" && Number.isFinite(value.length) && value.length >= 0) {
    length = String(Math.trunc(value.length));
  } else {
    length = trimmed(value.length);
  }
  // `key` 是解密密钥（视频号播放链接约定）：渲染成附件上的同名属性，阅读端优先读它。
  return { url, type: trimmed(value.type), length, key: trimmed(value.key) };
}

/** `video` 快捷写法：等价 enclosure { type: "video/mp4" }。 */
function normalize_video(value) {
  const url = trimmed(value);
  return url === "" ? null : { url, type: "video/mp4", length: "", key: "" };
}

/**
 * item 的多图列表（与单个 `image` 封面并存）。非数组或全空白 → 空数组，
 * 渲染时一张都不出。这是 X/微博类「文本 + 多图」内容的载体。
 * @param {unknown} value
 * @returns {string[]}
 */
function normalize_image_list(value) {
  if (!Array.isArray(value)) return [];
  const images = [];
  for (const entry of value) {
    const url = trimmed(entry);
    if (url !== "") images.push(url);
  }
  return images;
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function normalize_categories(value) {
  if (!Array.isArray(value)) return [];
  const categories = [];
  for (const entry of value) {
    const name = trimmed(entry);
    if (name !== "") categories.push(name);
  }
  return categories;
}

/**
 * 署名实体（feed.author / item.author）。无有效内容时工厂返回 null。
 * @param {unknown} value
 */
export function FeedPersonModel(value) {
  const normalized = normalize_person(value);
  if (normalized === null) return null;
  const state = Object.freeze({ name: normalized.name, email: normalized.email, uri: normalized.uri });
  return Object.freeze({
    ...state,
    /** 渲染用标签：name → email → uri。 */
    label: () => state.name || state.email || state.uri,
    toValue: () => ({ name: state.name, email: state.email, uri: state.uri }),
  });
}

/**
 * feed.image 实体。无有效 url 时工厂返回 null。
 * @param {unknown} value
 */
export function FeedImageModel(value) {
  const normalized = normalize_image(value);
  if (normalized === null) return null;
  const state = Object.freeze({ url: normalized.url, title: normalized.title, link: normalized.link });
  return Object.freeze({
    ...state,
    toValue: () => ({ url: state.url, title: state.title, link: state.link }),
  });
}

/**
 * 附件实体（item.enclosure / item.video）。无有效 url 时工厂返回 null。
 * @param {unknown} value
 */
export function FeedEnclosureModel(value) {
  const normalized = normalize_enclosure(value);
  if (normalized === null) return null;
  const state = Object.freeze({
    url: normalized.url,
    type: normalized.type,
    length: normalized.length,
    key: normalized.key,
  });
  return Object.freeze({
    ...state,
    /** media:* 元素的 medium 值（video/image/audio），未知为空串。 */
    medium: () => {
      if (state.type.startsWith("video/")) return "video";
      if (state.type.startsWith("image/")) return "image";
      if (state.type.startsWith("audio/")) return "audio";
      return "";
    },
    toValue: () => ({ url: state.url, type: state.type, length: state.length, key: state.key }),
  });
}

// 明确配对 Live Photo；动态视频密钥不能使用静态图片的密钥。
function normalize_live_photos(value) {
  return (Array.isArray(value) ? value : []).filter(item => item && trimmed(item.image) && trimmed(item.video))
    .map(item => Object.freeze({ image: trimmed(item.image), video: trimmed(item.video),
      key: String(item.key ?? ""), width: Math.max(0, Number(item.width) || 0), height: Math.max(0, Number(item.height) || 0) }));
}

function live_photo_xml(item) {
  const attr = value => escape_attr(value);
  return '<media:group><media:content url="' + attr(item.image) + '" medium="image" isDefault="true" />' +
    '<media:content url="' + attr(item.video) + '" medium="video" type="video/mp4" key="' + attr(item.key) +
    '" width="' + attr(item.width) + '" height="' + attr(item.height) + '">' +
    '<media:thumbnail url="' + attr(item.image) + '" /></media:content></media:group>';
}

/**
 * feed item 实体。非对象一律返回 null（`FeedModel` 会丢弃）。
 * @param {unknown} raw
 */
export function FeedItemModel(raw) {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const state = Object.freeze({
    id: trimmed(raw.id),
    type: ["article", "gallery", "video", "live"].includes(raw.type) ? raw.type : "",
    title: body_text(raw.title),
    link: trimmed(raw.link),
    description: body_text(raw.description),
    content: body_text(raw.content),
    author: FeedPersonModel(raw.author),
    published: parse_time(raw.published),
    updated: parse_time(raw.updated),
    image: trimmed(raw.image),
    media_group: raw.media_group === true && normalize_live_photos(raw.live_photos).length === 0,
    images: Object.freeze(normalize_image_list(raw.images)),
    live_photos: Object.freeze(normalize_live_photos(raw.live_photos)),
    enclosure: FeedEnclosureModel(raw.enclosure) ?? FeedEnclosureModel(normalize_video(raw.video)),
    categories: Object.freeze(normalize_categories(raw.categories)),
  });
  return Object.freeze({
    ...state,
    toValue: () => ({
      id: state.id,
      ...(state.type ? { type: state.type } : {}),
      title: state.title,
      link: state.link,
      description: state.description,
      content: state.content,
      author: state.author === null ? null : state.author.toValue(),
      published: state.published,
      updated: state.updated,
      image: state.image,
      ...(state.media_group ? { media_group: true } : {}),
      images: [...state.images],
      ...(state.live_photos.length ? { live_photos: state.live_photos.map(item => ({ ...item })) } : {}),
      enclosure: state.enclosure === null ? null : state.enclosure.toValue(),
      categories: [...state.categories],
    }),
  });
}

/**
 * 归一化脚本产出的 feed JSON。字段取 RSS 2.0 + Atom 1.0 的超集，
 * 未知字段一律忽略；结构不合法（非对象、items 非数组）时 throw。
 * 缺省字段归一为 null/空串，渲染时对应元素直接省略。
 * @param {unknown} value
 */
export function FeedModel(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("feed 必须是 JSON 对象");
  }
  if (!Array.isArray(value.items)) {
    throw new Error("feed.items 必须是数组");
  }
  const items = [];
  for (const raw of value.items) {
    const item = FeedItemModel(raw);
    if (item !== null) items.push(item);
  }
  const state = Object.freeze({
    title: body_text(value.title),
    link: trimmed(value.link),
    description: body_text(value.description),
    language: trimmed(value.language),
    id: trimmed(value.id),
    author: FeedPersonModel(value.author),
    image: FeedImageModel(value.image),
    updated: parse_time(value.updated),
    extra: feed_extra_json(value.extra),
    items: Object.freeze(items),
  });
  const model = Object.freeze({
    ...state,
    /**
     * 按格式渲染成 XML 文档。
     * @param {string} format
     * @param {{ self_url?: string }} [options]
     * @returns {string}
     */
    render: (format = "rss", options = {}) => {
      if (format === "rss") return render_rss_document(model, options);
      if (format === "atom") return render_atom_document(model, options);
      throw new Error("未知的 feed 格式：" + String(format));
    },
    toValue: () => ({
      title: state.title,
      link: state.link,
      description: state.description,
      language: state.language,
      id: state.id,
      author: state.author === null ? null : state.author.toValue(),
      image: state.image === null ? null : state.image.toValue(),
      updated: state.updated,
      ...(state.extra === "" ? {} : { extra: JSON.parse(state.extra) }),
      items: state.items.map((item) => item.toValue()),
    }),
  });
  return model;
}

/** 支持的输出格式，顺序即 `/rss`、`/atom` 前缀的推荐顺序。 */
FeedModel.FORMATS = Object.freeze(["rss", "atom"]);
FeedModel.of = FeedModel;
/** 从任意 JSON 归一化；结构不合法时 throw（沙箱输出闸门）。 */
FeedModel.fromValue = (value) => FeedModel(value);
/**
 * @param {string} format
 * @returns {string}
 */
FeedModel.content_type = (format) => format === "atom"
  ? "application/atom+xml; charset=utf-8"
  : "application/rss+xml; charset=utf-8";

// 有界 JSON 扩展；字段校验由阅读器复用自己的订阅配置规则。
function feed_extra_json(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return "";
  try {
    const json = JSON.stringify(value);
    return json.length <= 16384 ? json : "";
  } catch {
    return "";
  }
}

/** @param {unknown} value @returns {string} */
function escape_text(value) {
  return String(value ?? "")
    // XML 1.0 不接受这些码点；u 标志保留合法的代理对（如 emoji）。
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uD800-\uDFFF\uFFFE\uFFFF]/gu, "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/** @param {unknown} value @returns {string} */
function escape_attr(value) {
  return escape_text(value).replaceAll('"', "&quot;");
}

/** @param {ReturnType<typeof FeedEnclosureModel>} enclosure @param {string} indent */
function enclosure_attrs(enclosure, indent) {
  let attrs = indent + 'url="' + escape_attr(enclosure.url) + '"';
  if (enclosure.type !== "") attrs += ' type="' + escape_attr(enclosure.type) + '"';
  if (enclosure.length !== "") attrs += ' length="' + escape_attr(enclosure.length) + '"';
  // 非标准属性，但两端都是自己的实现：阅读端 extract_video 优先读它（见 packages/feed-fetch）。
  if (enclosure.key !== "") attrs += ' key="' + escape_attr(enclosure.key) + '"';
  return attrs;
}

/**
 * 渲染 RSS 2.0。正文/摘要走实体转义（不用 CDATA，避免 `]]>` 注入）。
 * 附件沿用阅读端既有语义：item.image → media:thumbnail，
 * item.images → 每张一个 media:content(medium="image")，
 * enclosure/video → enclosure + media:content(medium=video/…)。
 * @param {ReturnType<typeof FeedModel>} feed
 * @param {{ self_url?: string }} [options]
 * @returns {string}
 */
function render_rss_document(feed, options = {}) {
  const self_url = trimmed(options.self_url);
  const lines = ['<?xml version="1.0" encoding="UTF-8"?>', "<rss version=\"2.0\" " + RSS_XMLNS + ">"];
  lines.push("  <channel>");
  const element = (name, text) => {
    if (text !== "") lines.push("    <" + name + ">" + escape_text(text) + "</" + name + ">");
  };
  element("title", feed.title);
  element("link", feed.link);
  element("description", feed.description);
  element("language", feed.language);
  if (feed.extra !== "") {
    lines.push('    <findrss:extra xmlns:findrss="https://findrss.cloud/ns/reader">' +
      escape_text(feed.extra) + '</findrss:extra>');
  }
  if (feed.updated !== null) element("lastBuildDate", new Date(feed.updated).toUTCString());
  if (self_url !== "") {
    lines.push('    <atom:link href="' + escape_attr(self_url) + '" rel="self" type="application/rss+xml" />');
  }
  if (feed.image !== null) {
    lines.push("    <image>");
    lines.push("      <url>" + escape_text(feed.image.url) + "</url>");
    if (feed.image.title !== "") lines.push("      <title>" + escape_text(feed.image.title) + "</title>");
    if (feed.image.link !== "") lines.push("      <link>" + escape_text(feed.image.link) + "</link>");
    lines.push("    </image>");
  }
  for (const item of feed.items) {
    lines.push("    <item>");
    element("title", item.title);
    element("link", item.link);
    const guid = item.id !== "" ? item.id : item.link;
    if (guid !== "") {
      // 与阅读端 extract 逻辑一致：guid 就是 link 且为 http(s) 时才是永久链接。
      const is_permalink = guid === item.link && /^https?:\/\//i.test(guid);
      lines.push('      <guid isPermaLink="' + (is_permalink ? "true" : "false") + '">' +
        escape_text(guid) + "</guid>");
    }
    element("description", item.description);
    if (item.content !== "") {
      lines.push("      <content:encoded>" + escape_text(item.content) + "</content:encoded>");
    }
    if (item.author !== null) {
      const name = item.author.label();
      if (name !== "") element("dc:creator", name);
    }
    if (item.published !== null) element("pubDate", new Date(item.published).toUTCString());
    if (item.media_group) {
      if (item.enclosure !== null) lines.push("      <enclosure" + enclosure_attrs(item.enclosure, " ") + " />");
      lines.push("      <media:group>");
      lines.push("        <media:title>" + escape_text(item.title) + "</media:title>");
      lines.push("        <media:description>" + escape_text(item.description) + "</media:description>");
    }
    if (item.image !== "") {
      lines.push('      <media:thumbnail url="' + escape_attr(item.image) + '" />');
    }
    for (const image of item.images) {
      const photo = item.live_photos.find(value => value.image === image);
      lines.push(photo ? '      ' + live_photo_xml(photo) : '      <media:content url="' + escape_attr(image) + '" medium="image" />');
    }
    if (item.enclosure !== null) {
      if (!item.media_group) lines.push("      <enclosure" + enclosure_attrs(item.enclosure, " ") + " />");
      const medium = item.enclosure.medium();
      lines.push("      <media:content" + enclosure_attrs(item.enclosure, " ") +
        (medium === "" ? "" : ' medium="' + medium + '"') + " />");
    }
    for (const photo of item.live_photos.filter(value => !item.images.includes(value.image))) lines.push("      " + live_photo_xml(photo));
    if (item.media_group) lines.push("      </media:group>");
    if (item.type) lines.push('      <category domain="urn:content-type">' + item.type + "</category>");
    for (const category of item.categories) element("category", category);
    lines.push("    </item>");
  }
  lines.push("  </channel>");
  lines.push("</rss>");
  return lines.join("\n") + "\n";
}

/** entry 内的文本元素统一 4 空格缩进。 */
function element_at(lines, name, text) {
  if (text !== "") lines.push("    <" + name + ">" + escape_text(text) + "</" + name + ">");
}

/**
 * 渲染 Atom 1.0。entry 的 <updated> 回退链：updated → published → feed.updated；
 * feed/entry author 缺失时用 feed title 兜底（Atom 要求必有）。
 * @param {ReturnType<typeof FeedModel>} feed
 * @param {{ self_url?: string }} [options]
 * @returns {string}
 */
function render_atom_document(feed, options = {}) {
  const self_url = trimmed(options.self_url);
  const feed_id = feed.id !== "" ? feed.id : feed.link !== "" ? feed.link
    : self_url !== "" ? self_url : FALLBACK_FEED_ID;
  const lines = ['<?xml version="1.0" encoding="UTF-8"?>'];
  lines.push("<feed " + ATOM_XMLNS +
    (feed.language === "" ? "" : ' xml:lang="' + escape_attr(feed.language) + '"') + ">");
  const element = (name, text) => {
    if (text !== "") lines.push("  <" + name + ">" + escape_text(text) + "</" + name + ">");
  };
  element("title", feed.title);
  element("id", feed_id);
  if (feed.updated !== null) element("updated", new Date(feed.updated).toISOString());
  if (feed.link !== "") {
    lines.push('  <link rel="alternate" href="' + escape_attr(feed.link) + '" />');
  }
  if (self_url !== "") {
    lines.push('  <link rel="self" href="' + escape_attr(self_url) + '" type="application/atom+xml" />');
  }
  element("subtitle", feed.description);
  if (feed.extra !== "") {
    lines.push('  <findrss:extra xmlns:findrss="https://findrss.cloud/ns/reader">' +
      escape_text(feed.extra) + '</findrss:extra>');
  }
  // Atom 的 feed 必须有 author：脚本没给就用 feed title / id 兜底。
  lines.push("  <author>");
  lines.push("    <name>" + escape_text(
    feed.author !== null && feed.author.label() !== ""
      ? feed.author.label()
      : feed.title || feed_id,
  ) + "</name>");
  if (feed.author !== null && feed.author.email !== "") {
    lines.push("    <email>" + escape_text(feed.author.email) + "</email>");
  }
  if (feed.author !== null && feed.author.uri !== "") {
    lines.push("    <uri>" + escape_text(feed.author.uri) + "</uri>");
  }
  lines.push("  </author>");
  if (feed.image !== null) element("logo", feed.image.url);
  for (const [index, item] of feed.items.entries()) {
    lines.push("  <entry>");
    element_at(lines, "title", item.title);
    const entry_id = item.id !== "" ? item.id : item.link !== "" ? item.link
      : feed_id + "#" + index;
    element_at(lines, "id", entry_id);
    const updated = item.updated ?? item.published ?? feed.updated;
    if (updated !== null) {
      lines.push("    <updated>" + new Date(updated).toISOString() + "</updated>");
    }
    if (item.published !== null) {
      lines.push("    <published>" + new Date(item.published).toISOString() + "</published>");
    }
    if (item.link !== "") {
      lines.push('    <link rel="alternate" href="' + escape_attr(item.link) + '" />');
    }
    if (item.enclosure !== null) {
      lines.push('    <link rel="enclosure"' + enclosure_attrs(item.enclosure, " ") + " />");
    }
    if (item.author !== null && item.author.label() !== "") {
      lines.push("    <author>");
      lines.push("      <name>" + escape_text(item.author.label()) + "</name>");
      if (item.author.email !== "") {
        lines.push("      <email>" + escape_text(item.author.email) + "</email>");
      }
      if (item.author.uri !== "") {
        lines.push("      <uri>" + escape_text(item.author.uri) + "</uri>");
      }
      lines.push("    </author>");
    }
    if (item.description !== "") {
      lines.push('    <summary type="html">' + escape_text(item.description) + "</summary>");
    }
    if (item.content !== "") {
      lines.push('    <content type="html">' + escape_text(item.content) + "</content>");
    }
    if (item.media_group) {
      lines.push("    <media:group>");
      lines.push("      <media:title>" + escape_text(item.title) + "</media:title>");
      lines.push("      <media:description>" + escape_text(item.description) + "</media:description>");
    }
    if (item.image !== "") {
      lines.push('    <media:thumbnail url="' + escape_attr(item.image) + '" />');
    }
    for (const image of item.images) {
      const photo = item.live_photos.find(value => value.image === image);
      lines.push(photo ? '    ' + live_photo_xml(photo) : '    <media:content url="' + escape_attr(image) + '" medium="image" />');
    }
    if (item.enclosure !== null) {
      const medium = item.enclosure.medium();
      lines.push("    <media:content" + enclosure_attrs(item.enclosure, " ") +
        (medium === "" ? "" : ' medium="' + medium + '"') + " />");
    }
    for (const photo of item.live_photos.filter(value => !item.images.includes(value.image))) lines.push("      " + live_photo_xml(photo));
    if (item.media_group) lines.push("    </media:group>");
    if (item.type) lines.push('    <category scheme="urn:content-type" term="' + item.type + '" />');
    for (const category of item.categories) {
      lines.push('    <category term="' + escape_attr(category) + '" />');
    }
    lines.push("  </entry>");
  }
  lines.push("</feed>");
  return lines.join("\n") + "\n";
}
