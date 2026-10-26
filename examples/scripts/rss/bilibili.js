import { utils } from "@findrss/util";

export const version = "1.1.0";
export const platform = {
  name: "哔哩哔哩",
  icon: '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" data-n="bilibili-platform-icon"><path fill="none" stroke="#00a1d6" stroke-linecap="round" stroke-width="3" d="m8 7-3-5m16 5 3-5" data-n="bilibili-icon-path-1" /><path fill="#00a1d6" d="M7 6h18a7 7 0 0 1 7 7v10a7 7 0 0 1-7 7H7a7 7 0 0 1-7-7V13a7 7 0 0 1 7-7Z" data-n="bilibili-icon-path-2" /><path fill="#fff" d="M6 10h20a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V12a2 2 0 0 1 2-2Z" data-n="bilibili-icon-path-3" /><rect x="8" y="14" width="4" height="6" rx="2" fill="#00a1d6" data-n="bilibili-icon-rect-4" /><rect x="20" y="14" width="4" height="6" rx="2" fill="#00a1d6" data-n="bilibili-icon-rect-5" /></svg>',
};

const permutation = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
  33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61,
  26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36,
  20, 34, 44, 52,
];
export const permissions = {
  cookies: [
    {
      id: "account_0",
      origin: "https://api.bilibili.com",
      path_prefix: "/",
      names: [
        "SESSDATA",
        "bili_jct",
        "DedeUserID",
        "DedeUserID__ckMd5",
        "buvid3",
        "buvid4",
        "buvid_fp",
        "b_nut",
        "_uuid",
        "sid",
        "rpdid",
        "b_lsid",
        "theme-tip-show",
        "theme-avatar-tip-show",
        "home_feed_column",
        "browser_resolution",
        "CURRENT_QUALITY",
        "CURRENT_FNVAL",
      ],
      purpose: "读取用户授权的 哔哩哔哩用户动态和视频 页面或接口",
    },
    {
      id: "account_1",
      origin: "https://space.bilibili.com",
      path_prefix: "/",
      names: ["SESSDATA", "bili_jct", "DedeUserID"],
      purpose: "读取用户授权的 哔哩哔哩用户动态和视频 页面或接口",
    },
  ],
};
class BilibiliRSS extends RSSScript {
  static async request_text(ctx, url, options = {}) {
    const permission = permissions.cookies.find((entry) =>
      String(url).startsWith(entry.origin + "/"),
    );
    if (permission) {
      const acquired = await ctx.cookies.get(permission.id);
      if (acquired.error) return acquired;
      return utils.request_text(ctx, url, {
        ...options,
        transport: "tcp",
        cookies: acquired.data,
      });
    }
    return utils.request_text(ctx, url, { ...options, transport: "tcp" });
  }
}
export class BilibiliUserDynamicRSS extends BilibiliRSS {
  async fetch(ctx) {
    try {
      const uid = String(ctx.params?.userid || "");
      const offset = String(ctx.query?.offset || "");
      if (!/^\d{1,20}$/.test(uid)) {
        return Result.Err("userid 必须为数字", "INVALID_PARAMETER");
      }
      if (offset && !/^\d{1,30}$/.test(offset)) {
        return Result.Err("offset 必须为数字游标", "INVALID_PARAMETER");
      }
      const homepage = "https://space.bilibili.com/" + uid;
      const link = homepage + "/dynamic";
      let result;
      try {
        const result_1 = await BilibiliUserDynamicRSS.request_text(
          ctx,
          "https://api.bilibili.com/x/polymer/web-dynamic/v1/feed/space?host_mid=" +
            uid +
            "&timezone_offset=-480&features=itemOpusStyle" +
            (offset ? "&offset=" + offset : ""),
          {
            headers: {
              Accept: "application/json, text/plain, */*",
              Referer: link,
              "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
              "User-Agent":
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36",
            },
          },
        );
        if (result_1.error) throw result_1.error;
        const text = result_1.data;
        try {
          const result_2 = parseJSON(text);
          if (result_2.error) throw result_2.error;
          result = result_2.data;
        } catch {
          throw Object.assign(new Error("接口返回非 JSON 内容，可能为验证页"), {
            name: "FeedError",
            code: "UPSTREAM_INVALID_RESPONSE",
          });
        }
        if (result?.code !== 0) {
          throw Object.assign(
            new Error(
              "接口拒绝请求（" +
                result?.code +
                "）：" +
                "请检查登录状态、账号权限或上游验证",
            ),
            {
              name: "FeedError",
              code: "UPSTREAM_INVALID_RESPONSE",
            },
          );
        }
        if (!Array.isArray(result.data?.items)) {
          throw Object.assign(new Error("接口缺少 data.items 动态数组"), {
            name: "FeedError",
            code: "UPSTREAM_INVALID_RESPONSE",
          });
        }
      } catch (error) {
        return Result.Err(
          "B 站动态读取失败：" +
            (error.message || "请求或响应解析失败") +
            "；请同步有效的 .bilibili.com Cookie，或完成上游验证后重试。",
          error.code ?? "UPSTREAM_INVALID_RESPONSE",
        );
      }
      const seen = new Set();
      const items = [];
      for (const card of result.data.items) {
        if (!card || typeof card !== "object") {
          continue;
        }
        const result_3 = BilibiliUserDynamicRSS.dynamic_item(card, uid);
        if (result_3.error) return result_3;
        const item = result_3.data;
        if (!seen.has(item.id)) {
          seen.add(item.id);
          items.push(item);
        }
      }
      items.sort(function (a, b) {
        return (Number(b.published) || 0) - (Number(a.published) || 0);
      });
      const author = result.data.items.find(function (card) {
        return String(card?.modules?.module_author?.mid || "") === uid;
      })?.modules.module_author;
      ctx.log("B 站动态分页", {
        has_more: result.data.has_more,
        offset: result.data.offset,
      });
      return Result.Ok({
        id: "bilibili:dynamic:channel:" + uid,
        title: (author?.name || uid) + " 的 B 站动态",
        link,
        description: "UP 主 " + uid + " 的最新动态",
        language: "zh-cn",
        author: {
          name: String(author?.name || uid),
          uri: homepage,
        },
        image:
          BilibiliUserDynamicRSS.public_url(author?.face) ||
          (ctx.public_origin || "") + "/findrss-logo.png",
        updated: items[0]?.published || null,
        items,
        extra: {
          view: "timeline",
          show_thumbnails: true,
          proxy_images: true,
          headers: {
            referer: "https://www.bilibili.com/",
          },
          tags: ["哔哩哔哩"],
        },
      });
    } catch (error) {
      return Result.Err(error, error?.code ?? "UPSTREAM_INVALID_RESPONSE");
    }
  }
  static public_url(value) {
    const url = String(value || "").replace(/^\/\//, "https://");
    return /^https?:\/\//i.test(url) ? url : "";
  }
  static dynamic_body(card) {
    const dynamic = card?.modules?.module_dynamic || {};
    const major = dynamic.major || {};
    const opus = major.opus;
    const archive = major.archive;
    const article = major.article;
    const common = major.common;
    const title = String(
      opus?.title || archive?.title || article?.title || common?.title || "",
    );
    const text = String(
      dynamic.desc?.text ||
        opus?.summary?.text ||
        archive?.desc ||
        article?.desc ||
        common?.desc ||
        "",
    );
    const pictures = major.draw?.items || opus?.pics || [];
    const images = [
      ...new Set(
        (Array.isArray(pictures) ? pictures : [])
          .map(function (pic) {
            return BilibiliUserDynamicRSS.public_url(pic?.src || pic?.url);
          })
          .filter(Boolean),
      ),
    ];
    const covers = article?.covers;
    const image =
      images[0] ||
      BilibiliUserDynamicRSS.public_url(
        archive?.cover ||
          (Array.isArray(covers) ? covers[0] : "") ||
          common?.cover,
      );
    return {
      title,
      text,
      images,
      image,
      link: BilibiliUserDynamicRSS.public_url(
        archive?.jump_url ||
          article?.jump_url ||
          common?.jump_url ||
          opus?.jump_url,
      ),
    };
  }
  static dynamic_item(card, uid) {
    try {
      const id = String(card.id_str || "");
      if (!/^\d+$/.test(id)) {
        return Result.Err(
          "B 站动态缺少有效的 id_str",
          "UPSTREAM_INVALID_RESPONSE",
        );
      }
      const author = card.modules?.module_author || {};
      const published = utils.timestamp(author.pub_ts);
      if (published.error) {
        return Result.Err(
          "B 站动态 " + id + " 的发布时间无效：" + published.error.message,
          "UPSTREAM_INVALID_RESPONSE",
        );
      }
      const body = BilibiliUserDynamicRSS.dynamic_body(card);
      const original = card.orig
        ? BilibiliUserDynamicRSS.dynamic_body(card.orig)
        : null;
      const quoted = original
        ? "转发 @" +
          (card.orig.modules?.module_author?.name || "原作者") +
          "：" +
          (original.text || original.title || "原动态不可访问")
        : "";
      const description = [body.text || body.title, quoted]
        .filter(Boolean)
        .join("\n\n");
      const images = [
        ...new Set([...body.images, ...(original?.images || [])]),
      ];
      const original_link =
        original?.link ||
        (card.orig?.id_str ? "https://t.bilibili.com/" + card.orig.id_str : "");
      let content =
        "<p>" +
        utils.escape_html(body.text || body.title).replace(/\n/g, "<br>") +
        "</p>";
      if (quoted) {
        content +=
          "<blockquote>" +
          utils.escape_html(quoted).replace(/\n/g, "<br>") +
          "</blockquote>";
      }
      const target = body.link || original_link;
      if (target) {
        content +=
          '<p><a href="' + utils.escape_html(target) + '">查看原文</a></p>';
      }
      return Result.Ok({
        id: "bilibili:dynamic:" + id,
        link: "https://t.bilibili.com/" + id,
        title:
          Array.from(body.title || description)
            .slice(0, 100)
            .join("") || "B 站动态 " + id,
        description,
        content,
        published: published.data,
        author: {
          name: String(author.name || uid),
          uri: "https://space.bilibili.com/" + (author.mid || uid),
        },
        image: body.image || original?.image || undefined,
        images,
        categories: card.type ? [String(card.type)] : [],
      });
    } catch (error) {
      return Result.Err(error, error?.code ?? "UPSTREAM_INVALID_RESPONSE");
    }
  }
}
export class BilibiliUserVideoRSS extends BilibiliRSS {
  static md5_ascii(value) {
    const bytes = [];
    for (let i = 0; i < value.length; i++) {
      bytes.push(value.charCodeAt(i));
    }
    const length = bytes.length;
    bytes.push(128);
    while (bytes.length % 64 !== 56) {
      bytes.push(0);
    }
    for (let i = 0; i < 8; i++) {
      bytes.push(Math.floor((length * 8) / Math.pow(256, i)) & 255);
    }
    let state = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476];
    const shifts = [
      [7, 12, 17, 22],
      [5, 9, 14, 20],
      [4, 11, 16, 23],
      [6, 10, 15, 21],
    ];
    for (let offset = 0; offset < bytes.length; offset += 64) {
      const words = [];
      for (let i = 0; i < 16; i++) {
        const p = offset + i * 4;
        words.push(
          bytes[p] |
            (bytes[p + 1] << 8) |
            (bytes[p + 2] << 16) |
            (bytes[p + 3] << 24),
        );
      }
      let [a, b, c, d] = state;
      for (let i = 0; i < 64; i++) {
        let f;
        let g;
        if (i < 16) {
          f = (b & c) | (~b & d);
          g = i;
        } else {
          if (i < 32) {
            f = (d & b) | (~d & c);
            g = (5 * i + 1) % 16;
          } else {
            if (i < 48) {
              f = b ^ c ^ d;
              g = (3 * i + 5) % 16;
            } else {
              f = c ^ (b | ~d);
              g = (7 * i) % 16;
            }
          }
        }
        const sum =
          (a +
            f +
            Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) +
            words[g]) |
          0;
        const shift = shifts[Math.floor(i / 16)][i % 4];
        const next = (b + ((sum << shift) | (sum >>> (32 - shift)))) | 0;
        a = d;
        d = c;
        c = b;
        b = next;
      }
      state = state.map(function (v, i) {
        return (v + [a, b, c, d][i]) | 0;
      });
    }
    return state
      .map(function (v) {
        return [0, 8, 16, 24]
          .map(function (s) {
            return ((v >>> s) & 255).toString(16).padStart(2, "0");
          })
          .join("");
      })
      .join("");
  }
  static headers(url) {
    return {
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "zh-CN,zh;q=0.9",
      "User-Agent":
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
      Referer: url,
    };
  }
  static integer(value, fallback, max, name) {
    try {
      if (value === undefined || value === "") {
        return Result.Ok(fallback);
      }
      if (
        !/^\d+$/.test(String(value)) ||
        Number(value) < 1 ||
        Number(value) > max
      ) {
        return Result.Err(
          name + " 必须为 1–" + max + " 的整数",
          "INVALID_PARAMETER",
        );
      }
      return Result.Ok(Number(value));
    } catch (error) {
      return Result.Err(error, error?.code ?? "UPSTREAM_INVALID_RESPONSE");
    }
  }
  static image_url(value) {
    const url = String(value || "")
      .replace(/^\/\//, "https://")
      .replace(/^http:\/\//, "https://");
    return /^https:\/\//.test(url) ? url : "";
  }
  static avatar_url(value) {
    return BilibiliUserVideoRSS.image_url(
      String(value || "").replace(/@[^/?#]*$/, ""),
    );
  }
  async fetch(ctx) {
    try {
      const uid = String(ctx.params?.userid || "");
      if (!/^\d{1,20}$/.test(uid)) {
        return Result.Err("userid 必须为数字", "INVALID_PARAMETER");
      }
      const result_1 = BilibiliUserVideoRSS.integer(
        ctx.query?.pn,
        1,
        10000,
        "pn",
      );
      if (result_1.error) return result_1;
      const pn = result_1.data;
      const result_2 = BilibiliUserVideoRSS.integer(
        ctx.query?.ps,
        30,
        50,
        "ps",
      );
      if (result_2.error) return result_2;
      const ps = result_2.data;
      const link = "https://space.bilibili.com/" + uid + "/upload/video";
      const space = "https://space.bilibili.com/" + uid;
      async function request(url) {
        const started_at = Date.now();
        const options = {
          transport: "tcp",
          timeout_ms: 10000,
          headers: BilibiliUserVideoRSS.headers(url),
        };
        try {
          const result_3 = await BilibiliUserVideoRSS.request_text(
            ctx,
            url,
            options,
          );
          if (result_3.error) throw result_3.error;
          const text = result_3.data;
          const result_4 = parseJSON(text);
          if (result_4.error) throw result_4.error;
          const result = result_4.data;
          if (!result || typeof result !== "object") {
            throw new Error("返回值不是 JSON 对象");
          }
          return Result.Ok(result);
        } catch (error) {
          if (ctx.route?.debug_request && ctx.log) {
            ctx.log("B 站 API 请求失败", {
              url,
              elapsed_ms: Date.now() - started_at,
            });
            ctx.log("B 站 API 请求参数", options);
          }
          return Result.Err(
            "B 站请求失败（" +
              url.split("?")[0] +
              "）：" +
              error.message +
              (error?.code === "UPSTREAM_TIMEOUT"
                ? "（请求超时预算 " + options.timeout_ms / 1000 + " 秒）"
                : ""),
            error?.code ?? "UPSTREAM_INVALID_RESPONSE",
          );
        }
      }
      const result_5 = await request(
        "https://api.bilibili.com/x/web-interface/nav",
      );
      if (result_5.error) return result_5;
      const nav = result_5.data;
      const images = nav.data?.wbi_img;

      function key(url) {
        return (
          String(url || "").match(
            /\/([a-fA-F0-9]{32})\.[^/?]+(?:\?.*)?$/,
          )?.[1] || ""
        );
      }
      const original = key(images?.img_url) + key(images?.sub_url);
      if (original.length !== 64) {
        return Result.Err(
          new Error(
            "B 站未返回 WBI 签名密钥；请检查 Cookie 管理中的 .bilibili.com 登录 Cookie 与上游风控。",
          ),
          "UPSTREAM_INVALID_RESPONSE",
        );
      }
      const mixin = permutation
        .map(function (i) {
          return original[i];
        })
        .join("")
        .slice(0, 32);
      const params = {
        mid: uid,
        pn,
        ps,
        order: "pubdate",
        tid: 0,
        special_type: "",
        index: 0,
        keyword: "",
        order_avoided: true,
        platform: "web",
        web_location: "333.1387",
        "x-bili-locale-json":
          '{"c_locale":{"language":"zh","script":"Hans"},"always_translate":false}',
        "x-bili-device-req-json":
          '{"platform":"web","device":"pc","spmid":"333.1387","mobi_app":"web_cn"}',
        // shortcut: 沿用成功 HAR 的设备指纹，上游校验变化时更新采样。
        dm_img_list: "[]",
        dm_img_str: "V2ViR0wgMS4wIChPcGVuR0wgRVMgMi4wIENocm9taXVtKQ",
        dm_cover_img_str:
          "QU5HTEUgKEFwcGxlLCBBTkdMRSBNZXRhbCBSZW5kZXJlcjogQXBwbGUgTTEgUHJvLCBVbnNwZWNpZmllZCBWZXJzaW9uKUdvb2dsZSBJbmMuIChBcHBsZS",
        dm_img_inter: '{"ds":[],"wh":[4921,5252,61],"of":[216,432,216]}',
        wts: Math.floor(Date.now() / 1000),
      };
      const query = Object.keys(params)
        .sort()
        .map(function (k) {
          return (
            encodeURIComponent(k) +
            "=" +
            encodeURIComponent(String(params[k]).replace(/[!'()*]/g, ""))
          );
        })
        .join("&");
      const result_6 = await request(
        "https://api.bilibili.com/x/space/wbi/arc/search?" +
          query +
          "&w_rid=" +
          BilibiliUserVideoRSS.md5_ascii(query + mixin),
      );
      if (result_6.error) return result_6;
      const result = result_6.data;
      if (result.code !== 0) {
        return Result.Err(
          new Error(
            "B 站视频接口拒绝请求（" +
              result.code +
              "）：" +
              (result.message || "未知错误") +
              "；请更新 .bilibili.com 登录 Cookie 或稍后重试。",
          ),
          "UPSTREAM_INVALID_RESPONSE",
        );
      }
      const videos = result.data?.list?.vlist;
      if (!Array.isArray(videos)) {
        return Result.Err(
          new Error("B 站视频接口缺少 list.vlist，无法读取投稿列表"),
          "UPSTREAM_INVALID_RESPONSE",
        );
      }
      const list_author = String(videos[0]?.author || uid);
      const items = [];
      let playable = 0;
      let playback_error;
      let snapshot = 0;
      let face = BilibiliUserVideoRSS.avatar_url(videos[0]?.face);
      for (const video of videos) {
        const bvid = String(video.bvid || "");
        const aid = String(video.aid || "");
        const is_bvid = /^BV[A-Za-z0-9]+$/.test(bvid);
        if (!is_bvid && !/^\d+$/.test(aid)) {
          return Result.Err(
            new Error("B 站视频缺少有效的 bvid/aid"),
            "UPSTREAM_INVALID_RESPONSE",
          );
        }
        const id = is_bvid ? bvid : "av" + aid;
        const result_7 = utils.timestamp(video.created);
        if (result_7.error) return result_7;
        const published = result_7.data;
        const description = String(video.description || "");
        const cover = BilibiliUserVideoRSS.image_url(video.pic);
        const item = {
          id: "bilibili:" + id,
          type: "video",
          title: String(video.title || id),
          link: "https://www.bilibili.com/video/" + id,
          author: {
            name: String(video.author || list_author),
            uri: space,
          },
          published,
          updated: published,
          // description/content 直接传原始文本，XML 转义由服务端完成。
          description,
          content: description
            ? "<p>" + description.replace(/\r?\n/g, "<br>") + "</p>"
            : undefined,
          image: cover || undefined,
          media_group: true,
        };
        try {
          const identity = is_bvid
            ? "bvid=" + encodeURIComponent(bvid)
            : "aid=" + aid;
          const result_8 = await request(
            "https://api.bilibili.com/x/web-interface/view?" + identity,
          );
          if (result_8.error) throw result_8.error;
          const view = result_8.data;
          if (view.code !== 0) {
            throw new Error(
              "视频详情接口错误：" + view.code + " " + (view.message || ""),
            );
          }
          const detail = String(view.data?.desc || "");
          if (detail) {
            item.description = detail;
            item.content = "<p>" + detail.replace(/\r?\n/g, "<br>") + "</p>";
          }
          const result_9 = utils.timestamp(view.data?.pubdate);
          if (result_9.error) throw result_9.error;
          item.updated = result_9.data || item.updated;
          if (!face) {
            face = BilibiliUserVideoRSS.avatar_url(view.data?.owner?.face);
          }
          const cid = String(
            view.data?.pages?.[0]?.cid || view.data?.cid || "",
          );
          if (!/^\d+$/.test(cid)) {
            throw new Error("视频详情缺少 cid");
          }
          const result_10 = await request(
            "https://api.bilibili.com/x/player/playurl?otype=json&fnver=0&fnval=0&qn=80&" +
              identity +
              "&cid=" +
              cid +
              "&platform=html5",
          );
          if (result_10.error) throw result_10.error;
          const play = result_10.data;
          if (play.code !== 0) {
            throw new Error(
              "播放接口错误：" + play.code + " " + (play.message || ""),
            );
          }
          const streams = play.data?.durl;
          if (!Array.isArray(streams) || streams.length !== 1) {
            throw new Error("播放接口未返回单文件 MP4，无法作为完整视频附件");
          }
          const stream = streams[0];
          const url = String(stream.url || "");
          if (!/^https?:\/\//.test(url)) {
            throw new Error("播放接口缺少有效视频地址");
          }
          const size = Number(stream.size);
          item.enclosure = {
            url,
            type: "video/mp4",
            length: Number.isFinite(size) && size > 0 ? size : undefined,
          };
          playable++;
        } catch (error) {
          playback_error ||= error;
          if (ctx.log) {
            ctx.log("视频地址获取失败", id, error.message);
          }
        }
        const latest = item.updated || item.published;
        if (latest && latest > snapshot) {
          snapshot = latest;
        }
        items.push(item);
      }
      if (items.length > 0 && playable === 0) {
        return Result.Err(
          new Error(
            "本页所有视频地址获取失败：" +
              playback_error.message +
              "；详情见脚本执行日志",
          ),
          playback_error?.code ?? "UPSTREAM_INVALID_RESPONSE",
        );
      }
      if (!face) {
        try {
          const result_11 = await request(
            "https://api.bilibili.com/x/web-interface/card?mid=" + uid,
          );
          if (result_11.error) throw result_11.error;
          const card = result_11.data;
          face = BilibiliUserVideoRSS.avatar_url(card.data?.card?.face);
        } catch (error) {
          if (ctx.log) {
            ctx.log("UP 主头像获取失败", uid, error.message);
          }
        }
      }
      const feed = {
        id: "bilibili:channel:" + uid,
        title: list_author + " 的 B 站视频",
        link,
        description: "UP 主 " + uid + " 的最新投稿视频",
        language: "zh-CN",
        author: {
          name: list_author,
          uri: space,
        },
        updated: snapshot || undefined,
        items,
      };
      if (face) {
        feed.image = {
          url: face,
          title: list_author,
          link: space,
        };
      }
      return Result.Ok(feed);
    } catch (error) {
      return Result.Err(error, error?.code ?? "UPSTREAM_INVALID_RESPONSE");
    }
  }
}
const dynamic_script = new BilibiliUserDynamicRSS();
const video_script = new BilibiliUserVideoRSS();
export const routes = [
  {
    name: "哔哩哔哩用户动态",
    path: "/bilibili/:userid/dynamic",
    url: "space.bilibili.com",
    maintainers: ["findrss"],
    example: "/bilibili/650898515/dynamic",
    parameters: {
      userid: "UP 主数字 UID",
      offset: "下一页游标，默认读取最新一页",
    },
    description:
      "读取用户动态，保留图文、视频卡片、专栏和转发；Cookie 须由管理员确认后显式获取。",
    handler: (ctx) => dynamic_script.run(ctx),
  },
  {
    name: "哔哩哔哩用户视频",
    path: "/bilibili/:userid/upload/video",
    url: "space.bilibili.com",
    maintainers: ["findrss"],
    example: "/bilibili/650898515/upload/video",
    parameters: {
      userid: "UP 主数字 UID",
      pn: "页码，默认 1",
      ps: "每页视频数量，默认 30，最多 50",
    },
    description:
      "通过 WBI 签名接口获取 UP 主投稿视频；登录 Cookie 由脚本显式申请并经管理员确认授权。",
    handler: (ctx) => video_script.run(ctx),
  },
];
