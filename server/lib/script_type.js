export function script_type(script, declared_type) {
  if (declared_type === "hot" || declared_type === "rss" || declared_type === "clip" || declared_type === "detect") return declared_type;
  const source = String(script || "");
  const marker = source.match(/^\s*\/\*\*\s*(HOT|RSS|CLIP|DETECT)\s*\*\//i)?.[1];
  if (marker) return marker.toLowerCase();
  const base_class = source.match(/\bclass\s+\w+\s+extends\s+(HotRankScript|RSSScript|ClipScript|DetectScript)\b/)?.[1];
  if (base_class) return base_class === "HotRankScript" ? "hot" : base_class === "ClipScript" ? "clip" : base_class === "DetectScript" ? "detect" : "rss";
  // 兼容迁移前未标记的 NewsNow 榜单示例。
  if (/\b(?:utils\.source|const\s+source)\s*=\s*\{/.test(source)) return "hot";
  return "rss";
}
