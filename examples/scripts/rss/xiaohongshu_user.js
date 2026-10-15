/** RSS */
import { utils } from '@findrss/util';
export const permissions = {
  "cookies": [{
    "id": "account_0",
    "origin": "https://www.xiaohongshu.com",
    "path_prefix": "/",
    "names": ["web_session", "a1", "webId", "gid"],
    "purpose": "读取用户授权的 小红书用户笔记 页面或接口"
  }]
};
export class XiaohongshuUserRSS extends RSSScript {
  async fetch(ctx) {
    try {
      const uid = String((ctx.params?.uid || "")).toLowerCase();
      if (!/^[a-f0-9]{24}$/.test(uid)) {
        return Result.Err("uid 必须为用户主页中的 24 位十六进制 ID", "INVALID_PARAMETER");
      }
      const link = "https://www.xiaohongshu.com/user/profile/" + uid;
      let user;
      try {
        const result_1 = await XiaohongshuUserRSS.request_text(ctx, link, {
          headers: {
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            Referer: "https://www.xiaohongshu.com/",
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36",
          },
        });
        if (result_1.error) throw result_1.error;
        const html = result_1.data;
        const result_2 = XiaohongshuUserRSS.initial_state(html);
        if (result_2.error) throw result_2.error;
        user = result_2.data?.user;
        if ((!user?.userPageData?.basicInfo || !Array.isArray(user.notes))) {
          throw Object.assign(new Error("初始状态缺少用户资料或 notes 笔记数组"), {
            name: 'FeedError',
            code: 'UPSTREAM_INVALID_RESPONSE'
          });
        }
      } catch (error) {
        return Result.Err("小红书笔记读取失败：" + ((error.message || "请求或响应解析失败")) + "；请同步有效的 xiaohongshu.com Cookie，风控验证需手动完成。", error.code ?? "UPSTREAM_INVALID_RESPONSE");
      }
      const basic = user.userPageData.basicInfo;
      const name = String((basic.nickname || uid));
      const seen = new Set();
      const items = [];
      for (const entry of user.notes.flat()) {
        const card = (entry?.noteCard || entry?.note_card);
        if (!card) {
          continue;
        }
        const id = String((((card.noteId || card.note_id) || entry.id) || "")).toLowerCase();
        if (!/^[a-f0-9]{24}$/.test(id)) {
          return Result.Err("小红书笔记缺少有效的 noteId", 'UPSTREAM_INVALID_RESPONSE');
        }
        if (seen.has(id)) {
          continue;
        }
        seen.add(id);
        const token = String(((((entry.xsecToken || entry.xsec_token) || card.xsecToken) || card.xsec_token) || ""));
        const note_link = "https://www.xiaohongshu.com/explore/" + id + ((token ? "?xsec_token=" + encodeURIComponent(token) + "&xsec_source=pc_user" : ""));
        const image = XiaohongshuUserRSS.cover_url(card.cover);
        const title = String((((card.displayTitle || card.display_title) || card.title) || "小红书笔记 " + id));
        const video = XiaohongshuUserRSS.public_url(((card.video?.consumer?.originVideoKey && /^https?:\/\//.test(card.video.consumer.originVideoKey)) ? card.video.consumer.originVideoKey : card.video?.url));
        items.push({
          id: "xiaohongshu:note:" + id,
          title,
          link: note_link,
          description: String((card.desc || title)),
          image: (image || undefined),
          author: {
            name: String((card.user?.nickname || name)),
            uri: link
          },
          ...((video ? {
            enclosure: {
              url: video,
              type: "video/mp4"
            }
          } : {})),
        });
      }
      return Result.Ok({
        id: "xiaohongshu:user:" + uid,
        title: name + " 的小红书笔记",
        link,
        description: String((basic.desc || "")),
        language: "zh-cn",
        author: {
          name,
          uri: link
        },
        image: (XiaohongshuUserRSS.public_url((basic.imageb || basic.images)) || ((ctx.public_origin || "")) + "/findrss-logo.png"),
        updated: (items[0]?.published || null),
        items,
        extra: {
          view: "timeline",
          show_thumbnails: true,
          proxy_images: true,
          headers: {
            referer: "https://www.xiaohongshu.com/"
          },
          tags: ["小红书"],
        },
      });
    } catch (error) {
      return Result.Err(error, error?.code ?? "UPSTREAM_INVALID_RESPONSE");
    }
  }
  static public_url(value) {
    const url = String((value || "")).replace(/^\/\//, "https://").replace(/^http:\/\//, "https://");
    return (/^https:\/\//i.test(url) ? url : "");
  }
  static initial_state(html) {
    try {
      for (const script of String(html).matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)) {
        const match = script[1].match(/^\s*window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*\})\s*;?\s*$/);
        if (!match) {
          continue;
        }
        const json = match[1].replace(/("(?:\\.|[^"\\])*")|\bundefined\b/g, function(value, quoted) {
          return (quoted || "null");
        });
        try {
          const result_3 = parseJSON(json);
          if (result_3.error) throw result_3.error;
          return Result.Ok(result_3.data);
        } catch {
          return Result.Err("小红书初始状态不是可解析的 JSON", 'UPSTREAM_INVALID_RESPONSE');
        }
      }
      return Result.Err("小红书页面缺少 __INITIAL_STATE__，可能为登录或验证页面", 'UPSTREAM_INVALID_RESPONSE');
    } catch (error) {
      return Result.Err(error, error?.code ?? "UPSTREAM_INVALID_RESPONSE");
    }
  }
  static cover_url(cover) {
    const info = (cover?.infoList || cover?.info_list);
    return XiaohongshuUserRSS.public_url((((((Array.isArray(info) ? (info.find(function(item) {
      return item?.imageScene === "WB_DFT";
    })?.url || info[info.length - 1]?.url) : "") || cover?.urlDefault) || cover?.url_default) || cover?.url) || cover?.urlPre));
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
const script = new XiaohongshuUserRSS();
export const route = {
  "name": "小红书用户笔记",
  "path": "/xiaohongshu/user/:uid",
  "url": "www.xiaohongshu.com",
  "maintainers": ["findrss"],
  "example": "/xiaohongshu/user/5d2aec020000000012037401",
  "parameters": {
    "uid": "用户主页 /user/profile/ 后的 24 位十六进制 ID，不是小红书号"
  },
  "description": "解析用户主页内嵌 JSON，读取首屏笔记和封面；Cookie 须由管理员确认后显式获取。",
  handler: ctx => script.run(ctx),
};
