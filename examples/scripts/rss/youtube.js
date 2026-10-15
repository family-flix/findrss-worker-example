/** RSS */
export const platform = {"name": "YouTube", "icon": "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"32\" height=\"32\" viewBox=\"0 0 32 32\" data-n=\"youtube-platform-icon\"><rect width=\"32\" height=\"22\" y=\"5\" rx=\"5\" fill=\"#ff0033\" data-n=\"youtube-icon-rect-1\" /><path fill=\"#fff\" d=\"m13 12 8 4-8 5z\" data-n=\"youtube-icon-path-2\" /></svg>"};
import { utils } from '@findrss/util';
export class YoutubeRSS extends RSSScript {
  async fetch(ctx) {
    try {
      const handle = String((ctx.params?.handle || "")).replace(/^@/, "");
      if ((!/^[\p{L}\p{N}_.·-]{1,100}$/u.test(handle) || /^\.+$/.test(handle))) {
        return Result.Err("handle 必须为有效的 YouTube 频道标识", "INVALID_PARAMETER");
      }
      const channel_link = "https://www.youtube.com/@" + encodeURIComponent(handle);
      const link = channel_link + "/videos";
      const result_1 = await YoutubeRSS.request_text(ctx, link, {
        headers: YoutubeRSS.request_headers(link)
      });
      if (result_1.error) return result_1;
      const result_2 = YoutubeRSS.initial_data(result_1.data);
      if (result_2.error) return result_2;
      const data = result_2.data;
      const channel = data.metadata?.channelMetadataRenderer;
      const tab = data.contents?.twoColumnBrowseResultsRenderer?.tabs?.find(function(tab) {
        return tab.tabRenderer?.selected;
      })?.tabRenderer;
      if ((!channel?.title || !tab?.content)) {
        return Result.Err("YouTube 页面缺少频道信息或视频列表，请检查频道地址与上游页面结构", 'UPSTREAM_INVALID_RESPONSE');
      }
      const author = {
        name: String(channel.title),
        uri: channel_link
      };
      const items = [];
      const seen = new Set();
      const now = Date.now();
      const walk = function(value) {
        if ((!value || typeof value !== "object")) {
          return undefined;
        }
        const modern = value.lockupViewModel;
        const legacy = (value.videoRenderer || value.gridVideoRenderer);
        if ((modern || legacy)) {
          if ((modern && modern.contentType !== "LOCKUP_CONTENT_TYPE_VIDEO")) {
            return undefined;
          }
          const video = (modern || legacy);
          const id = String((modern ? (video.contentId || "") : (video.videoId || "")));
          if ((!/^[A-Za-z0-9_-]{11}$/.test(id) || seen.has(id))) {
            return undefined;
          }
          seen.add(id);
          const metadata = modern?.metadata?.lockupMetadataViewModel;
          const thumbnail = modern?.contentImage?.thumbnailViewModel;
          const metadata_parts = (metadata?.metadata?.contentMetadataViewModel?.metadataRows || []).flatMap(function(row) {
            return row.metadataParts || [];
          });
          const details = (modern ? metadata_parts.map(function(part) {
            return part.accessibilityLabel || YoutubeRSS.text_of(part.text);
          }) : [
            YoutubeRSS.text_of(video.descriptionSnippet),
            YoutubeRSS.text_of(video.viewCountText),
            YoutubeRSS.text_of(video.publishedTimeText),
          ]);
          const duration = (modern ? thumbnail?.overlays?.flatMap(function(overlay) {
            return (overlay.thumbnailBottomOverlayViewModel?.badges || []);
          }).map(function(badge) {
            return (badge.thumbnailBadgeViewModel?.text || "");
          }).filter(Boolean).join(" · ") : YoutubeRSS.text_of(video.lengthText));
          const time_labels = modern ? metadata_parts.flatMap(function(part) {
            return [YoutubeRSS.text_of(part.text), part.accessibilityLabel];
          }) : [YoutubeRSS.text_of(video.publishedTimeText)];
          const published = time_labels.map(function(label) {
            return YoutubeRSS.relative_timestamp(label, now);
          }).find(function(timestamp) {
            return timestamp !== undefined;
          });
          const title = (YoutubeRSS.text_of((metadata?.title || video.title)) || id);
          const image = (YoutubeRSS.thumbnail_url((thumbnail?.image?.sources || video.thumbnail?.thumbnails)) || "https://i.ytimg.com/vi/" + id + "/hqdefault.jpg");
          const media_url = "https://www.youtube.com/embed/" + id;
          const play_url = "/video.html?url=" + encodeURIComponent(media_url) + "&poster=" + encodeURIComponent(image);
          items.push({
            id: "youtube:video:" + id,
            type: "video",
            title,
            link: "https://www.youtube.com/watch?v=" + id,
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
      items.sort(function(left, right) {
        return ((right.published ?? -Infinity)) - ((left.published ?? -Infinity));
      });
      return Result.Ok({
        id: "youtube:channel:" + ((channel.externalId || handle)),
        title: author.name + " 的 YouTube 视频",
        link,
        description: String((channel.description || "")),
        language: "",
        author,
        image: (YoutubeRSS.thumbnail_url(channel.avatar?.thumbnails) || ((ctx.public_origin || "")) + "/findrss-logo.png"),
        updated: (items[0]?.published || null),
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
    return String((((value?.simpleText ?? value?.content) ?? value?.runs?.map(function(run) {
      return (run.text || "");
    }).join("")) ?? ""));
  }
  static relative_timestamp(value, now) {
    const text = String(value || "").trim().toLowerCase();
    const english = /(?:^|\s)(\d+)\s+(seconds?|minutes?|hours?|days?|weeks?|months?|years?)\s+ago\b/.exec(text);
    const chinese = /(?:^|[^\d.\-])(\d+)\s*(秒(?:钟|鐘)?|分(?:钟|鐘)|小[时時]|天|[周週]|[个個]?月|年)\s*前/.exec(text);
    const match = english || chinese;
    // YouTube 只给相对时间时按抓取时刻估算；月、年分别按 30、365 天计算。
    const units = {
      second: 1, minute: 60, hour: 3600, day: 86400, week: 604800, month: 2592000, year: 31536000,
      秒: 1, 秒钟: 1, 秒鐘: 1, 分钟: 60, 分鐘: 60, 小时: 3600, 小時: 3600,
      天: 86400, 周: 604800, 週: 604800, 月: 2592000, 个月: 2592000, 個月: 2592000, 年: 31536000,
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
    const image = ((sources || [])).reduce(function(best, image) {
      return (Number((image.width || 0)) >= Number((best.width || 0)) ? image : best);
    }, {});
    const url = String((image.url || "")).replace(/^\/\//, "https://");
    return (/^https?:\/\//.test(url) ? url : "");
  }
  static initial_data(html) {
    try {
      for (const script of String(html).matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)) {
        const source = script[1];
        const match = /(?:\bytInitialData|window\s*\[\s*["']ytInitialData["']\s*\])\s*=\s*(\{)/.exec(source);
        if (!match) {
          continue;
        }
        const start = match.index + match[0].length - 1;
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
                if ((char === "}" && --depth === 0)) {
                  try {
                    const result_3 = parseJSON(source.slice(start, index + 1));
                    if (result_3.error) throw result_3.error;
                    return Result.Ok(result_3.data);
                  } catch {
                    return Result.Err("YouTube ytInitialData 不是有效 JSON", 'UPSTREAM_INVALID_RESPONSE');
                  }
                }
              }
            }
          }
        }
        return Result.Err("YouTube ytInitialData 不完整", 'UPSTREAM_INVALID_RESPONSE');
      }
      return Result.Err("YouTube HTML 缺少 ytInitialData，请检查频道地址、登录或验证页面", 'UPSTREAM_INVALID_RESPONSE');
    } catch (error) {
      return Result.Err(error, error?.code ?? "UPSTREAM_INVALID_RESPONSE");
    }
  }
  static request_headers(link) {
    return {
      Referer: link,
      "Upgrade-Insecure-Requests": "1",
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      "sec-ch-ua": '"Google Chrome";v="153", "Not_A Brand";v="8", "Chromium";v="153"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"macOS"',
      "sec-fetch-dest": "document",
      "sec-fetch-mode": "navigate",
      "sec-fetch-site": "same-origin",
      "sec-fetch-user": "?1",
    };
  }
  static html_attribute_escape(value) {
    return String(value).replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  }
  static play_frame_html(play_url, title) {
    return `<iframe data-n="youtube-player" src="${YoutubeRSS.html_attribute_escape(play_url)}" title="${YoutubeRSS.html_attribute_escape(title)}" ` + `allow="autoplay; fullscreen; encrypted-media; picture-in-picture" frameborder="0" allowfullscreen></iframe>`;
  }
  static async request_text(ctx, url, options = {}) {
    return utils.request_text(ctx, url, options);
  }
}
const script = new YoutubeRSS();
export const route = {
  "path": "/youtube/:handle",
  "name": "YouTube 频道视频",
  "url": "www.youtube.com",
  "maintainers": ["findrss"],
  "example": "/youtube/@goldfishbrain",
  "parameters": {
    "handle": "频道 handle，例如 @goldfishbrain（@ 可省略）"
  },
  "description": "解析频道 /videos 页面内嵌的视频首屏列表，包含标题、封面、作者、YouTube 播放地址及 content 内嵌播放器。发布时间根据页面中英文相对时间估算，月、年按 30、365 天计算。",
  handler: ctx => script.run(ctx),
};
