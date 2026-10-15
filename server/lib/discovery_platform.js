import { DISCOVERY_PLATFORM_LABELS } from "./constants.js";

export function discovery_platform_id(value) {
  const label = String(value && typeof value === "object" ? value.name || value.label || value.id || "" : value || "").trim();
  if (!label || label === "网站" || label === "网页") return "website";
  return Object.keys(DISCOVERY_PLATFORM_LABELS).find(id => DISCOVERY_PLATFORM_LABELS[id] === label) || label;
}

export function discovery_platform_label(id, platforms = []) {
  if (id && typeof id === "object") return script_platform(id).name;
  const platform = platforms.find(platform => platform.id === id);
  if (platform) return platform.name || platform.label;
  return Object.hasOwn(DISCOVERY_PLATFORM_LABELS, id) ? DISCOVERY_PLATFORM_LABELS[id] : id;
}

export function discovery_platform_icon(id) {
  return Object.hasOwn(DISCOVERY_PLATFORM_LABELS, id) ? id : "website";
}

export function script_platform(value, { strict = false } = {}) {
  if (value === undefined) value = { name: "网页", icon: "" };
  if (typeof value === "string") value = { name: value.trim() ? discovery_platform_label(discovery_platform_id(value)) : "", icon: "" };
  const valid = value && typeof value === "object" && !Array.isArray(value)
    && typeof value.name === "string" && value.name.trim() && value.name.trim() !== "all"
    && value.name.length <= 64 && !/[\u0000-\u001f\u007f]/.test(value.name)
    && (value.icon === undefined || typeof value.icon === "string");
  const icon = valid ? (value.icon || "").trim() : "";
  if (!valid || icon.length > 131072 || icon && !platform_icon_url(icon)) {
    if (strict) throw new Error("platform 必须是 { name, icon }，name 为 1–64 字符，icon 为 SVG 源码或无凭据的 HTTP(S) / 站内图片地址（最多 128KB）");
    return { name: "网页", icon: "" };
  }
  return { name: discovery_platform_label(discovery_platform_id(value.name)), icon };
}

// SVG 始终作为 img 的 data URL 使用，不把脚本提供的标记插入页面 DOM。
export function platform_icon_url(value) {
  const icon = typeof value === "string" ? value.trim() : "";
  if (!icon || icon.length > 131072) return "";
  if (/^<svg\b[\s\S]*(?:<\/svg>|\/>\s*)$/i.test(icon)) return "data:image/svg+xml," + encodeURIComponent(icon);
  if (icon.length > 2048 || /[\u0000-\u0020\u007f]/.test(icon)) return "";
  if (icon.startsWith("/") && !icon.startsWith("//") && !icon.includes("\\")) return icon;
  try {
    const url = new URL(icon);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href : "";
  } catch { return ""; }
}

export function discovery_platforms(platforms = [], sources = []) {
  const entries = new Map([["website", { id: "website", label: "网页", icon: "" }]]);
  for (const value of [...platforms, ...sources.map(source => source.source_type)]) {
    const id = discovery_platform_id(value);
    const object = value && typeof value === "object" ? value : {};
    const existing = entries.get(id);
    entries.set(id, { id, label: String(object.name || object.label || discovery_platform_label(id)),
      icon: platform_icon_url(object.icon) ? object.icon : existing?.icon || "" });
  }
  return [...entries.values()];
}
