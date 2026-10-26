import { utils } from "@findrss/util";

export const version = "1.1.0";
export const platform = {
  name: "抖音",
  icon: '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 512 512" data-n="douyin-platform-icon"><rect width="512" height="512" rx="15%" data-n="douyin-icon-rect-1" /><defs data-n="douyin-icon-defs-2"><path id="douyin-note" d="M219 200a117 117 0 1 0 101 115v-128a150 150 0 0 0 88 28v-63a88 88 0 0 1-88-88h-64v252a54 54 0 1 1-37-51z" data-n="douyin-icon-path-3" /></defs><use href="#douyin-note" fill="#ff0050" x="18" y="15" data-n="douyin-icon-use-4" /><use href="#douyin-note" fill="#00faf0" x="-10" data-n="douyin-icon-use-5" /><use href="#douyin-note" fill="#fff" x="4" y="7" data-n="douyin-icon-use-6" /></svg>',
};

export const permissions = {
  cookies: [
    {
      id: "account_0",
      origin: "https://www.douyin.com",
      path_prefix: "/",
      names: [
        "UIFID",
        "sessionid",
        "sessionid_ss",
        "sid_guard",
        "msToken",
        "ttwid",
        "passport_csrf_token",
        "s_v_web_id",
      ],
      purpose: "读取用户授权的 抖音作者作品 页面或接口",
    },
  ],
};
export class DouyinUserRSS extends RSSScript {
  static USER_AGENT =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36";
  async fetch(ctx) {
    try {
      const uid = String(ctx.params?.sec_uid || "");
      if (!/^MS4wLj[A-Za-z0-9_-]{10,120}$/.test(uid)) {
        return Result.Err(
          "sec_uid 必须为抖音作者主页中的有效标识",
          "INVALID_PARAMETER",
        );
      }
      const count =
        ctx.query?.count === undefined || ctx.query.count === ""
          ? 18
          : Number(ctx.query.count);
      if (!Number.isInteger(count) || count < 1 || count > 30) {
        return Result.Err("count 必须为 1–30 的整数", "INVALID_PARAMETER");
      }
      const cursor = String(ctx.query?.max_cursor || "0");
      if (!/^\d{1,20}$/.test(cursor)) {
        return Result.Err("max_cursor 必须为数字游标", "INVALID_PARAMETER");
      }
      const link = "https://www.douyin.com/user/" + uid;
      const params = {
        device_platform: "webapp",
        aid: "6383",
        channel: "channel_pc_web",
        sec_user_id: uid,
        max_cursor: cursor,
        locate_query: "false",
        show_live_replay_strategy: "1",
        need_time_list: cursor === "0" ? "1" : "0",
        time_list_query: "0",
        whale_cut_token: "",
        cut_version: "1",
        count: String(count),
        publish_video_strategy_type: "2",
        from_user_page: "1",
        update_version_code: "170400",
        pc_client_type: "1",
        pc_libra_divert: "Mac",
        support_h265: "0",
        support_dash: "0",
        cpu_core_num: "10",
        version_code: "290100",
        version_name: "29.1.0",
        cookie_enabled: "true",
        screen_width: "1512",
        screen_height: "982",
        browser_language: "zh-CN",
        browser_platform: "MacIntel",
        browser_name: "Chrome",
        browser_version: "154.0.0.0",
        browser_online: "true",
        engine_name: "Blink",
        engine_version: "154.0.0.0",
        os_name: "Mac OS",
        os_version: "10.15.7",
        device_memory: "32",
        platform: "PC",
        downlink: "10",
        effective_type: "4g",
        round_trip_time: "100",
        msToken: "",
        timestamp: String(Math.floor(Date.now() / 1000)),
      };
      const query = Object.keys(params)
        .map(function (key) {
          return (
            encodeURIComponent(key) + "=" + encodeURIComponent(params[key])
          );
        })
        .join("&");
      let result;
      try {
        const result_1 = await DouyinUserRSS.request_text(
          ctx,
          "https://www.douyin.com/aweme/v1/web/aweme/post/?" + query,
          {
            headers: DouyinUserRSS.request_headers(link),
            douyin_sign: true,
          },
        );
        if (result_1.error) throw result_1.error;
        const text = result_1.data;
        const result_2 = parseJSON(text);
        if (result_2.error) throw result_2.error;
        result = result_2.data;
      } catch (error) {
        return Result.Err(
          "抖音作品接口请求失败：" +
            (error.message || "请求或响应解析失败") +
            "；请在 Cookie 管理同步有效的 .douyin.com Cookie，检查登录状态及上游风控。",
          error.code ?? "UPSTREAM_INVALID_RESPONSE",
        );
      }
      if (!result || result.status_code !== 0) {
        return Result.Err(
          "抖音作品接口拒绝请求：" +
            (result?.status_code ?? "无状态码") +
            " " +
            "上游拒绝请求" +
            "；请检查 Cookie 与上游风控",
          "UPSTREAM_INVALID_RESPONSE",
        );
      }
      if (!Array.isArray(result.aweme_list)) {
        return Result.Err(
          "抖音作品接口缺少 aweme_list，不能作为空作品列表",
          "UPSTREAM_INVALID_RESPONSE",
        );
      }
      const author = result.aweme_list[0]?.author || {};
      const name = String(author.nickname || uid);
      const seen = new Set();
      const items = [];
      for (const aweme of result.aweme_list) {
        const result_3 = DouyinUserRSS.numeric_id(aweme.aweme_id, "aweme_id");
        if (result_3.error) return result_3;
        const id = result_3.data;
        const owner = aweme.author?.sec_uid;
        if (owner && owner !== uid) {
          return Result.Err(
            "作品作者与请求的 sec_uid 不一致",
            "UPSTREAM_INVALID_RESPONSE",
          );
        }
        if (seen.has(id)) {
          continue;
        }
        seen.add(id);
        const images = Array.isArray(aweme.images)
          ? aweme.images.map(DouyinUserRSS.first_url).filter(Boolean)
          : [];
        const note = images.length > 0 || aweme.aweme_type === 68;
        const description = String(aweme.desc || "");
        const item = {
          id: "douyin:" + id,
          title: description || (note ? "抖音图集" : "抖音视频"),
          link: "https://www.douyin.com/" + (note ? "note/" : "video/") + id,
          author: {
            name: String(aweme.author?.nickname || name),
            uri: link,
          },
          description,
          published: aweme.create_time || undefined,
          updated: aweme.create_time || undefined,
          media_group: true,
          image:
            DouyinUserRSS.first_url(aweme.video?.cover) ||
            DouyinUserRSS.first_url(aweme.video?.origin_cover) ||
            images[0] ||
            "",
        };
        if (note) {
          item.images = images;
          if (images.length === 0) {
            return Result.Err(
              "图集 " + id + " 缺少图片地址",
              "UPSTREAM_INVALID_RESPONSE",
            );
          }
        } else {
          const address = aweme.video?.play_addr || aweme.video?.play_addr_h264;
          const url = DouyinUserRSS.first_url(address);
          if (url) {
            item.enclosure = {
              url,
              type: "video/mp4",
              length: Number(address.data_size) || undefined,
            };
          } else {
            if (ctx.log) {
              ctx.log("视频缺少播放地址", id);
            }
          }
        }
        items.push(item);
      }
      if (ctx.log) {
        ctx.log("抖音分页", {
          count: items.length,
          has_more: result.has_more,
          max_cursor: result.max_cursor,
        });
      }
      return Result.Ok({
        id: "douyin:author:" + uid,
        title: name + " 的抖音作品",
        link,
        description: String(author.signature || "抖音作者最新投稿"),
        language: "zh-cn",
        author: {
          name,
          uri: link,
        },
        image:
          DouyinUserRSS.first_url(author.avatar_larger) ||
          DouyinUserRSS.first_url(author.avatar_thumb) ||
          (ctx.public_origin || "") + "/findrss-logo.png",
        updated: items[0]?.updated || null,
        items,
        extra: {
          view: "video",
          show_thumbnails: true,
          proxy_images: true,
          headers: {
            referer: "https://www.douyin.com/",
          },
          tags: ["抖音"],
        },
      });
    } catch (error) {
      return Result.Err(error, error?.code ?? "UPSTREAM_INVALID_RESPONSE");
    }
  }
  static request_headers(link) {
    return {
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      "User-Agent": DouyinUserRSS.USER_AGENT,
      Referer: link,
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
      "sec-ch-ua":
        '"Chromium";v="154", "Google Chrome";v="154", "Not A(Brand";v="99"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"macOS"',
      "sec-fetch-dest": "empty",
      "sec-fetch-mode": "cors",
      "sec-fetch-site": "same-origin",
    };
  }
  static first_url(value) {
    const urls = Array.isArray(value)
      ? value
      : value?.url_list || value?.urlList || [];
    return (
      urls.find(function (url) {
        return typeof url === "string" && /^https?:\/\//.test(url);
      }) || ""
    );
  }
  static numeric_id(value, name) {
    try {
      if (typeof value === "number" && !Number.isSafeInteger(value)) {
        return Result.Err(
          name + " 超过安全整数范围，接口必须以字符串返回",
          "UPSTREAM_INVALID_RESPONSE",
        );
      }
      const id = String(value || "");
      if (!/^\d{1,24}$/.test(id)) {
        return Result.Err(name + " 无效", "UPSTREAM_INVALID_RESPONSE");
      }
      return Result.Ok(id);
    } catch (error) {
      return Result.Err(error, error?.code ?? "UPSTREAM_INVALID_RESPONSE");
    }
  }
  static async request_text(ctx, url, options = {}) {
    const permission = permissions.cookies.find((entry) =>
      String(url).startsWith(entry.origin + "/"),
    );
    if (permission) {
      const acquired = await ctx.cookies.get(permission.id);
      if (acquired.error) return acquired;
      return utils.request_text(ctx, url, {
        ...options,
        cookies: acquired.data,
      });
    }
    return utils.request_text(ctx, url, options);
  }
}
const script = new DouyinUserRSS();
export const route = {
  name: "抖音作者作品",
  path: "/douyin/user/:sec_uid",
  url: "www.douyin.com",
  maintainers: ["findrss"],
  example:
    "/douyin/user/MS4wLjABAAAAOE57npukdzs0SH_Fk5RHB-qfUlnZ5jQT2R_KPH4Sd8s",
  parameters: {
    sec_uid: "作者主页 /user/ 后的 sec_uid",
    count: "每页数量，默认 18，最多 30",
    max_cursor: "分页游标，默认 0；下一页游标见执行日志",
  },
  description:
    "获取抖音作者投稿视频与图集，输出 Media RSS 分组和视频附件，Cookie 由脚本显式申请并经管理员确认授权。",
  handler: (ctx) => script.run(ctx),
};
