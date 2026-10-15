/** RSS */
import { utils } from '@findrss/util';
export const permissions = {
  "cookies": [{
    "id": "account_0",
    "origin": "https://www.kuaishou.com",
    "path_prefix": "/",
    "names": ["kwfv1", "did", "userId", "kuaishou.server.web_st"],
    "purpose": "读取用户授权的 快手用户作品 页面或接口"
  }]
};
export class KuaishouUserRSS extends RSSScript {
  async fetch(ctx) {
    try {
      const user_id = String((ctx.params?.user_id || ""));
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(user_id)) {
        return Result.Err("user_id 无效", "INVALID_PARAMETER");
      }
      const link = "https://www.kuaishou.com/profile/" + user_id;
      let result;
      try {
        const result_1 = await KuaishouUserRSS.request_text(ctx, "https://www.kuaishou.com/rest/v/profile/feed", {
          method: "POST",
          body: JSON.stringify({
            user_id,
            pcursor: "",
            page: "profile"
          }),
          cookie_headers: {
            kww: "kwfv1"
          },
          headers: {
            Accept: "application/json, text/plain, */*",
            "Content-Type": "application/json",
            Origin: "https://www.kuaishou.com",
            Referer: link,
            profile_referer: "",
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36",
          },
        });
        if (result_1.error) throw result_1.error;
        const result_2 = parseJSON(result_1.data);
        if (result_2.error) throw result_2.error;
        result = result_2.data;
        if ((result.result !== 1 || !Array.isArray(result.feeds))) {
          throw Object.assign(new Error("快手接口拒绝请求或未返回作品列表，请检查登录状态与上游验证"), {
            name: 'FeedError',
            code: 'UPSTREAM_INVALID_RESPONSE'
          });
        }
      } catch (error) {
        return Result.Err("快手作品读取失败：" + ((error.message || "请求或响应解析失败")) + "；请同步含 kwfv1 的有效 kuaishou.com Cookie", error.code ?? "UPSTREAM_INVALID_RESPONSE");
      }
      const account = (result.feeds.find(function(feed) {
        return feed.author?.id === user_id;
      })?.author || {});
      const name = String((account.name || user_id));
      const seen = new Set();
      const items = [];
      for (const entry of result.feeds) {
        const photo = (entry.photo || {});
        const id = String((photo.id || ""));
        if ((!/^[A-Za-z0-9_-]{1,128}$/.test(id) || (typeof photo.id === "number" && !Number.isSafeInteger(photo.id)))) {
          return Result.Err("快手作品缺少有效 ID", 'UPSTREAM_INVALID_RESPONSE');
        }
        if (seen.has(id)) {
          continue;
        }
        seen.add(id);
        const description = String(((photo.caption || photo.originCaption) || ""));
        const video = KuaishouUserRSS.public_url(photo.photoUrl);
        const published = Number(photo.timestamp);
        items.push({
          id: "kuaishou:photo:" + id,
          title: (description || "快手作品 " + id),
          link: "https://www.kuaishou.com/short-video/" + id,
          description,
          image: (KuaishouUserRSS.public_url(photo.coverUrl) || undefined),
          author: {
            name: String((entry.author?.name || name)),
            uri: link
          },
          ...(((Number.isFinite(published) && published > 0) ? {
            published
          } : {})),
          ...(((video && !String(entry.type).toUpperCase().includes("IMAGE")) ? {
            enclosure: {
              url: video,
              type: "video/mp4"
            }
          } : {})),
        });
      }
      items.sort(function(a, b) {
        return ((b.published || 0)) - ((a.published || 0));
      });
      return Result.Ok({
        id: "kuaishou:user:" + user_id,
        title: name + " 的快手作品",
        link,
        description: "",
        language: "zh-cn",
        author: {
          name,
          uri: link
        },
        image: (KuaishouUserRSS.public_url(account.headerUrl) || ((ctx.public_origin || "")) + "/findrss-logo.png"),
        updated: (items[0]?.published || null),
        items,
        extra: {
          view: "video",
          show_thumbnails: true,
          proxy_images: true,
          headers: {
            referer: "https://www.kuaishou.com/"
          },
          tags: ["快手"]
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
const script = new KuaishouUserRSS();
export const route = {
  "name": "快手用户作品",
  "path": "/kuaishou/user/:user_id",
  "url": "www.kuaishou.com",
  "maintainers": ["findrss"],
  "example": "/kuaishou/user/3x6p5n7example",
  "parameters": {
    "user_id": "主页 /profile/ 后的用户 ID"
  },
  "description": "通过 profile/feed POST 接口获取最新一页作品；请同步含 kwfv1 的有效快手 Cookie。",
  handler: ctx => script.run(ctx),
};
