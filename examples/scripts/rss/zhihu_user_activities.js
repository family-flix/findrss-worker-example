/** RSS */
import { utils } from '@findrss/util';
export const permissions = {
  "cookies": [{
    "id": "account_0",
    "origin": "https://www.zhihu.com",
    "path_prefix": "/",
    "names": ["z_c0", "d_c0", "__zse_ck", "_xsrf"],
    "purpose": "读取用户授权的 知乎用户动态 页面或接口"
  }]
};
export class ZhihuUserActivitiesRSS extends RSSScript {
  async fetch(ctx) {
    try {
      const id = String((ctx.params?.id || ""));
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) {
        return Result.Err("id 必须为知乎用户主页中的字母、数字、下划线或连字符标识", "INVALID_PARAMETER");
      }
      const limit = String((ctx.query?.limit ?? "20"));
      if (((!/^\d+$/.test(limit) || Number(limit) < 1) || Number(limit) > 50)) {
        return Result.Err("limit 必须为 1–50 的整数", "INVALID_PARAMETER");
      }
      const homepage = "https://www.zhihu.com/people/" + id;
      let result;
      try {
        const result_1 = await ZhihuUserActivitiesRSS.request_text(ctx, "https://www.zhihu.com/api/v3/moments/" + id + "/activities?limit=" + Number(limit) + "&desktop=true&ws_qiangzhisafe=0", {
          headers: ZhihuUserActivitiesRSS.request_headers(homepage)
        });
        if (result_1.error) throw result_1.error;
        const text = result_1.data;
        try {
          const result_2 = parseJSON(text);
          if (result_2.error) throw result_2.error;
          result = result_2.data;
        } catch {
          throw Object.assign(new Error("接口返回非 JSON 内容，可能为登录或验证码页面"), {
            name: 'FeedError',
            code: 'UPSTREAM_INVALID_RESPONSE'
          });
        }
        if (result?.error) {
          throw Object.assign(new Error("知乎接口拒绝请求，请检查登录状态、账号权限或上游验证"), {
            name: 'FeedError',
            code: "UPSTREAM_ACCESS_DENIED"
          });
        }
        if (!Array.isArray(result?.data)) {
          throw Object.assign(new Error("接口缺少 data 动态数组"), {
            name: 'FeedError',
            code: 'UPSTREAM_INVALID_RESPONSE'
          });
        }
      } catch (error) {
        return Result.Err("知乎动态读取失败：" + ((error.message || "请求或响应解析失败")) + "；请在 Cookie 管理同步有效的 zhihu.com 登录 Cookie，风控验证需手动完成。", error.code ?? "UPSTREAM_INVALID_RESPONSE");
      }
      const actor = (result.data.find(function(value) {
        return value?.actor;
      })?.actor || {
        name: id,
      });
      const seen = new Set();
      const items = [];
      for (const activity of result.data.slice(0, Number(limit))) {
        if ((!activity || !activity.target)) {
          continue;
        }
        const item = ZhihuUserActivitiesRSS.activity_item(activity, (activity.actor || actor), homepage);
        if (!seen.has(item.id)) {
          seen.add(item.id);
          items.push(item);
        }
      }
      return Result.Ok({
        id: "zhihu:activities:" + id,
        title: ((actor.name || id)) + " 的知乎动态",
        link: homepage + "/activities",
        description: ((actor.headline || actor.description) || "知乎用户 " + id + " 的动态"),
        language: "zh-cn",
        author: {
          name: (actor.name || id),
          uri: homepage
        },
        image: (ZhihuUserActivitiesRSS.public_url(actor.avatar_url) || ((ctx.public_origin || "")) + "/findrss-logo.png"),
        updated: (items[0]?.published || null),
        items,
        extra: {
          view: "timeline",
          show_thumbnails: true,
          proxy_images: true,
          headers: {
            referer: "https://www.zhihu.com/"
          },
          tags: ["知乎"],
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
  static request_headers(link) {
    return {
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
      Referer: link,
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36",
      "sec-ch-ua": '"Chromium";v="154", "Google Chrome";v="154", "Not A(Brand";v="99"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"macOS"',
      "sec-fetch-dest": "empty",
      "sec-fetch-mode": "cors",
      "sec-fetch-site": "same-origin",
    };
  }
  static activity_item(activity, actor, homepage) {
    const target = (activity.target || {});
    const id = String((target.id || ""));
    const type = String((target.type || ""));
    let title = ((((target.title || target.name) || target.subject) || target.excerpt_title) || "");
    let content = (typeof target.content === "string" ? target.content : ((((target.detail || target.description) || target.introduction) || target.intro) || ""));
    let link = "";
    let image = ZhihuUserActivitiesRSS.public_url((target.image_url || target.thumbnail));
    const safe_id = /^[A-Za-z0-9_-]+$/.test(id);
    if (safe_id) {
      if ((type === "answer" && /^\d+$/.test(String((target.question?.id || ""))))) {
        title = target.question.title;
        link = "https://www.zhihu.com/question/" + target.question.id + "/answer/" + id;
      } else {
        if (type === "article") {
          link = "https://zhuanlan.zhihu.com/p/" + id;
        } else {
          if (["question", "pin", "collection", "topic", "roundtable"].includes(type)) {
            link = "https://www.zhihu.com/" + type + "/" + id;
          } else {
            if (type === "column") {
              link = "https://zhuanlan.zhihu.com/" + id;
            } else {
              if (type === "live") {
                link = "https://www.zhihu.com/lives/" + id;
              } else {
                if ((type === "people" || type === "member")) {
                  link = "https://www.zhihu.com/people/" + encodeURIComponent((target.url_token || id));
                }
              }
            }
          }
        }
      }
    }
    if ((type === "pin" && Array.isArray(target.content))) {
      content = target.content.map(function(part) {
        if (part.type === "text") {
          return "<p>" + utils.escape_html(((part.own_text || part.text) || "")).replace(/\n/g, "<br>") + "</p>";
        }
        const url = ZhihuUserActivitiesRSS.public_url(part.url);
        if ((part.type === "image" && url)) {
          if (!image) {
            image = url;
          }
          return '<p><img src="' + utils.escape_html(url) + '"></p>';
        }
        if (url) {
          return '<p><a href="' + utils.escape_html(url) + '">' + utils.escape_html((part.title || url)) + "</a></p>";
        }
        return "";
      }).join("");
    }
    link = ((link || ZhihuUserActivitiesRSS.public_url(target.url)) || homepage + "/activities");
    const action = String(((activity.action_text || activity.verb) || "发布动态"));
    const published = (activity.created_time || activity.created_at);
    const activity_id = (activity.id || [(activity.verb || action), type, id, published].join(":"));
    return {
      id: "zhihu:activity:" + activity_id,
      title: String((actor.name || "")) + action + "：" + ((((utils.plain_text(title) || utils.plain_text((target.excerpt || content)).slice(0, 100)) || type) || "动态")),
      link,
      author: (target.author?.name || actor.name),
      published,
      description: utils.plain_text((target.excerpt || content)),
      content: String((content || "")),
      image: (image || undefined),
    };
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
const script = new ZhihuUserActivitiesRSS();
export const route = {
  "name": "知乎用户动态",
  "path": "/zhihu/people/activities/:id",
  "url": "www.zhihu.com",
  "maintainers": ["findrss"],
  "example": "/zhihu/people/activities/80-81-1-25-44",
  "parameters": {
    "id": "用户主页 /people/ 后的标识",
    "limit": "动态数量，默认 20，最多 50"
  },
  "description": "通过知乎动态接口获取用户活动，登录 Cookie 由脚本显式申请并经管理员确认授权。",
  handler: ctx => script.run(ctx),
};
