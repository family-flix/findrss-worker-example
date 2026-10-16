import { proxy_target_url } from "@findrss/feed-fetch";
import { public_http_url } from "../lib/proxy_url.js";
import { discovery_feed_preview, fetch_discovery_document } from "./feed_fetch.js";
import { encode_cover_blurhash } from "./cover_blurhash.js";
import { SourceAddressModel } from "../domain/source_address.js";
import { sha256_hex } from "../lib/crypto.js";

export async function load_discovery_snapshot(source, origin, serve_route, signal) {
  signal?.throwIfAborted();
  const address = SourceAddressModel(source.feed_url);
  if (address.is_template && !origin) throw new Error("尚未获取访问域名，请访问站点后重试或配置 FINDRSS_HOSTNAME");
  const feed_url = address.resolve(origin);
  const target = new URL(feed_url);
  let xml;
  if (address.is_route() && (address.is_template || origin && target.origin === new URL(origin).origin)) {
    const internal = new URL("https://internal/" + (source.require_token ? "_admin" : "_public") + "/feed/" + address.format + address.route_pathname);
    internal.search = target.search;
    const result = await serve_route(address.format, address.route_pathname,
      new Request(internal, { headers: { "X-Feed-Public-URL": feed_url } }), { refresh: true, signal });
    xml = result.body;
  } else {
    const result = await fetch_discovery_document(feed_url, signal);
    if (result.error || result.http_status !== 200) throw new Error(result.error || "订阅源读取失败");
    xml = result.xml;
  }
  signal?.throwIfAborted();
  if (source.require_token) {
    return { articles: [], fingerprint: await discovery_snapshot_fingerprint(xml, feed_url) };
  }
  return { articles: await discovery_snapshot_articles(xml, feed_url, url => fetch_cover_metadata(url, decode_cover, signal)) };
}

export async function discovery_snapshot_fingerprint(xml, feed_url) {
  const feed = discovery_feed_preview(xml, feed_url);
  const identities = feed.articles.map(article => JSON.stringify([article.id, article.link, article.title, article.published_at])).sort();
  return sha256_hex(JSON.stringify(identities));
}

// 只读取图片头，不解码像素；限制读取量，避免大封面占用 Worker 内存。
export function image_dimensions(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const signature = (offset, length) => String.fromCharCode(...bytes.subarray(offset, offset + length));
  let width = 0, height = 0;
  if (bytes.length >= 24 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value) && signature(12, 4) === "IHDR") {
    width = view.getUint32(16); height = view.getUint32(20);
  } else if (bytes.length >= 10 && /^GIF8[79]a$/.test(signature(0, 6))) {
    width = view.getUint16(6, true); height = view.getUint16(8, true);
  } else if (bytes.length >= 30 && signature(0, 4) === "RIFF" && signature(8, 4) === "WEBP") {
    const kind = signature(12, 4);
    if (kind === "VP8X") {
      width = 1 + (bytes[24] | bytes[25] << 8 | bytes[26] << 16);
      height = 1 + (bytes[27] | bytes[28] << 8 | bytes[29] << 16);
    } else if (kind === "VP8 " && bytes[23] === 0x9d && bytes[24] === 1 && bytes[25] === 0x2a) {
      width = view.getUint16(26, true) & 0x3fff; height = view.getUint16(28, true) & 0x3fff;
    } else if (kind === "VP8L" && bytes[20] === 0x2f) {
      const bits = view.getUint32(21, true);
      width = 1 + (bits & 0x3fff); height = 1 + (bits >>> 14 & 0x3fff);
    }
  } else if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    for (let index = 2; index + 3 < bytes.length;) {
      if (bytes[index] !== 0xff) { index++; continue; }
      const marker = bytes[index + 1];
      if (marker === 0xff) { index++; continue; }
      if (marker === 0xd9 || marker === 0xda) break;
      if (marker === 1 || marker === 0xd8 || marker >= 0xd0 && marker <= 0xd7) { index += 2; continue; }
      const length = view.getUint16(index + 2);
      if (length < 2 || index + 2 + length > bytes.length) break;
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker) && length >= 7) {
        height = view.getUint16(index + 5); width = view.getUint16(index + 7); break;
      }
      index += 2 + length;
    }
  }
  // shortcut: AVIF/SVG 或前 64 KiB 没有尺寸的图片保留封面，升级格式支持时补解析器。
  return width > 0 && height > 0 && width <= 100000 && height <= 100000 ? { width, height } : null;
}

let decoding = Promise.resolve();
function decode_cover(bytes, content_type) {
  const result = decoding.then(async () => {
    const { decode_image } = await import("./image_decode.js");
    const image = await decode_image(bytes, content_type);
    return image ? encode_cover_blurhash(image) : "";
  });
  decoding = result.catch(() => {});
  return result;
}

async function read_cover(url, decode, task_signal) {
  const timeout = AbortSignal.timeout(8000);
  const signal = task_signal ? AbortSignal.any([timeout, task_signal]) : timeout;
  const max_bytes = decode ? 2 * 1024 * 1024 : 65536;
  let dimensions = null;
  for (let hop = 0; hop <= 5; hop++) {
    const target = proxy_target_url(url);
    if (!target) throw new Error("封面地址被拒绝");
    const response = await fetch(target, { redirect: "manual", signal, headers: { Range: `bytes=0-${max_bytes - 1}` } });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      url = new URL(response.headers.get("Location"), target).href;
      continue;
    }
    if (!response.ok || !response.body) { await response.body?.cancel(); return null; }
    const reader = response.body.getReader();
    const bytes = new Uint8Array(max_bytes);
    let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          const range = response.headers.get("Content-Range");
          if (decode && dimensions && (!range || Number(range.split("/")[1]) === size)) {
            const type = bytes[0] === 137 ? "image/png" : bytes[0] === 255 ? "image/jpeg" : "image/webp";
            const blurhash = await decode(bytes.subarray(0, size), type);
            return { ...dimensions, blurhash };
          }
          return dimensions;
        }
        const chunk = value.subarray(0, bytes.length - size);
        bytes.set(chunk, size); size += chunk.length;
        dimensions ||= image_dimensions(bytes.subarray(0, size));
        if (dimensions && (!decode || dimensions.width * dimensions.height > 4000000 || bytes[0] === 71)) return dimensions;
        if (value.length > chunk.length || size === max_bytes) return dimensions;
      }
    } catch { return dimensions; }
    finally { await reader.cancel().catch(() => {}); }
  }
  return null;
}

export function fetch_cover_dimensions(url) { return read_cover(url, null); }
export function fetch_cover_metadata(url, decode = decode_cover, signal) { return read_cover(url, decode, signal); }

export async function discovery_snapshot_articles(xml, feed_url, dimensions_for = fetch_cover_metadata) {
  const feed = discovery_feed_preview(xml, feed_url);
  const covers = new Map();
  return Promise.all(feed.articles.slice(0, 3).map(async (article, index) => {
    const cover_url = public_http_url(article.thumbnail) || "";
    if (cover_url && !covers.has(cover_url)) covers.set(cover_url, Promise.resolve().then(() => dimensions_for(cover_url)).catch(() => null));
    const dimensions = cover_url ? await covers.get(cover_url) : null;
    return { id: String(index), title: String(article.title || "无标题").slice(0, 180),
      link: public_http_url(article.link) || "", published_at: Number(article.published_at) || 0,
      cover_url, cover_width: dimensions?.width || 0, cover_height: dimensions?.height || 0,
      cover_blurhash: dimensions?.blurhash || "" };
  }));
}
