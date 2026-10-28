import { RssRoutePatternModel } from "../../server/domain/rss_route.js";

export function script_preview_asset_url(address, assets) {
  if (!address || !assets || !/^\/admin\/api\/scripts\/preview-assets\/[a-f0-9-]{36}$/.test(assets.endpoint)) return address;
  const url = new URL(address);
  return url.origin === assets.public_origin && assets.paths?.some(path => RssRoutePatternModel.fromValue(path)?.match(url.pathname))
    ? assets.endpoint + "?url=" + encodeURIComponent(address) : address;
}

export function ScriptDebugPreviewModel(debug, fallback_kind = "") {
  let value;
  try { value = JSON.parse(debug?.output); } catch {}
  const kind = typeof value?.kind === "string" ? value.kind
    : value?.url ? "img" : fallback_kind;
  if (kind === "clip") return { kind, src: "", error: "", html: debug?.phase === "ok" && typeof value?.html === "string" ? value.html : "" };
  if (!["img", "video", "audio"].includes(kind)) return { kind, src: "", error: "" };
  if (!debug?.output || debug.phase !== "ok") return { kind, src: "", error: "" };
  try {
    if (typeof value.url !== "string") throw new Error();
    const url = new URL(value.url);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error();
    const assets = debug.preview_assets;
    const media_url = assets?.media_url;
    const src = /^\/admin\/api\/scripts\/preview-assets\/[a-f0-9-]{36}\?media=1$/.test(media_url || "")
      ? media_url : script_preview_asset_url(url.href, assets);
    return { kind, src, error: "" };
  } catch { return { kind, src: "", error: "媒体输出需要有效的 HTTP(S) url" }; }
}
