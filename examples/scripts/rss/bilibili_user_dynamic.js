/** RSS */
import { utils } from '@findrss/util';
export const permissions = {
  "cookies": [{
    "id": "account_0",
    "origin": "https://api.bilibili.com",
    "path_prefix": "/",
    "names": ["SESSDATA", "bili_jct", "DedeUserID", "buvid3", "buvid4"],
    "purpose": "读取用户授权的 哔哩哔哩用户动态 页面或接口"
  }]
};
export class BilibiliUserDynamicRSS extends RSSScript {
  async fetch(ctx) {
    try {
      const uid = String((ctx.params?.uid || ""));
      const offset = String((ctx.query?.offset || ""));
      if (!/^\d{1,20}$/.test(uid)) {
        return Result.Err("uid 必须为数字", "INVALID_PARAMETER");
      }
      if ((offset && !/^\d{1,30}$/.test(offset))) {
        return Result.Err("offset 必须为数字游标", "INVALID_PARAMETER");
      }
      const homepage = "https://space.bilibili.com/" + uid;
      const link = homepage + "/dynamic";
      let result;
      try {
        const result_1 = await BilibiliUserDynamicRSS.request_text(ctx, "https://api.bilibili.com/x/polymer/web-dynamic/v1/feed/space?host_mid=" + uid + "&timezone_offset=-480&features=itemOpusStyle" + ((offset ? "&offset=" + offset : "")), {
          headers: {
            Accept: "application/json, text/plain, */*",
            Referer: link,
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36",
          },
        });
        if (result_1.error) throw result_1.error;
        const text = result_1.data;
        try {
          const result_2 = parseJSON(text);
          if (result_2.error) throw result_2.error;
          result = result_2.data;
        } catch {
          throw Object.assign(new Error("接口返回非 JSON 内容，可能为验证页"), {
            name: 'FeedError',
            code: 'UPSTREAM_INVALID_RESPONSE'
          });
        }
        if (result?.code !== 0) {
          throw Object.assign(new Error("接口拒绝请求（" + result?.code + "）：" + "请检查登录状态、账号权限或上游验证"), {
            name: 'FeedError',
            code: 'UPSTREAM_INVALID_RESPONSE'
          });
        }
        if (!Array.isArray(result.data?.items)) {
          throw Object.assign(new Error("接口缺少 data.items 动态数组"), {
            name: 'FeedError',
            code: 'UPSTREAM_INVALID_RESPONSE'
          });
        }
      } catch (error) {
        return Result.Err("B 站动态读取失败：" + ((error.message || "请求或响应解析失败")) + "；请同步有效的 .bilibili.com Cookie，或完成上游验证后重试。", error.code ?? "UPSTREAM_INVALID_RESPONSE");
      }
      const seen = new Set();
      const items = [];
      for (const card of result.data.items) {
        if ((!card || typeof card !== "object")) {
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
      items.sort(function(a, b) {
        return ((Number(b.published) || 0)) - ((Number(a.published) || 0));
      });
      const author = result.data.items.find(function(card) {
        return String((card?.modules?.module_author?.mid || "")) === uid;
      })?.modules.module_author;
      ctx.log("B 站动态分页", {
        has_more: result.data.has_more,
        offset: result.data.offset,
      });
      return Result.Ok({
        id: "bilibili:dynamic:channel:" + uid,
        title: ((author?.name || uid)) + " 的 B 站动态",
        link,
        description: "UP 主 " + uid + " 的最新动态",
        language: "zh-cn",
        author: {
          name: String((author?.name || uid)),
          uri: homepage
        },
        image: (BilibiliUserDynamicRSS.public_url(author?.face) || ((ctx.public_origin || "")) + "/findrss-logo.png"),
        updated: (items[0]?.published || null),
        items,
        extra: {
          view: "timeline",
          show_thumbnails: true,
          proxy_images: true,
          headers: {
            referer: "https://www.bilibili.com/"
          },
          tags: ["哔哩哔哩"],
        },
      });
    } catch (error) {
      return Result.Err(error, error?.code ?? "UPSTREAM_INVALID_RESPONSE");
    }
  }
  static public_url(value) {
    const url = String((value || "")).replace(/^\/\//, "https://");
    return (/^https?:\/\//i.test(url) ? url : "");
  }
  static dynamic_body(card) {
    const dynamic = (card?.modules?.module_dynamic || {});
    const major = (dynamic.major || {});
    const opus = major.opus;
    const archive = major.archive;
    const article = major.article;
    const common = major.common;
    const title = String(((((opus?.title || archive?.title) || article?.title) || common?.title) || ""));
    const text = String((((((dynamic.desc?.text || opus?.summary?.text) || archive?.desc) || article?.desc) || common?.desc) || ""));
    const pictures = ((major.draw?.items || opus?.pics) || []);
    const images = [...new Set(
      ((Array.isArray(pictures) ? pictures : [])).map(function(pic) {
        return BilibiliUserDynamicRSS.public_url((pic?.src || pic?.url));
      }).filter(Boolean), ), ];
    const covers = article?.covers;
    const image = (images[0] || BilibiliUserDynamicRSS.public_url(((archive?.cover || (Array.isArray(covers) ? covers[0] : "")) || common?.cover)));
    return {
      title,
      text,
      images,
      image,
      link: BilibiliUserDynamicRSS.public_url((((archive?.jump_url || article?.jump_url) || common?.jump_url) || opus?.jump_url)),
    };
  }
  static dynamic_item(card, uid) {
    try {
      const id = String((card.id_str || ""));
      if (!/^\d+$/.test(id)) {
        return Result.Err("B 站动态缺少有效的 id_str", 'UPSTREAM_INVALID_RESPONSE');
      }
      const author = (card.modules?.module_author || {});
      const body = BilibiliUserDynamicRSS.dynamic_body(card);
      const original = (card.orig ? BilibiliUserDynamicRSS.dynamic_body(card.orig) : null);
      const quoted = (original ? "转发 @" + ((card.orig.modules?.module_author?.name || "原作者")) + "：" + (((original.text || original.title) || "原动态不可访问")) : "");
      const description = [(body.text || body.title), quoted].filter(Boolean).join("\n\n");
      const images = [...new Set([...body.images, ...((original?.images || []))])];
      const original_link = (original?.link || (card.orig?.id_str ? "https://t.bilibili.com/" + card.orig.id_str : ""));
      let content = "<p>" + utils.escape_html((body.text || body.title)).replace(/\n/g, "<br>") + "</p>";
      if (quoted) {
        content += "<blockquote>" + utils.escape_html(quoted).replace(/\n/g, "<br>") + "</blockquote>";
      }
      const target = (body.link || original_link);
      if (target) {
        content += '<p><a href="' + utils.escape_html(target) + '">查看原文</a></p>';
      }
      return Result.Ok({
        id: "bilibili:dynamic:" + id,
        link: "https://t.bilibili.com/" + id,
        title: (Array.from((body.title || description)).slice(0, 100).join("") || "B 站动态 " + id),
        description,
        content,
        published: (author.pub_ts || undefined),
        author: {
          name: String((author.name || uid)),
          uri: "https://space.bilibili.com/" + ((author.mid || uid)),
        },
        image: ((body.image || original?.image) || undefined),
        images,
        categories: (card.type ? [String(card.type)] : []),
      });
    } catch (error) {
      return Result.Err(error, error?.code ?? "UPSTREAM_INVALID_RESPONSE");
    }
  }
  static async request_text(ctx, url, options = {}) {
    const permission = permissions.cookies.find(entry => String(url).startsWith(entry.origin + '/'));
    if (permission) {
      const acquired = await ctx.cookies.get(permission.id);
      if (acquired.error) return acquired;
      return utils.request_text(ctx, url, {
        ...options,
        cookies: acquired.data
      });
    }
    return utils.request_text(ctx, url, options);
  }
}
const script = new BilibiliUserDynamicRSS();
export const route = {
  "name": "哔哩哔哩用户动态",
  "path": "/bilibili/user/dynamic/:uid",
  "url": "space.bilibili.com",
  "maintainers": ["findrss"],
  "example": "/bilibili/user/dynamic/650898515",
  "parameters": {
    "uid": "UP 主数字 UID",
    "offset": "下一页游标，默认读取最新一页"
  },
  "description": "读取用户动态，保留图文、视频卡片、专栏和转发；Cookie 须由管理员确认后显式获取。",
  handler: ctx => script.run(ctx),
};
