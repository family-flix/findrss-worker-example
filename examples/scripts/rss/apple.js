// 改编自 https://github.com/DIYgod/RSSHub/blob/master/lib/routes/apple/apps.ts
import { utils } from "@findrss/util";

export const version = "1.1.0";
export const platform = {
  name: "Apple",
  icon: '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 302 302" data-n="apple-platform-icon"><path fill="#666" d="M202.56,8.19C198.03,9.32 193.48,9.65 189.06,11.31C175.4,16.44 162.25,28.89 155.31,41.69C150.82,49.98 148.44,58.79 148.44,68.19C148.44,69.48 148.09,71.66 149.06,72.69C150.89,74.63 159.12,73.22 161.56,72.81C179.08,69.89 195.75,50.53 201.69,34.69C203.05,31.04 204.17,27.05 204.81,23.19C205.17,21.07 206.31,10.02 205.06,8.69C204.47,8.06 203.4,8.19 202.56,8.19Z" data-n="apple-icon-leaf"/><path fill="#666" d="M196.56,76.06C190.71,76.79 184.75,77.78 179.06,79.44C174.6,80.74 152.66,88.9 150.56,88.81C147.4,88.68 139.43,85.43 136.06,84.31C129.64,82.17 123.15,79.96 116.56,78.31C98.43,73.78 77.7,78.94 63.56,91.31C48.8,104.23 40.12,121.55 36.19,140.44C34.87,146.75 34.81,153.46 34.81,159.94C34.81,190.49 43.59,221.49 59.81,247.44C68.18,260.83 79.68,278.16 93.81,285.81C97.26,287.68 104.35,290.06 108.31,289.56C111.56,289.16 114.72,288.09 117.81,287.19C120.97,286.27 124.16,285.61 127.31,284.69C135.17,282.4 142.61,279.21 150.81,278.19C153.61,277.84 156.59,278.23 159.31,278.69C165.53,279.72 171.75,281.04 177.81,283.06C187.18,286.19 196.7,289.78 206.81,288.94C210.09,288.66 213.57,286.77 216.31,285.06C233.06,274.59 246.6,253.24 255.31,235.81C256.61,233.21 264.05,216.63 263.19,214.81C262.72,213.83 260.91,213.34 259.94,212.81C254.94,210.11 250.16,206.94 245.94,203.06C231.96,190.25 224.61,170.94 226.19,152.06C227.3,138.72 232.16,126.05 241.31,116.06C244,113.13 247.15,110.56 250.31,108.19C251.46,107.33 255.18,105.61 255.81,104.56C256.06,104.14 255.96,103.49 255.81,103.06C255.12,100.98 250.36,96.23 248.69,94.56C238.21,84.09 224.45,77.42 209.69,76.19C205.37,75.83 200.91,76.06 196.56,76.06Z" data-n="apple-icon-body"/></svg>',
};

const platform_names = { osx: "macOS", ios: "iOS", appletvos: "tvOS" };
const platform_aliases = { macos: "osx", ios: "ios", tvos: "appletvos" };

export class AppleAppsRSS extends RSSScript {
  async fetch(ctx) {
    try {
      const country = String(ctx.params?.country || "").toLowerCase();
      const matched_id = /^(?:id)?([1-9]\d{0,19})$/.exec(
        String(ctx.params?.id || ""),
      );
      const requested_platform = String(
        ctx.params?.platform || "all",
      ).toLowerCase();
      const requested_limit = String(ctx.query?.limit ?? "100");
      if (!/^[a-z]{2}$/.test(country))
        return Result.Err(
          "country 必须是两位 App Store 地区代码，如 us、cn",
          "INVALID_PARAMETER",
        );
      if (!matched_id)
        return Result.Err(
          "id 必须是 App Store 数字 ID，可带 id 前缀",
          "INVALID_PARAMETER",
        );
      if (!/^[a-z][a-z0-9_-]{0,31}$/.test(requested_platform))
        return Result.Err("platform 必须是有效的平台标识", "INVALID_PARAMETER");
      if (
        !/^[1-9]\d{0,3}$/.test(requested_limit) ||
        Number(requested_limit) > 1000
      ) {
        return Result.Err(
          "limit 必须是 1–1000 的整数，默认 100",
          "INVALID_PARAMETER",
        );
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
      const endpoint =
        "https://apps.apple.com/api/apps/v1/catalog/" +
        country +
        "/apps/" +
        app_id +
        "?" +
        Object.entries(query)
          .map(
            ([key, value]) =>
              encodeURIComponent(key) + "=" + encodeURIComponent(value),
          )
          .join("&");
      const fetched = await utils.request_json(ctx, endpoint, {
        headers: {
          Accept: "application/json",
          Authorization: "Bearer",
          Origin: "https://apps.apple.com",
        },
      });
      if (fetched.error) return fetched;
      const attributes = fetched.data?.data?.[0]?.attributes;
      const platforms = attributes?.platformAttributes;
      if (
        typeof attributes?.name !== "string" ||
        !attributes.name.trim() ||
        !platforms ||
        typeof platforms !== "object" ||
        Array.isArray(platforms) ||
        !Object.keys(platforms).length
      ) {
        return Result.Err(
          "Apple 接口缺少应用名称或平台信息，请检查地区和应用 ID",
          "UPSTREAM_INVALID_RESPONSE",
        );
      }
      const platform_id = Object.hasOwn(platform_aliases, requested_platform)
        ? platform_aliases[requested_platform]
        : requested_platform;
      // 与 RSSHub 一致：未指定平台、all 或应用不支持该平台时，合并全部平台。
      const selected_platform =
        requested_platform !== "all" && Object.hasOwn(platforms, platform_id);
      const selected = selected_platform
        ? [[platform_id, platforms[platform_id]]]
        : Object.entries(platforms);
      const items = [];
      let description = "",
        image = "";
      for (const [pid, platform] of selected) {
        const history = utils.array_at(platform, "versionHistory");
        if (history.error) return history;
        if (typeof platform.description?.standard === "string")
          description = platform.description.standard.replace(/\r?\n/g, " ");
        const icon = platform.iconArtwork?.url;
        if (typeof icon === "string" && icon) {
          const resolved = utils.absolute_url(
            icon
              .replace(/\{w\}/g, "400")
              .replace(/\{h\}/g, "400")
              .replace(/\{c\}/g, "bb")
              .replace(/\{f\}/g, "webp"),
          );
          if (resolved.error) return resolved;
          image = resolved.data;
        }
        const platform_name = Object.hasOwn(platform_names, pid)
          ? platform_names[pid]
          : pid;
        for (const entry of history.data) {
          if (
            typeof entry?.versionDisplay !== "string" ||
            !entry.versionDisplay.trim()
          ) {
            return Result.Err(
              "Apple 版本记录缺少版本号",
              "UPSTREAM_INVALID_RESPONSE",
            );
          }
          const published = utils.timestamp(entry.releaseTimestamp);
          if (published.error) return published;
          const content = utils
            .escape_html(entry.releaseNotes)
            .replace(/\r?\n/g, "<br>");
          items.push({
            id:
              "apple/apps/" +
              country +
              "/" +
              id +
              "/" +
              pid +
              "#" +
              entry.versionDisplay,
            title:
              attributes.name +
              " " +
              entry.versionDisplay +
              " for " +
              platform_name,
            link,
            description: content,
            content,
            categories: [platform_name],
            published: published.data,
          });
        }
      }
      if (!image) {
        const page = await utils.request_text(ctx, link, {
          headers: { Accept: "text/html" },
        });
        if (page.error) {
          ctx.log("Apple 应用图标获取失败", { error: page.error });
        } else {
          const parsed = utils.document_nodes(page.data);
          if (parsed.error) return parsed;
          // img 是占位图，真实应用图标在 picture 的 source 中。
          const srcset = utils.attribute(
            parsed.data,
            ".app-icon picture source[srcset]",
            "srcset",
          );
          const resolved = utils.absolute_url(
            srcset.split(",")[0].trim().split(/\s+/)[0],
            link,
          );
          if (resolved.error) return resolved;
          image = resolved.data;
        }
      }
      if (image) {
        if (!ctx.public_origin) {
          return Result.Err(
            "Apple 图片代理需要配置 FINDRSS_HOSTNAME",
            "UPSTREAM_INVALID_RESPONSE",
          );
        }
        image =
          ctx.public_origin + "/img/apple?url=" + encodeURIComponent(image);
      }
      items.sort(
        (left, right) => (right.published || 0) - (left.published || 0),
      );
      const seen = new Set();
      const unique = items.filter((item) => {
        if (seen.has(item.id)) return false;
        seen.add(item.id);
        return true;
      });
      ctx.log("Apple 应用版本记录", {
        country,
        app_id,
        platforms: selected.map(([pid]) => pid),
        count: unique.length,
      });
      return Result.Ok({
        title:
          attributes.name +
          (selected_platform
            ? " for " +
              (Object.hasOwn(platform_names, platform_id)
                ? platform_names[platform_id]
                : platform_id)
            : "") +
          " - Apple App Store",
        link,
        description,
        language: "en-US",
        author:
          typeof attributes.artistName === "string"
            ? attributes.artistName
            : undefined,
        image: image || undefined,
        items: unique.slice(0, limit),
      });
    } catch (error) {
      return Result.Err(error, error?.code ?? "UPSTREAM_INVALID_RESPONSE");
    }
  }
}

const script = new AppleAppsRSS();
const app_route = {
  path: "/apple/apps/update/:country/:id/:platform?",
  name: "Apple App Store 应用更新",
  url: "apps.apple.com",
  maintainers: ["EkkoG", "nczitzk"],
  example: "/apple/apps/update/us/id408709785",
  parameters: {
    country: "App Store 地区代码，例如 us、cn",
    id: "应用 ID，例如 id408709785，也可只填数字",
    platform:
      "可选：all（默认）、ios、macos、tvos，或接口的平台标识；不支持的平台回退为全部平台",
  },
  description:
    "订阅应用的各平台版本历史、发布时间和更新说明。支持 ?limit=100，范围 1–1000；地区和应用 ID 可从 App Store 链接获取。",
  handler: (ctx) => script.run(ctx),
};

export const routes = [
  app_route,
  {
    public: true,
    path: "/img/apple",
    name: "Apple 应用图片代理",
    allowed_hosts: [
      "is1-ssl.mzstatic.com",
      "is2-ssl.mzstatic.com",
      "is3-ssl.mzstatic.com",
      "is4-ssl.mzstatic.com",
      "is5-ssl.mzstatic.com",
    ],
    example:
      "/img/apple?url=https%3A%2F%2Fis1-ssl.mzstatic.com%2Fimage%2Fthumb%2Fexample%2F400x400bb.webp",
    parameters: { url: "Apple 图片 CDN 的完整 HTTPS 地址" },
    handler: (ctx) => ({
      url: ctx.query.url,
      headers: {
        Referer: "https://apps.apple.com/",
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36",
        // 只协商宿主已支持的图片格式，避免 AVIF/JXL/SVG 导致代理拒绝响应。
        Accept:
          "image/webp,image/png,image/jpeg,image/gif,image/x-icon;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
        Priority: "i",
        "sec-ch-ua":
          '"Google Chrome";v="155", "Chromium";v="155", "Not(A:Brand";v="24"',
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": '"macOS"',
        "sec-fetch-dest": "image",
        "sec-fetch-mode": "no-cors",
        "sec-fetch-site": "cross-site",
        "sec-fetch-storage-access": "active",
      },
    }),
  },
];
