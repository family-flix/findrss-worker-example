import { utils } from "@findrss/util";

export const version = "1.1.0";
export const config_schema = {
  type: "object",
  additionalProperties: false,
  properties: {
    PlayerHostname: {
      type: "string",
      title: "视频播放地址",
      description:
        "完整播放页地址，例如 https://player.example.com/video.html；留空使用 /video.html",
      default: "/video.html",
    },
  },
};
export const platform = {
  name: "视频号",
  icon: '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 512 512" data-n="wxchannels-platform-icon"><path fill="none" stroke="#fa9d3b" stroke-linecap="round" stroke-linejoin="round" stroke-width="42" d="M256 256C214 214 174 112 122 112c-46 0-70 54-44 139 28 140 82 260 142 33l36-76M256 256c42-42 82-144 134-144 46 0 70 54 44 139-28 140-82 260-142 33l-36-76" data-n="wxchannels-icon-path-1" /></svg>',
};

export class WechatChannelsRSS extends RSSScript {
  static PLAY_ENDPOINT = "/video.html";
  static DEFAULT_CHANNEL_LINK = "https://channels.weixin.qq.com/";
  static VIDEO_MEDIA_TYPE = 4;
  static LIVE_MEDIA_TYPE = 9;
  static feed_media(item) {
    const media = item?.object_desc?.media;
    return Array.isArray(media) && media.length > 0 ? media[0] : null;
  }
  static feed_caption(item) {
    return String(item?.object_desc?.description ?? "");
  }
  static item_is_video(item) {
    const media = WechatChannelsRSS.feed_media(item);
    const media_type = Number(
      item?.object_desc?.media_type ?? media?.media_type,
    );
    return Number.isFinite(media_type)
      ? [
          WechatChannelsRSS.VIDEO_MEDIA_TYPE,
          WechatChannelsRSS.LIVE_MEDIA_TYPE,
        ].includes(media_type)
      : true;
  }
  static media_cover_url(item) {
    const media = WechatChannelsRSS.feed_media(item);
    return String(
      media?.cover_url ||
        media?.thumb_url ||
        media?.full_cover_url ||
        media?.url ||
        "",
    );
  }
  static media_signed_url(media) {
    const url = String(media?.url || "");
    return url ? url + String(media?.url_token ?? media?.token ?? "") : "";
  }
  static media_play_url(
    media,
    cover,
    play_endpoint = WechatChannelsRSS.PLAY_ENDPOINT,
  ) {
    const media_url = String(media?.url || "");
    if (media_url === "") {
      return "";
    }
    const video_url = WechatChannelsRSS.media_signed_url(media);
    const decode_key = String(media?.decode_key ?? "");
    return (
      `${play_endpoint}?url=${encodeURIComponent(video_url)}&key=${encodeURIComponent(decode_key)}` +
      `&poster=${encodeURIComponent(cover)}`
    );
  }
  static item_source_url(item) {
    const id = String(item?.id ?? "");
    return id === ""
      ? ""
      : `https://channels.weixin.qq.com/web/pages/feed?eid=${encodeURIComponent(id)}`;
  }
  static html_attribute_escape(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll('"', "&quot;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  }
  static play_frame_html(play_url, title) {
    return (
      `<iframe data-n="wxchannels-player" src="${WechatChannelsRSS.html_attribute_escape(play_url)}" title="${WechatChannelsRSS.html_attribute_escape(title)}" ` +
      `allow="autoplay; fullscreen; encrypted-media; picture-in-picture" frameborder="0" allowfullscreen></iframe>`
    );
  }
  static build_channel(
    data,
    username,
    public_origin = "",
    play_endpoint = WechatChannelsRSS.PLAY_ENDPOINT,
  ) {
    const contact =
      data.contact && typeof data.contact === "object" ? data.contact : {};
    const objects = Array.isArray(data.object) ? data.object : [];
    const channel_title = String(
      contact.nickname || contact.username || username,
    );
    const avatar_url = String(contact.head_url || "");
    const items = objects.map(function (item, index) {
      const caption = WechatChannelsRSS.feed_caption(item);
      const title = caption || "未命名视频";
      const is_video = WechatChannelsRSS.item_is_video(item);
      const is_live =
        Number(
          item?.object_desc?.media_type ??
            WechatChannelsRSS.feed_media(item)?.media_type,
        ) === WechatChannelsRSS.LIVE_MEDIA_TYPE;
      const media = is_live
        ? {
            url: String(item?.live_info?.stream_url || ""),
          }
        : WechatChannelsRSS.feed_media(item);
      const cover_url = WechatChannelsRSS.media_cover_url(item);
      const play_url = is_video
        ? WechatChannelsRSS.media_play_url(media, cover_url, play_endpoint)
        : "";
      const decode_key = is_video ? String(media?.decode_key ?? "") : "";
      const gallery =
        !is_video && Array.isArray(item?.object_desc?.media)
          ? item.object_desc.media.filter(function (value) {
              return value && Number(value.media_type ?? 2) === 2 && value.url;
            })
          : [];
      const source_url = WechatChannelsRSS.item_source_url(item);
      const guid = String(item?.id ?? "");
      const publish_time = Number(item?.createtime);
      return {
        id: guid,
        type: is_live ? "live" : is_video ? "video" : "gallery",
        // 视频号没有单独的标题，用文案当标题；空文案才回退到默认值。
        title,
        link: source_url,
        description: caption,
        // 秒 / 毫秒都直接透传，渲染端统一格式化；非法值省略 published。
        published:
          Number.isFinite(publish_time) && publish_time > 0
            ? publish_time
            : undefined,
        image: cover_url || undefined,
        ...(gallery.length
          ? {
              images: gallery.map(WechatChannelsRSS.media_signed_url),
              live_photos: gallery
                .filter(function (value) {
                  return value.livephoto?.url;
                })
                .map(function (value) {
                  return {
                    image: WechatChannelsRSS.media_signed_url(value),
                    video: WechatChannelsRSS.media_signed_url(value.livephoto),
                    key: String(value.livephoto.decode_key ?? ""),
                    width: value.livephoto.width,
                    height: value.livephoto.height,
                  };
                }),
            }
          : {}),
        // content 是结构化视频资源缺失时的回退：阅读端优先用 enclosure 解出的
        // video_url/video_key/video_poster 渲染自己的视频帧，并把正文里的这个 iframe 剥掉。
        content:
          play_url === ""
            ? undefined
            : WechatChannelsRSS.play_frame_html(play_url, title),
        enclosure:
          play_url === ""
            ? undefined
            : {
                url: WechatChannelsRSS.media_signed_url(media),
                type: is_live ? "video/x-flv" : "video/mp4",
                key: decode_key,
              },
      };
    });
    const published_ms = function (item) {
      const time = item.published ?? 0;
      return time < 1_000_000_000_000 ? time * 1000 : time;
    };
    items.sort(function (left, right) {
      return published_ms(right) - published_ms(left);
    });
    const channel_link = WechatChannelsRSS.DEFAULT_CHANNEL_LINK;
    const channel_description = String(
      contact.signature || channel_title + " 的视频号动态",
    );
    return {
      id: "wxchannels:channel:" + username,
      title: channel_title,
      link: channel_link,
      description: channel_description,
      language: "zh-cn",
      author: {
        name: channel_title,
        uri: WechatChannelsRSS.DEFAULT_CHANNEL_LINK,
      },
      image: avatar_url || public_origin + "/findrss-logo.png",
      updated: items[0]?.published || null,
      // 添加订阅时的建议值；阅读端仍允许用户修改，已有订阅不会被轮询覆盖。
      items,
      extra: {
        view: "video",
        show_thumbnails: true,
        proxy_images: true,
        headers: {
          referer: WechatChannelsRSS.DEFAULT_CHANNEL_LINK,
        },
        tags: ["视频号"],
        category: ["视频号"],
      },
    };
  }
  async fetch(ctx) {
    try {
      const path_account =
        typeof ctx.params?.account === "string"
          ? ctx.params.account.trim()
          : "";
      const query_username =
        typeof ctx.query.username === "string" ? ctx.query.username.trim() : "";
      const requested_username = path_account || query_username;
      const offset =
        typeof ctx.query.offset === "string" ? ctx.query.offset.trim() : "";
      if (requested_username === "") {
        return Result.Err("缺少 query 参数 username", "INVALID_PARAMETER");
      }
      const username = requested_username.endsWith("@finder")
        ? requested_username
        : requested_username + "@finder";
      const result_1 = await ctx.invoke("wxchannels.contact.feed.list", {
        username,
        offset,
      });
      if (result_1.error) return result_1;
      const data = result_1.data;
      if (data === null || typeof data !== "object" || Array.isArray(data)) {
        return Result.Err(
          "设备返回了无效的视频号数据",
          "UPSTREAM_INVALID_RESPONSE",
        );
      }
      if (
        data.BaseResponse?.Ret !== undefined &&
        Number(data.BaseResponse.Ret) !== 0
      )
        return Result.Err(
          "视频号设备接口拒绝请求",
          "UPSTREAM_INVALID_RESPONSE",
        );
      if (!Array.isArray(data.object))
        return Result.Err(
          "视频号回包缺少 object 列表",
          "UPSTREAM_INVALID_RESPONSE",
        );
      for (const item of data.object) {
        const id = utils.identity(item?.id);
        if (id.error) return id;
      }
      return Result.Ok(
        WechatChannelsRSS.build_channel(
          data,
          username,
          ctx.public_origin,
          ctx.config?.PlayerHostname?.trim() || WechatChannelsRSS.PLAY_ENDPOINT,
        ),
      );
    } catch (error) {
      return Result.Err(error, error?.code ?? "UPSTREAM_INVALID_RESPONSE");
    }
  }
}
const script = new WechatChannelsRSS();
export const route = {
  path: "/wxchannels/:account",
  name: "微信视频号",
  url: "mp.weixin.qq.com",
  maintainers: ["findrss"],
  example:
    "/wxchannels/v2_060000231003b20faec8c5e1811ac5d4c803ee35b077b115ba7f22bad44fca23255c1a271f23@finder",
  parameters: {
    account: "视频号 username",
    offset: "分页游标，默认为空",
  },
  description:
    "获取视频号指定作者的视频、图集、Live Photo 与直播列表；视频条目的 enclosure 是 url + token 原始视频地址，并把解密密钥单列在 enclosure.key；content 是播放页 iframe（结构化视频资源缺失时的回退）",
  handler: (ctx) => script.run(ctx),
};
