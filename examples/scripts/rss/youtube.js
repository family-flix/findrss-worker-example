import { utils } from "@findrss/util";

export const version = "1.1.0";
export const platform = {
  name: "YouTube",
  icon: '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" data-n="youtube-platform-icon"><rect width="32" height="22" y="5" rx="5" fill="#ff0033" data-n="youtube-icon-rect-1" /><path fill="#fff" d="m13 12 8 4-8 5z" data-n="youtube-icon-path-2" /></svg>',
};

export const permissions = {
  cookies: [
    {
      id: "account_0",
      origin: "https://www.youtube.com",
      path_prefix: "/",
      names: [
        "PREF",
        "LOGIN_INFO",
        "SID",
        "__Secure-1PSID",
        "__Secure-3PSID",
        "HSID",
        "SSID",
        "APISID",
        "SAPISID",
        "__Secure-1PAPISID",
        "__Secure-3PAPISID",
        "__Secure-BUCKET",
        "__Secure-1PSIDTS",
        "__Secure-3PSIDTS",
        "SIDCC",
        "__Secure-1PSIDCC",
        "__Secure-3PSIDCC",
      ],
      purpose: "读取用户授权的 YouTube 频道视频页面",
    },
  ],
};

export class YoutubeRSS extends RSSScript {
  constructor(kind = "videos") {
    super();
    this.kind = kind;
  }
  async fetch(ctx) {
    try {
      const shorts = this.kind === "shorts";
      const handle = String(ctx.params?.handle || "").replace(/^@/, "");
      if (!/^[\p{L}\p{N}_.·-]{1,100}$/u.test(handle) || /^\.+$/.test(handle)) {
        return Result.Err(
          "handle 必须为有效的 YouTube 频道标识",
          "INVALID_PARAMETER",
        );
      }
      const channel_link =
        "https://www.youtube.com/@" + encodeURIComponent(handle);
      const link = channel_link + "/" + this.kind;
      const result_1 = await YoutubeRSS.request_text(ctx, link, {
        headers: YoutubeRSS.request_headers(link),
      });
      if (result_1.error) return result_1;
      const result_2 = YoutubeRSS.initial_data(result_1.data);
      if (result_2.error) return result_2;
      const data = result_2.data;
      const channel = data.metadata?.channelMetadataRenderer;
      const browse =
        data.contents?.twoColumnBrowseResultsRenderer ||
        data.contents?.singleColumnBrowseResultsRenderer;
      const tab = browse?.tabs?.find(function (tab) {
        return tab.tabRenderer?.selected;
      })?.tabRenderer;
      if (!channel?.title || !tab?.content) {
        return Result.Err(
          "YouTube 页面缺少频道信息或视频列表，请检查频道地址与上游页面结构",
          "UPSTREAM_INVALID_RESPONSE",
        );
      }
      const author = {
        name: String(channel.title),
        uri: channel_link,
      };
      const items = [];
      const seen = new Set();
      const now = Date.now();
      const walk = function (value) {
        if (!value || typeof value !== "object") {
          return undefined;
        }
        const short = value.shortsLockupViewModel;
        const modern = value.lockupViewModel;
        const legacy =
          value.videoRenderer ||
          value.gridVideoRenderer ||
          value.compactVideoRenderer ||
          value.reelItemRenderer;
        if (short || modern || legacy) {
          if (modern && modern.contentType !== "LOCKUP_CONTENT_TYPE_VIDEO") {
            return undefined;
          }
          const video = short || modern || legacy;
          const id = String(
            short
              ? short.onTap?.innertubeCommand?.reelWatchEndpoint?.videoId || ""
              : modern
                ? video.contentId || ""
                : video.videoId || "",
          );
          if (!/^[A-Za-z0-9_-]{11}$/.test(id) || seen.has(id)) {
            return undefined;
          }
          seen.add(id);
          const metadata = modern?.metadata?.lockupMetadataViewModel;
          const thumbnail = short
            ? short.thumbnailViewModel?.thumbnailViewModel ||
              short.thumbnailViewModel
            : modern?.contentImage?.thumbnailViewModel;
          const metadata_parts = (
            metadata?.metadata?.contentMetadataViewModel?.metadataRows || []
          ).flatMap(function (row) {
            return row.metadataParts || [];
          });
          const details = short
            ? [YoutubeRSS.text_of(short.overlayMetadata?.secondaryText)]
            : modern
              ? metadata_parts.map(function (part) {
                  return (
                    part.accessibilityLabel || YoutubeRSS.text_of(part.text)
                  );
                })
              : [
                  YoutubeRSS.text_of(video.descriptionSnippet),
                  YoutubeRSS.text_of(video.viewCountText),
                  YoutubeRSS.text_of(video.publishedTimeText),
                ];
          const duration = modern
            ? thumbnail?.overlays
                ?.flatMap(function (overlay) {
                  return overlay.thumbnailBottomOverlayViewModel?.badges || [];
                })
                .map(function (badge) {
                  return badge.thumbnailBadgeViewModel?.text || "";
                })
                .filter(Boolean)
                .join(" · ")
            : YoutubeRSS.text_of(video.lengthText);
          const time_labels = modern
            ? metadata_parts.flatMap(function (part) {
                return [YoutubeRSS.text_of(part.text), part.accessibilityLabel];
              })
            : [YoutubeRSS.text_of(video.publishedTimeText)];
          const published = time_labels
            .map(function (label) {
              return YoutubeRSS.relative_timestamp(label, now);
            })
            .find(function (timestamp) {
              return timestamp !== undefined;
            });
          const title =
            YoutubeRSS.text_of(
              short?.overlayMetadata?.primaryText ||
                metadata?.title ||
                video.title ||
                video.headline,
            ) || id;
          const image =
            YoutubeRSS.thumbnail_url(
              thumbnail?.image?.sources || video.thumbnail?.thumbnails,
            ) || "https://i.ytimg.com/vi/" + id + "/hqdefault.jpg";
          const media_url = "https://www.youtube.com/embed/" + id;
          const play_url =
            "/video.html?url=" +
            encodeURIComponent(media_url) +
            "&poster=" +
            encodeURIComponent(image);
          items.push({
            id: "youtube:video:" + id,
            type: "video",
            title,
            link: shorts
              ? "https://www.youtube.com/shorts/" + id
              : "https://www.youtube.com/watch?v=" + id,
            author,
            published,
            description: [...details, duration].filter(Boolean).join(" · "),
            content: YoutubeRSS.play_frame_html(play_url, title),
            image,
            media_group: true,
            enclosure: {
              url: media_url,
              type: "video/x-youtube",
            },
          });
          return undefined;
        }
        for (const child of Object.values(value)) {
          walk(child);
        }
      };
      walk(tab.content);
      if (shorts) {
        // Shorts 列表没有发布日期，从详情页补齐；限制并发以免占满上游连接。
        for (let index = 0; index < items.length; index += 4) {
          await Promise.all(
            items.slice(index, index + 4).map(async function (item) {
              if (item.published !== undefined) return;
              const page = await YoutubeRSS.request_text(ctx, item.link, {
                headers: YoutubeRSS.request_headers(link),
              });
              if (page.error) {
                ctx.log("YouTube Shorts 发布时间获取失败", {
                  link: item.link,
                  error: page.error,
                });
                return;
              }
              const parsed = utils.document_nodes(page.data);
              if (parsed.error) {
                ctx.log("YouTube Shorts 发布时间解析失败", {
                  link: item.link,
                  error: parsed.error,
                });
                return;
              }
              for (const property of ["datePublished", "uploadDate"]) {
                const published = Date.parse(
                  utils.attribute(
                    parsed.data,
                    'meta[itemprop="' + property + '"]',
                    "content",
                  ),
                );
                if (Number.isFinite(published) && published > 0) {
                  item.published = published;
                  break;
                }
              }
            }),
          );
        }
      }
      items.sort(function (left, right) {
        return (right.published ?? -Infinity) - (left.published ?? -Infinity);
      });
      return Result.Ok({
        id:
          "youtube:channel:" +
          (channel.externalId || handle) +
          (shorts ? ":shorts" : ""),
        title:
          author.name + (shorts ? " 的 YouTube Shorts" : " 的 YouTube 视频"),
        link,
        description: String(channel.description || ""),
        language: "",
        author,
        image:
          YoutubeRSS.thumbnail_url(channel.avatar?.thumbnails) ||
          (ctx.public_origin || "") + "/findrss-logo.png",
        updated: items[0]?.published || null,
        items,
        extra: {
          view: "video",
          show_thumbnails: true,
          proxy_images: true,
          tags: ["YouTube"],
        },
      });
    } catch (error) {
      return Result.Err(error, error?.code ?? "UPSTREAM_INVALID_RESPONSE");
    }
  }
  static text_of(value) {
    return String(
      value?.simpleText ??
        value?.content ??
        value?.runs
          ?.map(function (run) {
            return run.text || "";
          })
          .join("") ??
        "",
    );
  }
  static relative_timestamp(value, now) {
    const text = String(value || "")
      .trim()
      .toLowerCase();
    const english =
      /(?:^|\s)(\d+)\s+(seconds?|minutes?|hours?|days?|weeks?|months?|years?)\s+ago\b/.exec(
        text,
      );
    const chinese =
      /(?:^|[^\d.\-])(\d+)\s*(秒(?:钟|鐘)?|分(?:钟|鐘)|小[时時]|天|[周週]|[个個]?月|年)\s*前/.exec(
        text,
      );
    const match = english || chinese;
    // YouTube 只给相对时间时按抓取时刻估算；月、年分别按 30、365 天计算。
    const units = {
      second: 1,
      minute: 60,
      hour: 3600,
      day: 86400,
      week: 604800,
      month: 2592000,
      year: 31536000,
      秒: 1,
      秒钟: 1,
      秒鐘: 1,
      分钟: 60,
      分鐘: 60,
      小时: 3600,
      小時: 3600,
      天: 86400,
      周: 604800,
      週: 604800,
      月: 2592000,
      个月: 2592000,
      個月: 2592000,
      年: 31536000,
    };
    let seconds;
    if (match) {
      seconds = Number(match[1]) * units[match[2].replace(/s$/, "")];
    } else if (/^(?:just now|刚刚|剛剛)$/.test(text)) {
      seconds = 0;
    } else {
      return undefined;
    }
    const timestamp = now - seconds * 1000;
    return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : undefined;
  }
  static thumbnail_url(sources) {
    const image = (sources || []).reduce(function (best, image) {
      return Number(image.width || 0) >= Number(best.width || 0) ? image : best;
    }, {});
    const url = String(image.url || "").replace(/^\/\//, "https://");
    return /^https?:\/\//.test(url) ? url : "";
  }
  static initial_data(html) {
    try {
      for (const script of String(html).matchAll(
        /<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi,
      )) {
        const source = script[1];
        const match =
          /(?:\bytInitialData|window\s*\[\s*["']ytInitialData["']\s*\])\s*=\s*(\{|["'])/.exec(
            source,
          );
        if (!match) {
          continue;
        }
        const start = match.index + match[0].length - 1;
        if (source[start] !== "{") {
          const literal =
            /^(?:"(?:[^"\\]|\\[\s\S])*"|'(?:[^'\\]|\\[\s\S])*')/.exec(
              source.slice(start),
            )?.[0];
          if (!literal)
            return Result.Err(
              "YouTube ytInitialData 不完整",
              "UPSTREAM_INVALID_RESPONSE",
            );
          try {
            // 移动站将 JSON 放在 JS 字符串中；只解码字面量，不能执行页面脚本。
            const json = literal
              .slice(1, -1)
              .replace(
                /\\(?:x([\da-f]{2})|u([\da-f]{4})|([\s\S]))/gi,
                function (_, hex, unicode, char) {
                  if (hex || unicode)
                    return String.fromCharCode(parseInt(hex || unicode, 16));
                  if (char === "x" || char === "u")
                    throw new Error("无效的字符串转义");
                  return (
                    {
                      b: "\b",
                      f: "\f",
                      n: "\n",
                      r: "\r",
                      t: "\t",
                      v: "\v",
                      0: "\0",
                    }[char] ?? char
                  );
                },
              );
            const parsed = parseJSON(json);
            if (parsed.error) throw parsed.error;
            if (
              !parsed.data ||
              typeof parsed.data !== "object" ||
              Array.isArray(parsed.data)
            )
              throw new Error("无效的初始数据");
            return parsed;
          } catch {
            return Result.Err(
              "YouTube ytInitialData 不是有效 JSON",
              "UPSTREAM_INVALID_RESPONSE",
            );
          }
        }
        let depth = 0;
        let quoted = false;
        let escaped = false;
        for (let index = start; index < source.length; index++) {
          const char = source[index];
          if (quoted) {
            if (escaped) {
              escaped = false;
            } else {
              if (char === "\\") {
                escaped = true;
              } else {
                if (char === '"') {
                  quoted = false;
                }
              }
            }
          } else {
            if (char === '"') {
              quoted = true;
            } else {
              if (char === "{") {
                depth++;
              } else {
                if (char === "}" && --depth === 0) {
                  try {
                    const result_3 = parseJSON(source.slice(start, index + 1));
                    if (result_3.error) throw result_3.error;
                    return Result.Ok(result_3.data);
                  } catch {
                    return Result.Err(
                      "YouTube ytInitialData 不是有效 JSON",
                      "UPSTREAM_INVALID_RESPONSE",
                    );
                  }
                }
              }
            }
          }
        }
        return Result.Err(
          "YouTube ytInitialData 不完整",
          "UPSTREAM_INVALID_RESPONSE",
        );
      }
      return Result.Err(
        "YouTube HTML 缺少 ytInitialData，请检查频道地址、登录或验证页面",
        "UPSTREAM_INVALID_RESPONSE",
      );
    } catch (error) {
      return Result.Err(error, error?.code ?? "UPSTREAM_INVALID_RESPONSE");
    }
  }
  static request_headers(link) {
    return {
      Referer: link,
      "Upgrade-Insecure-Requests": "1",
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      "sec-ch-ua":
        '"Google Chrome";v="153", "Not_A Brand";v="8", "Chromium";v="153"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"macOS"',
      "sec-fetch-dest": "document",
      "sec-fetch-mode": "navigate",
      "sec-fetch-site": "same-origin",
      "sec-fetch-user": "?1",
    };
  }
  static html_attribute_escape(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll('"', "&quot;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  }
  static play_frame_html(play_url, title) {
    return (
      `<iframe data-n="youtube-player" src="${YoutubeRSS.html_attribute_escape(play_url)}" title="${YoutubeRSS.html_attribute_escape(title)}" ` +
      `allow="autoplay; fullscreen; encrypted-media; picture-in-picture" frameborder="0" allowfullscreen></iframe>`
    );
  }
  static async request_text(ctx, url, options = {}) {
    const acquired = await ctx.cookies.get("account_0");
    if (acquired.error) return acquired;
    return utils.request_text(ctx, url, { ...options, cookies: acquired.data });
  }
}
export const routes = ["videos", "shorts"].map(function (kind) {
  const shorts = kind === "shorts";
  const script = new YoutubeRSS(kind);
  const suffix = shorts ? "/shorts" : "";
  return {
    path: "/youtube/:handle" + suffix,
    name: shorts ? "YouTube 频道 Shorts" : "YouTube 频道视频",
    url: "www.youtube.com",
    maintainers: ["findrss"],
    example: shorts ? "/youtube/@Brookemonk/shorts" : "/youtube/@goldfishbrain",
    parameters: {
      handle: "频道 handle，例如 @goldfishbrain（@ 可省略）",
    },
    description: shorts
      ? "解析频道 /shorts 页面内嵌的短视频首屏列表，包含标题、封面、观看量及内嵌播放器；发布时间缺失时从短视频详情页补齐，补查失败时保留条目，不估算日期。"
      : "解析频道 /videos 页面内嵌的视频首屏列表，包含标题、封面、作者、YouTube 播放地址及 content 内嵌播放器。发布时间根据页面中英文相对时间估算，月、年按 30、365 天计算。",
    handler: (ctx) => script.run(ctx),
  };
});
