/** HOT */
import { utils } from '@findrss/util';
export const permissions = {
  "cookies": [{
    "id": "account_0",
    "origin": "https://www.instagram.com",
    "path_prefix": "/",
    "names": ["sessionid", "csrftoken", "ds_user_id", "mid", "ig_did"],
    "purpose": "读取用户授权的 Instagram 用户作品 页面或接口"
  }]
};
export class InstagramUserHotRank extends HotRankScript {
  static async fetch_content(ctx) {
    try {
      const username = String((ctx.params?.username || "")).replace(/^@/, "").toLowerCase();
      if ((!/^[a-z0-9_](?:[a-z0-9_.]{0,28}[a-z0-9_])?$/.test(username) || ["accounts", "explore", "reels", "direct", "p", "stories"].includes(username))) {
        return Result.Err("username 必须为有效的 Instagram 用户名", "INVALID_PARAMETER");
      }
      const link = "https://www.instagram.com/" + username + "/";
      const result_1 = await InstagramUserHotRank.request_text(ctx, link, {
        headers: {
          Accept: "text/html,application/xhtml+xml",
          Referer: "https://www.instagram.com/",
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36",
        }
      });
      if (result_1.error) return result_1;
      const html = result_1.data;
      const records = [];
      for (const script of html.matchAll(/<script\b[^>]*\btype\s*=\s*["']application\/json["'][^>]*>([\s\S]*?)<\/script\s*>/gi)) {
        try {
          const result_2 = parseJSON(script[1]);
          if (result_2.error) throw result_2.error;
          records.push(result_2.data);
        } catch {}
      }
      const account = InstagramUserHotRank.find_record(records, function(value) {
        return ((String((value.username || "")).toLowerCase() === username && value.pk !== undefined) && value.full_name !== undefined);
      });
      if (!account) {
        return Result.Err("Instagram 页面缺少账号资料，请同步有效 Cookie 并检查账号访问权限", 'UPSTREAM_INVALID_RESPONSE');
      }
      const result_3 = InstagramUserHotRank.identifier(account.pk);
      if (result_3.error) return result_3;
      const account_id = result_3.data;
      const grid = InstagramUserHotRank.find_record(records, function(value) {
        return (String((value.pk || "")) === account_id && Array.isArray(value.polaris_ordered_timeline_connection?.edges));
      });
      if (!grid) {
        return Result.Err("Instagram 页面缺少作品列表，请同步有效 Cookie 并检查账号访问权限", 'UPSTREAM_INVALID_RESPONSE');
      }
      const name = String((account.full_name || username));
      const seen = new Set();
      const items = [];
      for (const {
          node
        }
        of grid.polaris_ordered_timeline_connection.edges) {
        const result_4 = InstagramUserHotRank.identifier(node?.pk);
        if (result_4.error) return result_4;
        const id = result_4.data;
        const code = String((node?.code || ""));
        if ((!/^[A-Za-z0-9_-]+$/.test(code) || ![1, 2, 8].includes(node.media_type))) {
          return Result.Err("Instagram 作品记录无效", 'UPSTREAM_INVALID_RESPONSE');
        }
        if (seen.has(id)) {
          continue;
        }
        seen.add(id);
        const description = String((node.caption?.text || ""));
        const published = Number(node.taken_at);
        items.push({
          id: "instagram:post:" + id,
          title: (description.split("\n")[0] || "Instagram 作品 " + code),
          link: "https://www.instagram.com/p/" + code + "/",
          description,
          author: {
            name,
            uri: link
          },
          image: (InstagramUserHotRank.media_url(node.display_uri) || undefined),
          ...(((Number.isFinite(published) && published > 0) ? {
            published
          } : {})),
        });
      }
      items.sort(function(a, b) {
        return ((b.published || 0)) - ((a.published || 0));
      });
      return Result.Ok({
        id: "instagram:user:" + account_id,
        title: name + " 的 Instagram 作品",
        link,
        description: String((account.biography || "")),
        language: "",
        author: {
          name,
          uri: link
        },
        image: (InstagramUserHotRank.media_url((account.profile_pic_url || account.profile_image_uri)) || ((ctx.public_origin || "")) + "/findrss-logo.png"),
        updated: (items[0]?.published || null),
        items,
        extra: {
          view: "timeline",
          show_thumbnails: true,
          proxy_images: true,
          headers: {
            referer: "https://www.instagram.com/"
          },
          tags: ["Instagram"]
        },
      });
    } catch (error) {
      return Result.Err(error, error?.code ?? "UPSTREAM_INVALID_RESPONSE");
    }
  }
  static find_record(value, matches) {
    if ((!value || typeof value !== "object")) {
      return null;
    }
    if (matches(value)) {
      return value;
    }
    for (const child of Object.values(value)) {
      const found = InstagramUserHotRank.find_record(child, matches);
      if (found) {
        return found;
      }
    }
    return null;
  }
  static media_url(value) {
    const url = String((value || ""));
    return (/^https:\/\/(?:[a-z0-9-]+\.)*(?:cdninstagram\.com|fbcdn\.net)(?::443)?\//i.test(url) ? url : "");
  }
  static identifier(value) {
    try {
      if ((typeof value === "number" && !Number.isSafeInteger(value))) {
        return Result.Err("Instagram ID 必须以字符串返回", 'UPSTREAM_INVALID_RESPONSE');
      }
      const id = String((value || ""));
      if (!/^\d+$/.test(id)) {
        return Result.Err("Instagram 记录缺少有效 ID", 'UPSTREAM_INVALID_RESPONSE');
      }
      return Result.Ok(id);
    } catch (error) {
      return Result.Err(error, error?.code ?? "UPSTREAM_INVALID_RESPONSE");
    }
  }
  async fetch(ctx) {
    const fetched = await InstagramUserHotRank.fetch_content(ctx);
    if (fetched.error) return fetched;
    const value = fetched.data;
    return Result.Ok({
      title: value.title,
      link: value.link,
      entries: value.items.map(item => ({
        id: item.id,
        title: item.title,
        link: item.link,
        rank: null,
        pinned: false,
        heat: {
          value: null,
          unit: '热度',
          text: ''
        },
      }))
    });
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
const script = new InstagramUserHotRank();
export const route = {
  "name": "Instagram 用户作品",
  "path": "/instagram/user/:username",
  "url": "www.instagram.com",
  "maintainers": ["findrss"],
  "example": "/instagram/user/instagram",
  "parameters": {
    "username": "账号用户名，@ 可省略"
  },
  "description": "解析主页内嵌 Relay JSON，读取首屏作品及封面；Cookie 须由管理员确认后显式获取。",
  handler: ctx => script.run(ctx),
};
