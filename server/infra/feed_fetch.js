// API 与阅读端共用同一份直连抓取、解析和正文抽取实现。
import {
  create_feed_parser,
  create_html_extractor,
  fetch_article,
  fetch_feed,
  fetch_feed_document,
  proxy_target_url,
  public_http_url,
} from "@findrss/feed-fetch";
import { SourceAvatarModel } from "../domain/discovery_source.js";
import { XMLParser, XMLValidator } from "fast-xml-parser/src/fxp.js";
import { parse } from "node-html-parser";

const { parse_feed_document } = create_feed_parser(XMLParser, XMLValidator);
export function discovery_feed_preview(xml, feed_url) {
  const feed = parse_feed_document(xml, feed_url);
  const validation = XMLValidator.validate(xml);
  const parsed = new XMLParser({ ignoreAttributes: false, parseTagValue: false, trimValues: false,
    processEntities: { enabled: true, maxTotalExpansions: Math.max(1000, xml.length) } }).parse(xml);
  const channel = parsed.rss?.channel ?? parsed.feed ?? parsed["rdf:RDF"]?.channel ?? parsed.RDF?.channel ?? {};
  const { item, entry, ...xml_fields } = channel;
  const entries = [item ?? entry ?? parsed["rdf:RDF"]?.item ?? parsed.RDF?.item ?? []].flat();
  const safe_url = value => {
    if (!value) return "";
    try {
      const url = new URL(value, feed.site_url || feed_url);
      return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href : "";
    }
    catch { return ""; }
  };
  return { ...feed, icon: safe_url(feed.icon), site_url: safe_url(feed.site_url), xml_fields,
    validation: { ok: validation === true, error: validation === true ? "" : validation.err.msg },
    total_count: feed.articles.length, articles: feed.articles.map((article, index) => {
      const fields = entries[index] || {};
      const attachments = [...[fields.enclosure ?? []].flat(),
        ...[fields.link ?? []].flat().filter(link => link?.["@_rel"] === "enclosure")]
        .map(value => ({ url: safe_url(value["@_url"] || value["@_href"]),
          type: value["@_type"] || "", length: value["@_length"] || "", key: value["@_key"] || "" }))
        .filter(value => value.url);
      return { ...article, link: public_http_url(article.link) || "", xml_fields: fields, attachments };
    }) };
}
const { extract_article_html } = create_html_extractor(parse);

export const fetch_source_feed = (input) =>
  fetch_feed({ ...input, parse_feed: parse_feed_document });

export const fetch_source_article = (input) =>
  fetch_article({ ...input, extract_article: extract_article_html });

export const fetch_discovery_feed = (feed_url) => proxy_target_url(feed_url)
  ? fetch_source_feed({ feed_url })
  : Promise.resolve({ error: "订阅源地址被拒绝" });

export const fetch_discovery_document = (feed_url) => proxy_target_url(feed_url)
  ? fetch_feed_document({ feed_url }) : Promise.resolve({ http_status: 0, error: '订阅源地址被拒绝', xml: '' });

export function discovery_feed_defaults(xml, feed_url) {
  const feed = parse_feed_document(xml, feed_url);
  const parsed = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true,
    processEntities: { enabled: true, maxExpansionDepth: 10, maxTotalExpansions: 5000 } }).parse(xml);
  const root = parsed.feed ?? parsed.rss?.channel ?? parsed.RDF?.channel ?? {};
  const categories = [root.category ?? []].flat().map((value) =>
    String(typeof value === "object" ? value["@_term"] ?? value["#text"] ?? "" : value).trim(),
  ).filter(Boolean);
  return { title: feed.title.slice(0, 128), description: feed.description.replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").slice(0, 1000),
    website: public_http_url(feed.site_url) ?? "", avatar_url: feed.icon,
    tags: [...new Set(categories)].filter((tag) => !/[\r\n]/.test(tag)).slice(0, 12).map((tag) => tag.slice(0, 32)) };
}

export async function fetch_discovery_avatar(url) {
  for (let hop = 0; hop <= 5; hop++) {
    const target = proxy_target_url(url);
    if (!target) throw new Error("头像地址被拒绝");
    const response = await fetch(target, { redirect: "manual", signal: AbortSignal.timeout(15000) });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      url = new URL(response.headers.get("Location"), target).href;
      continue;
    }
    if (!response.ok) { await response.body?.cancel(); throw new Error("头像读取失败"); }
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > SourceAvatarModel.MAX_BYTES) { await reader.cancel(); throw new Error("头像过大"); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const content_type = SourceAvatarModel.sniff(bytes);
    if (!content_type) throw new Error("头像格式不支持");
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return { data: btoa(binary), content_type };
  }
  throw new Error("头像重定向次数过多");
}
