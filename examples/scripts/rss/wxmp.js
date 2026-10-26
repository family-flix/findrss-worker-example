import { utils } from "@findrss/util";

export const version = "1.1.0";
export const platform = {
  name: "公众号",
  icon: '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" data-n="wxmp-platform-icon"><path fill="#1aad19" d="M16 2C7.7 2 1 7.8 1 15.5S7.7 29 16 29s15-5.8 15-13.5S24.3 2 16 2ZM6 24l-1 7 7-5C9.4 25.5 7.3 24.8 6 24Z" data-n="wxmp-icon-path-1" /><ellipse cx="9" cy="11.5" rx="1.5" ry="2" fill="#fff" data-n="wxmp-icon-ellipse-2" /><ellipse cx="23" cy="11.5" rx="1.5" ry="2" fill="#fff" data-n="wxmp-icon-ellipse-3" /></svg>',
};

export class WechatOfficialRSS extends RSSScript {
  static account_id_pattern = /^[A-Za-z0-9_-]+$/;
  static proxy_img(ctx) {
    return {
      url: ctx.query.url,
      headers: {
        Referer: "https://mp.weixin.qq.com/",
      },
    };
  }
  static article_id_of(article_url) {
    try {
      const address = article_url.split("#", 1)[0];
      const query_start = address.indexOf("?");
      if (query_start < 0) {
        return article_url;
      }
      const values = {};
      for (const part of address.slice(query_start + 1).split("&")) {
        const separator = part.indexOf("=");
        if (separator < 0) {
          continue;
        }
        const key = decodeURIComponent(
          part.slice(0, separator).replace(/\+/g, " "),
        );
        if (
          !["__biz", "mid", "idx"].includes(key) ||
          values[key] !== undefined
        ) {
          continue;
        }
        values[key] = decodeURIComponent(
          part.slice(separator + 1).replace(/\+/g, " "),
        );
      }
      if (values.__biz && values.mid && values.idx) {
        return ["wxmp", values.__biz, values.mid, values.idx]
          .map(encodeURIComponent)
          .join(":");
      }
    } catch {}
    return article_url;
  }
  static article_idx_of(article_url) {
    const match = article_url.split("#", 1)[0].match(/[?&]idx=(\d+)(?:&|$)/);
    const idx = match ? Number(match[1]) : NaN;
    return Number.isSafeInteger(idx) && idx > 0 ? idx : Number.MAX_SAFE_INTEGER;
  }
  static escape_html_attribute(value) {
    return value
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }
  static digest_html(value) {
    const topic_pattern =
      /<a\b[^>]*\bclass\s*=\s*(["'])([^"']*)\1[^>]*>([^<]*)<\/a\s*>/gi;
    let result = "";
    let offset = 0;
    for (const match of value.matchAll(topic_pattern)) {
      if (!match[2].split(/\s+/).includes("wx_topic_link")) {
        continue;
      }
      result += WechatOfficialRSS.escape_html_attribute(
        value.slice(offset, match.index),
      );
      result += `<a class="wx_topic_link" style="color: #576b95;">${WechatOfficialRSS.escape_html_attribute(match[3])}</a>`;
      offset = match.index + match[0].length;
    }
    return (
      result + WechatOfficialRSS.escape_html_attribute(value.slice(offset))
    ).replace(/\r\n|\r|\n/g, "<br />");
  }
  static detail_infos_of(msg) {
    return Array.isArray(msg?.AppMsg?.DetailInfo) ? msg.AppMsg.DetailInfo : [];
  }
  static count_details(list) {
    return (Array.isArray(list?.Msg) ? list.Msg : []).reduce(function (n, msg) {
      return n + WechatOfficialRSS.detail_infos_of(msg).length;
    }, 0);
  }
  static pick_msg_list(data) {
    if (!data?.HideMsgList) {
      return data?.MsgList;
    }
    let best = data?.MsgList;
    for (const tab of [data?.ArticleTab?.MsgList, data?.PictextTab?.MsgList]) {
      if (
        WechatOfficialRSS.count_details(tab) >
        WechatOfficialRSS.count_details(best)
      ) {
        best = tab;
      }
    }
    return best;
  }
  static proxy_image(ctx, value) {
    try {
      const url = String(value || "");
      if (
        !/^https:\/\/(?:mmbiz\.qpic\.cn|wx\.qlogo\.cn)(?::443)?\//i.test(url)
      ) {
        return Result.Ok(url);
      }
      if (!ctx.public_origin) {
        return Result.Err(
          "公众号图片代理需要配置 FINDRSS_HOSTNAME",
          "UPSTREAM_INVALID_RESPONSE",
        );
      }
      return Result.Ok(
        ctx.public_origin + "/img/wxmp?url=" + encodeURIComponent(url),
      );
    } catch (error) {
      return Result.Err(error, error?.code ?? "UPSTREAM_INVALID_RESPONSE");
    }
  }
  async fetch(ctx) {
    try {
      const path_account =
        typeof ctx.params?.account === "string"
          ? ctx.params.account.trim()
          : "";
      const query_username =
        typeof ctx.query.username === "string" ? ctx.query.username.trim() : "";
      const username = path_account || query_username;
      const offset =
        typeof ctx.query.offset === "string" ? ctx.query.offset.trim() : "";
      if (username === "") {
        return Result.Err(
          "缺少公众号账号：请提供路径参数 account 或 query 参数 username",
          "INVALID_PARAMETER",
        );
      }
      if (!WechatOfficialRSS.account_id_pattern.test(username)) {
        return Result.Err(
          "公众号账号格式无效：请填写公众号微信号或 gh_xx ID，仅支持字母、数字、下划线和连字符",
          "INVALID_PARAMETER",
        );
      }
      const result_1 = await ctx.invoke("wxmp.biz.msg.list", {
        username,
        offset,
      });
      if (result_1.error) return result_1;
      const data = result_1.data;
      if (
        data?.BaseResponse?.Ret !== undefined &&
        Number(data.BaseResponse.Ret) !== 0
      )
        return Result.Err(
          "公众号设备接口拒绝请求",
          "UPSTREAM_INVALID_RESPONSE",
        );
      if (data === null || typeof data !== "object" || Array.isArray(data)) {
        return Result.Err(
          "设备返回了无效的公众号数据",
          "UPSTREAM_INVALID_RESPONSE",
        );
      }
      const account =
        data.AccountInfo && typeof data.AccountInfo === "object"
          ? data.AccountInfo
          : {};
      if (offset === "" && !account.UserName) {
        const ret = Number(data.BaseResponse?.Ret);
        const why = data.BaseResponse?.ErrMsg?.String
          ? " " + data.BaseResponse.ErrMsg.String
          : "";
        return Result.Err(
          `服务端没有返回该账号的资料（BaseResponse.Ret=${Number.isFinite(ret) ? ret : 0}${why}）：` +
            "这个 gh_/微信号在微信里查不到。请填「公众号资料页」上的微信号（形如 wow36kr）或 gh_ 开头的 id，" +
            "不要填公众号显示名",
          "UPSTREAM_INVALID_RESPONSE",
        );
      }
      const list = WechatOfficialRSS.pick_msg_list(data);
      const msgs = Array.isArray(list?.Msg) ? list.Msg : [];
      const items = [];
      for (const msg of msgs) {
        const publish_time =
          Number(msg?.BaseInfo?.DateTime) ||
          Number(msg?.AppMsg?.BaseInfo?.CreateTime) ||
          0;
        for (const detail of WechatOfficialRSS.detail_infos_of(msg)) {
          const article_url = String(detail?.ContentUrl || "");
          const pictures = Array.isArray(detail?.PicUrls?.PicInfoList)
            ? detail.PicUrls.PicInfoList.filter(function (pic) {
                return String(pic?.PicUrl || "") !== "";
              })
            : [];
          const values_3 = pictures;
          const result_4 = utils.map_results(values_3, function (pic) {
            try {
              const result_2 = WechatOfficialRSS.proxy_image(ctx, pic.PicUrl);
              if (result_2.error) return result_2;
              return Result.Ok(result_2.data);
            } catch (error) {
              return Result.Err(
                error,
                error?.code ?? "UPSTREAM_INVALID_RESPONSE",
              );
            }
          });
          if (result_4.error) return result_4;
          const images = result_4.data;
          const values_6 = pictures.filter(function (pic) {
            return pic?.livephoto?.url;
          });
          const result_7 = utils.map_results(values_6, function (pic) {
            try {
              const result_5 = WechatOfficialRSS.proxy_image(ctx, pic.PicUrl);
              if (result_5.error) return result_5;
              return Result.Ok({
                image: result_5.data,
                video:
                  String(pic.livephoto.url) +
                  String(pic.livephoto.url_token ?? pic.livephoto.token ?? ""),
                key: String(pic.livephoto.decode_key ?? ""),
                width: pic.livephoto.width ?? pic.Width,
                height: pic.livephoto.height ?? pic.Height,
              });
            } catch (error) {
              return Result.Err(
                error,
                error?.code ?? "UPSTREAM_INVALID_RESPONSE",
              );
            }
          });
          if (result_7.error) return result_7;
          const live_photos = result_7.data;
          const is_gallery =
            detail != null &&
            Object.prototype.hasOwnProperty.call(detail, "PicUrls");
          const description = String(detail?.Digest || "");
          const cover_url = String(
            detail?.CoverImgUrl || detail?.CoverImgUrl_1_1 || "",
          );
          const result_8 = WechatOfficialRSS.proxy_image(ctx, cover_url);
          if (result_8.error) return result_8;
          items.push({
            id: WechatOfficialRSS.article_id_of(article_url),
            type: is_gallery ? "gallery" : "article",
            title: String(
              detail?.Title || (is_gallery ? "未命名图集" : "未命名文章"),
            ),
            link: article_url,
            description,
            // 秒 / 毫秒 / ISO 串都可以，渲染端统一格式化。
            published:
              Number.isFinite(publish_time) && publish_time > 0
                ? publish_time
                : undefined,
            image: result_8.data || undefined,
            images: is_gallery ? images : undefined,
            ...(live_photos.length
              ? {
                  live_photos,
                }
              : {}),
            content: is_gallery
              ? [
                  ...(description.trim()
                    ? [`<p>${WechatOfficialRSS.digest_html(description)}</p>`]
                    : []),
                  ...images.map(function (image) {
                    return `<img src="${WechatOfficialRSS.escape_html_attribute(image)}" style="max-width:100%;height:auto;" />`;
                  }),
                ].join("\n")
              : undefined,
          });
        }
      }
      const published_ms = function (item) {
        const time = item.published ?? 0;
        return time < 1_000_000_000_000 ? time * 1000 : time;
      };
      items.sort(function (left, right) {
        // 同一批推送发布时间相同，按 idx 升序排列，头条在前。
        return (
          published_ms(right) - published_ms(left) ||
          WechatOfficialRSS.article_idx_of(left.link) -
            WechatOfficialRSS.article_idx_of(right.link)
        );
      });
      const channel_title = String(
        account.NickName || account.UserName || username,
      );
      const channel_description = String(
        account.Signature || channel_title + " 的公众号内容",
      );
      const result_9 = WechatOfficialRSS.proxy_image(ctx, account.HeadImgUrl);
      if (result_9.error) return result_9;
      return Result.Ok({
        id: "wxmp:channel:" + username,
        title: channel_title,
        link: String(items[0]?.link || "https://mp.weixin.qq.com/"),
        description: channel_description,
        language: "zh-cn",
        author: {
          name: channel_title,
          uri: "https://mp.weixin.qq.com/",
        },
        image: result_9.data || (ctx.public_origin || "") + "/findrss-logo.png",
        updated: items[0]?.published || null,
        items,
        extra: {
          view: "timeline",
          show_thumbnails: true,
          proxy_images: true,
          headers: {
            referer: "https://mp.weixin.qq.com/",
          },
          tags: ["微信公众号"],
        },
      });
    } catch (error) {
      return Result.Err(error, error?.code ?? "UPSTREAM_INVALID_RESPONSE");
    }
  }
}
const script = new WechatOfficialRSS();
export const routes = [
  {
    path: "/wxmp/:account?",
    name: "微信公众号",
    url: "mp.weixin.qq.com",
    maintainers: ["findrss"],
    example: "/wxmp/wow36kr",
    parameters: {
      account:
        "公众号微信号（如 wow36kr、zhihuribao）或原始 ID（如 gh_0a171c96fdbb、图集号 phacct_…）；也可继续用 ?username= 参数",
      offset: "分页游标，默认为空",
    },
    description:
      "通过已连接设备调用 wxmp.biz.msg.list（设备原样回传公众号回包 JSON）生成公众号订阅源；同一 route 覆盖文章与图集（按每条是否带 PicUrls 映射），/rss 输出 RSS 2.0，/atom 输出 Atom 1.0。",
    handler: (ctx) => script.run(ctx),
  },
  {
    public: true,
    path: "/img/wxmp",
    name: "微信公众号图片代理",
    allowed_hosts: ["mmbiz.qpic.cn", "wx.qlogo.cn"],
    example:
      "/img/wxmp?url=https%3A%2F%2Fmmbiz.qpic.cn%2Fsz_mmbiz_jpg%2Fo02wSnKAPeGMHexZclJTrcLKL2lHicsXib9Hqaj5eMaXHdCNgL3STm8jvzOrRnY0dChSL9OVmwld2BVkVicLctXtuXNqibkiceXibiclE7jyndFxWY%2F300%3Fwxtype%3Djpeg%26wxfrom%3D25",
    parameters: {
      url: "微信图片 CDN 的完整 HTTPS 地址",
    },
    description: "",
    handler: (ctx) => WechatOfficialRSS.proxy_img(ctx),
  },
];
