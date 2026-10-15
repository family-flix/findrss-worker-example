// 接口加载前使用本地默认值；实际平台列表由接口返回。
const DISCOVERY_PLATFORM_LABELS = {
  douyin: "抖音",
  wxchannels: "视频号",
  wxmp: "公众号",
  zhihu: "知乎",
  x: "X",
  xiaohongshu: "小红书",
  bilibili: "哔哩哔哩",
  weibo: "微博",
  kuaishou: "快手",
  youtube: "YouTube",
  instagram: "Instagram",
  telegram: "Telegram",
  website: "网页",
};

export function discovery_platform_id(value) {
  const label = String(value || "").trim();
  if (!label || label === "网站" || label === "网页") return "website";
  return Object.keys(DISCOVERY_PLATFORM_LABELS).find(id => DISCOVERY_PLATFORM_LABELS[id] === label) || label;
}

export function discovery_platform_label(id, platforms = []) {
  const platform = platforms.find(platform => platform.id === id);
  if (platform) return platform.label;
  return Object.hasOwn(DISCOVERY_PLATFORM_LABELS, id) ? DISCOVERY_PLATFORM_LABELS[id] : id;
}

export function discovery_platform_icon(id) {
  return Object.hasOwn(DISCOVERY_PLATFORM_LABELS, id) ? id : "website";
}

export function discovery_platforms() {
  return [{ id: "website", label: "网页" }];
}
