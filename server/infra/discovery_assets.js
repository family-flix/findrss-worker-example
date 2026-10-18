import { safe_avatar_url } from "../lib/discovery_sources.js";

export function lazy_catalog_avatars(catalog) {
  return { ...catalog, sources: catalog.sources.map(source => {
    const value = String(source.avatar_url || "");
    // 旧 R2 目录只保留了 data URL，按源 ID 恢复同源头像接口。
    const url = value.startsWith("data:image/") && source.id
      ? `/public/avatar/${encodeURIComponent(source.id)}?v=${Number(source.updated_at) || 0}` : value;
    return { ...source, avatar_url: safe_avatar_url(url) };
  }) };
}
