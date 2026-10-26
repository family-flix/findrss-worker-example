import { utils } from "@findrss/util";

export const version = "1.1.0";
export const platform = {
  name: "Telegram",
  icon: '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" data-n="telegram-platform-icon"><circle cx="16" cy="16" r="15" fill="#29a9ea" data-n="telegram-icon-circle-1" /><path fill="#fff" d="m7 15.1 17.4-6.6c.9-.3 1.5.3 1.2 1.5l-3 13.5c-.2 1-.8 1.2-1.6.7l-4.6-3.4-2.2 2.1c-.2.2-.4.4-.8.4l.3-4.4 8.3-7.5c.4-.3-.1-.5-.6-.2l-10.3 6.5-4.4-1.4c-1-.3-1-1 .2-1.4Z" data-n="telegram-icon-path-2" /></svg>',
};

export class TelegramChannelRSS extends RSSScript {
  async fetch(ctx) {
    try {
      const username = String(ctx.params?.username || "")
        .replace(/^@/, "")
        .toLowerCase();
      const before = String(ctx.query?.before || "");
      if (!/^[a-z0-9_]{1,32}$/.test(username)) {
        return Result.Err(
          "username 必须为 1–32 位字母、数字或下划线",
          "INVALID_PARAMETER",
        );
      }
      if (before && !/^[1-9]\d{0,19}$/.test(before)) {
        return Result.Err("before 必须为正整数消息 ID", "INVALID_PARAMETER");
      }
      const link = "https://t.me/s/" + username;
      const result_1 = await TelegramChannelRSS.request_text(
        ctx,
        link + (before ? "?before=" + before : ""),
        {
          headers: {
            Accept:
              "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "User-Agent":
              "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36",
          },
        },
      );
      if (result_1.error) return result_1;
      const html = result_1.data;
      if (!TelegramChannelRSS.divs(html, "tgme_channel_info").length) {
        return Result.Err(
          "Telegram 页面没有公开频道预览，请确认频道存在且允许 Web 预览",
          "UPSTREAM_INVALID_RESPONSE",
        );
      }
      const meta = {};
      for (const tag of html.matchAll(/<meta\b[^>]*>/gi)) {
        const attrs = TelegramChannelRSS.attributes(tag[0]);
        if (attrs.property?.startsWith("og:")) {
          meta[attrs.property] = attrs.content;
        }
      }
      const name = meta["og:title"] || username;
      const seen = new Set();
      const items = [];
      for (const message of TelegramChannelRSS.divs(
        html,
        "tgme_widget_message",
      )) {
        const post = String(message.attrs["data-post"] || "");
        const parts = post.split("/");
        if (
          parts.length !== 2 ||
          parts[0].toLowerCase() !== username ||
          !/^\d+$/.test(parts[1]) ||
          seen.has(parts[1])
        ) {
          continue;
        }
        seen.add(parts[1]);
        const content = TelegramChannelRSS.divs(
          message.html,
          "tgme_widget_message_text",
        )
          .map(function (part) {
            return TelegramChannelRSS.message_html(part.html);
          })
          .join("<br>");
        const description = utils
          .decode_html(content.replace(/<br>/g, "\n").replace(/<[^>]*>/g, ""))
          .trim();
        const images = [];
        let poster = "";
        let video = "";
        let published;
        for (const tag of message.html.matchAll(
          /<(a|i|video|source|time)\b[^>]*>/gi,
        )) {
          const attrs = TelegramChannelRSS.attributes(tag[0]);
          const background = TelegramChannelRSS.public_url(
            attrs.style?.match(
              /background-image\s*:\s*url\(\s*['"]?([^'")]+)['"]?\s*\)/i,
            )?.[1],
          );
          if (
            TelegramChannelRSS.has_class(
              attrs,
              "tgme_widget_message_photo_wrap",
            ) &&
            background
          ) {
            images.push(background);
          }
          if (
            TelegramChannelRSS.has_class(
              attrs,
              "tgme_widget_message_video_thumb",
            ) &&
            background
          ) {
            poster = background;
          }
          if (/^(video|source)$/i.test(tag[1]) && !video) {
            video = TelegramChannelRSS.public_url(attrs.src);
            poster = TelegramChannelRSS.public_url(attrs.poster) || poster;
          }
          if (tag[1].toLowerCase() === "time" && attrs.datetime) {
            published = attrs.datetime;
          }
        }
        if (!description && !images.length && !video) {
          continue;
        }
        items.push({
          id: "telegram:" + username + ":" + parts[1],
          link: "https://t.me/" + username + "/" + parts[1],
          title:
            Array.from(description).slice(0, 100).join("") ||
            (video ? "视频" : "图片") + " · " + parts[1],
          description,
          content,
          published,
          author: {
            name,
            uri: "https://t.me/" + username,
          },
          image: images[0] || poster || undefined,
          images: [...new Set(images)],
          ...(video
            ? {
                enclosure: {
                  url: video,
                  type: "video/mp4",
                },
              }
            : {}),
        });
      }
      items.reverse();
      return Result.Ok({
        id: "telegram:channel:" + username,
        title: name,
        link,
        description: meta["og:description"] || "",
        language: "",
        author: {
          name,
          uri: "https://t.me/" + username,
        },
        image:
          TelegramChannelRSS.public_url(meta["og:image"]) ||
          (ctx.public_origin || "") + "/findrss-logo.png",
        updated: items[0]?.published || null,
        items,
        extra: {
          view: "timeline",
          show_thumbnails: true,
          proxy_images: true,
          tags: ["Telegram"],
        },
      });
    } catch (error) {
      return Result.Err(error, error?.code ?? "UPSTREAM_INVALID_RESPONSE");
    }
  }
  static attributes(tag) {
    const result = {};
    for (const match of tag.matchAll(
      /([^\s=<>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g,
    )) {
      result[match[1].toLowerCase()] = utils.decode_html(
        match[2] ?? match[3] ?? match[4],
      );
    }
    return result;
  }
  static has_class(attrs, name) {
    return String(attrs.class || "")
      .split(/\s+/)
      .includes(name);
  }
  static public_url(value) {
    let url = String(value || "").replace(/^\/\//, "https://");
    if (url.startsWith("/")) {
      url = "https://t.me" + url;
    }
    return /^https?:\/\//i.test(url) ? url : "";
  }
  static divs(html, class_name) {
    const stack = [];
    const result = [];
    for (const tag of html.matchAll(/<!--[^]*?-->|<\/?div\b[^>]*>/gi)) {
      if (tag[0].startsWith("<!--")) {
        continue;
      }
      if (/^<\/div/i.test(tag[0])) {
        const open = stack.pop();
        if (open?.matches) {
          result.push({
            attrs: open.attrs,
            html: html.slice(open.start, tag.index),
          });
        }
      } else {
        const attrs = TelegramChannelRSS.attributes(tag[0]);
        stack.push({
          attrs,
          matches: TelegramChannelRSS.has_class(attrs, class_name),
          start: tag.index + tag[0].length,
        });
      }
    }
    return result;
  }
  static message_html(html) {
    const safe = html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "");
    return (safe.match(/<!--[^]*?-->|<[^>]*>|[^<]+|</g) || [])
      .map(function (token) {
        if (!token.startsWith("<")) {
          return utils.escape_html(utils.decode_html(token));
        }
        const tag = token.match(/^<(\/)?([a-z0-9]+)\b/i);
        if (!tag) {
          return "";
        }
        const name = tag[2].toLowerCase();
        if (
          ["b", "strong", "i", "em", "u", "s", "del", "code", "pre"].includes(
            name,
          )
        ) {
          return "<" + (tag[1] || "") + name + ">";
        }
        if (name === "br") {
          return "<br>";
        }
        if (name === "a") {
          if (tag[1]) {
            return "</a>";
          }
          const href = TelegramChannelRSS.public_url(
            TelegramChannelRSS.attributes(token).href,
          );
          return href ? '<a href="' + utils.escape_html(href) + '">' : "<a>";
        }
        return "";
      })
      .join("");
  }
  static async request_text(ctx, url, options = {}) {
    return utils.request_text(ctx, url, options);
  }
}
const script = new TelegramChannelRSS();
export const route = {
  name: "Telegram 公开频道",
  path: "/telegram/channel/:username",
  url: "t.me",
  maintainers: ["findrss"],
  example: "/telegram/channel/telegram",
  parameters: {
    username: "公开频道用户名，@ 可省略",
    before: "历史页消息 ID，默认读取最新一页",
  },
  description:
    "读取公开频道 Web 预览，保留文本、照片、视频与发布时间；不需要 Bot Token。",
  handler: (ctx) => script.run(ctx),
};
