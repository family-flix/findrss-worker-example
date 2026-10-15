export function script_type(script, declared_type) {
  if (declared_type === "hot" || declared_type === "rss") return declared_type;
  const source = String(script || "");
  const marker = source.match(/^\s*\/\*\*\s*(HOT|RSS)\s*\*\//i)?.[1];
  if (marker) return marker.toLowerCase();
  const base_class = source.match(/\bclass\s+\w+\s+extends\s+(HotRankScript|RSSScript)\b/)?.[1];
  if (base_class) return base_class === "HotRankScript" ? "hot" : "rss";
  // 兼容迁移前未标记的 NewsNow 榜单和 Instagram 快照示例。
  if (/\b(?:utils\.source|const\s+source)\s*=\s*\{/.test(source) || /\bpath\s*:\s*["']\/instagram\/user\/:username["']/.test(source)) return "hot";
  return "rss";
}
