/** RSS */
export const platform = {"name": "Apple", "icon": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"#98a0ae\" stroke-width=\"1.5\" stroke-linecap=\"round\" stroke-linejoin=\"round\" data-n=\"website-platform-icon\"><circle cx=\"12\" cy=\"12\" r=\"8.5\" data-n=\"website-icon-circle-1\" /><ellipse cx=\"12\" cy=\"12\" rx=\"3.6\" ry=\"8.5\" data-n=\"website-icon-ellipse-2\" /><path d=\"M3.7 9.4h16.6M3.7 14.6h16.6\" data-n=\"website-icon-path-3\" /></svg>"};
// 改编自 https://github.com/DIYgod/RSSHub/blob/master/lib/routes/apple/apps.ts
import { utils } from "@findrss/util";

const platform_names = { osx: "macOS", ios: "iOS", appletvos: "tvOS" };
const platform_aliases = { macos: "osx", ios: "ios", tvos: "appletvos" };

export class AppleAppsRSS extends RSSScript {
  async fetch(ctx) {
    try {
      const country = String(ctx.params?.country || "").toLowerCase();
      const matched_id = /^(?:id)?([1-9]\d{0,19})$/.exec(String(ctx.params?.id || ""));
      const requested_platform = String(ctx.params?.platform || "all").toLowerCase();
      const requested_limit = String(ctx.query?.limit ?? "100");
      if (!/^[a-z]{2}$/.test(country)) return Result.Err("country 必须是两位 App Store 地区代码，如 us、cn", "INVALID_PARAMETER");
      if (!matched_id) return Result.Err("id 必须是 App Store 数字 ID，可带 id 前缀", "INVALID_PARAMETER");
      if (!/^[a-z][a-z0-9_-]{0,31}$/.test(requested_platform)) return Result.Err("platform 必须是有效的平台标识", "INVALID_PARAMETER");
      if (!/^[1-9]\d{0,3}$/.test(requested_limit) || Number(requested_limit) > 1000) {
        return Result.Err("limit 必须是 1–1000 的整数，默认 100", "INVALID_PARAMETER");
      }
      const limit = Number(requested_limit);
      const app_id = matched_id[1];
      const id = "id" + app_id;
      const link = "https://apps.apple.com/" + country + "/app/" + id;
      const query = {
        platform: "iphone",
        additionalPlatforms: "appletv,ipad,iphone,mac,realityDevice,watch",
        extend: "description,iconArtwork,versionHistory",
        l: "en-US",
      };
      const endpoint = "https://apps.apple.com/api/apps/v1/catalog/" + country + "/apps/" + app_id + "?" +
        Object.entries(query).map(([key, value]) => encodeURIComponent(key) + "=" + encodeURIComponent(value)).join("&");
      const fetched = await utils.request_json(ctx, endpoint, {
        headers: { Accept: "application/json", Authorization: "Bearer", Origin: "https://apps.apple.com" },
      });
      if (fetched.error) return fetched;
      const attributes = fetched.data?.data?.[0]?.attributes;
      const platforms = attributes?.platformAttributes;
      if (typeof attributes?.name !== "string" || !attributes.name.trim() || !platforms ||
        typeof platforms !== "object" || Array.isArray(platforms) || !Object.keys(platforms).length) {
        return Result.Err("Apple 接口缺少应用名称或平台信息，请检查地区和应用 ID", "UPSTREAM_INVALID_RESPONSE");
      }
      const platform_id = Object.hasOwn(platform_aliases, requested_platform) ? platform_aliases[requested_platform] : requested_platform;
      // 与 RSSHub 一致：未指定平台、all 或应用不支持该平台时，合并全部平台。
      const selected_platform = requested_platform !== "all" && Object.hasOwn(platforms, platform_id);
      const selected = selected_platform ? [[platform_id, platforms[platform_id]]] : Object.entries(platforms);
      const items = [];
      let description = "", image = "";
      for (const [pid, platform] of selected) {
        const history = utils.array_at(platform, "versionHistory");
        if (history.error) return history;
        if (typeof platform.description?.standard === "string") description = platform.description.standard.replace(/\r?\n/g, " ");
        const icon = platform.iconArtwork?.url;
        if (typeof icon === "string" && icon) {
          const resolved = utils.absolute_url(icon.replace(/\{w\}/g, "3000").replace(/\{h\}/g, "3000")
            .replace(/\{c\}/g, "bb").replace(/\{f\}/g, "webp"));
          if (resolved.error) return resolved;
          image = resolved.data;
        }
        const platform_name = Object.hasOwn(platform_names, pid) ? platform_names[pid] : pid;
        for (const entry of history.data) {
          if (typeof entry?.versionDisplay !== "string" || !entry.versionDisplay.trim()) {
            return Result.Err("Apple 版本记录缺少版本号", "UPSTREAM_INVALID_RESPONSE");
          }
          const published = utils.timestamp(entry.releaseTimestamp);
          if (published.error) return published;
          const content = utils.escape_html(entry.releaseNotes).replace(/\r?\n/g, "<br>");
          items.push({
            id: "apple/apps/" + country + "/" + id + "/" + pid + "#" + entry.versionDisplay,
            title: attributes.name + " " + entry.versionDisplay + " for " + platform_name,
            link,
            description: content,
            content,
            categories: [platform_name],
            published: published.data,
          });
        }
      }
      items.sort((left, right) => (right.published || 0) - (left.published || 0));
      const seen = new Set();
      const unique = items.filter(item => {
        if (seen.has(item.id)) return false;
        seen.add(item.id);
        return true;
      });
      ctx.log("Apple 应用版本记录", { country, app_id, platforms: selected.map(([pid]) => pid), count: unique.length });
      return Result.Ok({
        title: attributes.name + (selected_platform ? " for " + (Object.hasOwn(platform_names, platform_id) ? platform_names[platform_id] : platform_id) : "") + " - Apple App Store",
        link,
        description,
        language: "en-US",
        author: typeof attributes.artistName === "string" ? attributes.artistName : undefined,
        image: image || undefined,
        items: unique.slice(0, limit),
      });
    } catch (error) {
      return Result.Err(error, error?.code ?? "UPSTREAM_INVALID_RESPONSE");
    }
  }
}

const script = new AppleAppsRSS();
export const route = {
  path: "/apple/apps/update/:country/:id/:platform?",
  name: "Apple App Store 应用更新",
  url: "apps.apple.com",
  maintainers: ["EkkoG", "nczitzk"],
  example: "/apple/apps/update/us/id408709785",
  parameters: {
    country: "App Store 地区代码，例如 us、cn",
    id: "应用 ID，例如 id408709785，也可只填数字",
    platform: "可选：all（默认）、ios、macos、tvos，或接口的平台标识；不支持的平台回退为全部平台",
  },
  description: "订阅应用的各平台版本历史、发布时间和更新说明。支持 ?limit=100，范围 1–1000；地区和应用 ID 可从 App Store 链接获取。",
  handler: ctx => script.run(ctx),
};
