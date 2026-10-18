import { public_http_url } from "../lib/proxy_url.js";
import { fetch_cover_metadata } from "./discovery_snapshot.js";

// 仅生成快照时读取图片，RSS/Atom 共用结果；去重并限制同时下载的图片数量。
export async function feed_image_metadata(feed, { signal, metadata_for = fetch_cover_metadata } = {}) {
  const urls = new Set();
  const visit = item => {
    for (const value of [item.image, ...item.images, ...item.live_photos.map(photo => photo.image),
      ...(item.enclosure?.type.startsWith("image/") ? [item.enclosure.url] : [])]) {
      if (public_http_url(value)) urls.add(value);
    }
    for (const reference of item.references) if (reference.item) visit(reference.item);
  };
  for (const item of feed.items) visit(item);
  const pending = [...urls];
  const metadata = new Map();
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, pending.length) }, async () => {
    while (next < pending.length) {
      signal?.throwIfAborted();
      const url = pending[next++];
      try {
        const value = await metadata_for(url, undefined, signal);
        if (value) metadata.set(url, value);
      } catch {
        signal?.throwIfAborted();
        // 单张图片下载、解码失败不影响订阅内容刷新。
      }
    }
  }));
  signal?.throwIfAborted();
  return metadata;
}
