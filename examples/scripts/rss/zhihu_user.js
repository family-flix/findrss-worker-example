import { utils } from "@findrss/util";

export const permissions = {
  cookies: [
    {
      id: "account_0",
      origin: "https://www.zhihu.com",
      path_prefix: "/",
      names: ["z_c0", "d_c0", "__zse_ck", "_xsrf"],
      purpose: "读取用户授权的 知乎用户作品 页面或接口",
    },
    {
      id: "account_1",
      origin: "https://zhuanlan.zhihu.com",
      path_prefix: "/",
      names: ["z_c0", "d_c0", "__zse_ck", "_xsrf"],
      purpose: "读取用户授权的知乎专栏",
    },
    {
      id: "account_2",
      origin: "https://api.zhihu.com",
      path_prefix: "/pins/",
      names: ["z_c0", "d_c0", "__zse_ck", "_xsrf"],
      purpose: "读取用户授权的知乎想法",
    },
  ],
};
export class ZhihuUserRSS extends RSSScript {
  constructor(kind) {
    super();
    this.kind = kind;
  }
  async fetch(ctx) {
    try {
      const kind = this.kind;
      const parameter = kind === "column" ? "column_id" : kind === "collection" ? "collection_id" : "user_id";
      const id = String(ctx.params?.[parameter] || "");
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) {
        return Result.Err(parameter + " 无效", "INVALID_PARAMETER");
      }
      if (kind === "collection" && !/^\d+$/.test(id)) {
        return Result.Err("collection_id 必须为数字", "INVALID_PARAMETER");
      }
      const homepage = kind === "column"
        ? (id.startsWith("c_") ? "https://www.zhihu.com/column/" : "https://zhuanlan.zhihu.com/") + id
        : "https://www.zhihu.com/" + (kind === "collection" ? "collection/" : "people/") + id;
      const link = ["column", "collection", "activities"].includes(kind) ? homepage : homepage + "/" + kind;
      const query = {
        limit: "20",
        offset: "0",
      };
      if (kind === "answers") {
        query.sort_by = "created";
        query.include =
          "data[*].excerpt,comment_count,created_time,updated_time;data[*].question.title";
      }
      if (kind === "posts") {
        query.sort_by = "created";
        query.include =
          "data[*].excerpt,comment_count,voteup_count,created,updated";
      }
      if (kind === "zvideos") {
        query.similar_aggregation = "true";
      }
      if (kind === "activities") {
        query.desktop = "true";
        query.ws_qiangzhisafe = "0";
      }
      const endpoint = kind === "activities"
        ? "https://www.zhihu.com/api/v3/moments/" + id + "/activities"
        : kind === "column"
          ? "https://zhuanlan.zhihu.com/api/columns/" + id + "/items"
          : kind === "collection"
            ? "https://www.zhihu.com/api/v4/collections/" + id + "/items"
            : kind === "pins"
              ? "https://api.zhihu.com/pins/" + id + "/moments"
              : "https://www.zhihu.com/api/v4/members/" + id + "/" + ({ posts: "articles", asks: "questions" }[kind] || kind);
      let result;
      try {
        const result_1 = await ZhihuUserRSS.request_text(
          ctx,
          endpoint +
            "?" +
            Object.entries(query)
              .map(function ([key, value]) {
                return key + "=" + encodeURIComponent(value);
              })
              .join("&"),
          {
            headers: {
              Accept: "application/json, text/plain, */*",
              Referer: link,
              "Accept-Language": "zh-CN,zh;q=0.9",
              "User-Agent":
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36",
            },
          },
        );
        if (result_1.error) throw result_1.error;
        const result_2 = parseJSON(result_1.data);
        if (result_2.error) throw result_2.error;
        result = result_2.data;
        if (result?.need_force_login) {
          throw Object.assign(
            new Error("知乎要求登录，请同步有效的 zhihu.com Cookie"),
            {
              name: "FeedError",
              code: "UPSTREAM_AUTH_REQUIRED",
            },
          );
        }
        if (result?.error || !Array.isArray(result?.data)) {
          throw Object.assign(
            new Error(
              "知乎接口拒绝请求或没有返回作品列表，请检查账号权限与上游验证",
            ),
            {
              name: "FeedError",
              code: "UPSTREAM_INVALID_RESPONSE",
            },
          );
        }
      } catch (error) {
        return Result.Err(
          "知乎作品读取失败：" +
            (error.message || "请求或响应解析失败") +
            "；请同步有效的 zhihu.com Cookie 并检查上游风控",
          error.code ?? "UPSTREAM_INVALID_RESPONSE",
        );
      }
      const account =
        result.data.find(function (item) {
          return item?.actor || item?.author || item?.target?.author || item?.content?.author;
        });
      const author = account?.actor || account?.author || account?.target?.author || account?.content?.author || {};
      const name = String(author.name || id);
      const seen = new Set();
      const items = [];
      for (const entry of result.data) {
        if (kind === "activities" && !entry?.target) continue;
        const converted = ZhihuUserRSS.item(entry, kind, name, homepage);
        if (converted.error) return converted;
        const item = converted.data;
        if (seen.has(item.id)) {
          continue;
        }
        seen.add(item.id);
        items.push(item);
      }
      items.sort(function (a, b) {
        return (b.published || 0) - (a.published || 0);
      });
      return Result.Ok({
        id: ["column", "collection"].includes(kind) ? "zhihu:" + kind + ":" + id : "zhihu:user:" + id + ":" + kind,
        title: ["column", "collection"].includes(kind) ? "知乎" + (kind === "column" ? "专栏 " : "收藏夹 ") + id
          : name + " 的知乎" + {
            activities: "动态",
            answers: "回答",
            posts: "文章",
            zvideos: "视频",
            asks: "提问",
            pins: "想法",
          }[kind],
        link,
        description: String(author.headline || ""),
        language: "zh-cn",
        author: {
          name,
          uri: homepage,
        },
        image:
          ZhihuUserRSS.public_url(author.avatar_url) ||
          (ctx.public_origin || "") + "/findrss-logo.png",
        updated: items[0]?.updated || items[0]?.published || null,
        items,
        extra: {
          view: kind === "zvideos" ? "video" : kind === "activities" ? "timeline" : "article",
          show_thumbnails: true,
          proxy_images: true,
          headers: {
            referer: "https://www.zhihu.com/",
          },
          tags: ["知乎"],
        },
      });
    } catch (error) {
      return Result.Err(error, error?.code ?? "UPSTREAM_INVALID_RESPONSE");
    }
  }
  static item(row, kind, name, homepage) {
    const entry = kind === "activities" ? row.target : kind === "collection" ? row?.content : kind === "pins" ? row?.target || row : row;
    const type = entry?.type || { answers: "answer", posts: "article", zvideos: "zvideo", asks: "question", pins: "pin" }[kind];
    const identity = ["column", "roundtable", "people", "member"].includes(type)
      ? (/^[A-Za-z0-9_-]{1,128}$/.test(String(entry?.id || "")) ? Result.Ok(String(entry.id)) : Result.Err("知乎条目 ID 无效", "UPSTREAM_INVALID_RESPONSE"))
      : ZhihuUserRSS.numeric_id(entry?.id);
    if (identity.error) return identity;
    const id = identity.data;
    let link;
    let title = entry.title || entry.question?.title || entry.name || entry.subject || entry.excerpt_title;
    let content = typeof entry.content === "string" ? entry.content : entry.detail || entry.description || "";
    let image = ZhihuUserRSS.public_url(entry.image_url || entry.thumbnail);
    if (type === "answer") {
      const question = ZhihuUserRSS.numeric_id(entry.question?.id);
      if (question.error) return question;
      link = "https://www.zhihu.com/question/" + question.data + "/answer/" + id;
    } else if (type === "article") {
      link = "https://zhuanlan.zhihu.com/p/" + id;
    } else if (["question", "pin", "zvideo", "collection", "topic", "roundtable"].includes(type)) {
      link = "https://www.zhihu.com/" + type + "/" + id;
    } else if (type === "column") {
      link = "https://zhuanlan.zhihu.com/" + id;
    } else if (type === "live") {
      link = "https://www.zhihu.com/lives/" + id;
    } else if (["people", "member"].includes(type)) {
      link = "https://www.zhihu.com/people/" + encodeURIComponent(entry.url_token || id);
    } else {
      link = ZhihuUserRSS.public_url(entry.url);
      if (!link) return Result.Err("知乎条目类型或原文链接无效", "UPSTREAM_INVALID_RESPONSE");
    }
    if (type === "pin" && Array.isArray(entry.content)) {
      content = entry.content.map(part => {
        if (part.type === "text") return "<p>" + utils.escape_html(part.own_text || part.text || "").replace(/\n/g, "<br>") + "</p>";
        const url = ZhihuUserRSS.public_url(part.url);
        if (!url) return "";
        if (part.type === "image") {
          if (!image) image = url;
          return '<p><img src="' + utils.escape_html(url) + '"></p>';
        }
        return '<p><a href="' + utils.escape_html(url) + '">' + utils.escape_html(part.title || url) + "</a></p>";
      }).join("");
    }
    title = String(title || utils.plain_text(entry.excerpt || content).slice(0, 100) || "知乎作品 " + id);
    const published = Number(kind === "activities" ? row.created_time || row.created_at : entry.created_time || entry.created || entry.published_at || entry.created_at);
    const updated = Number(entry.updated_time || entry.updated || entry.updated_at);
    return Result.Ok({
      id: kind === "activities" ? "zhihu:activity:" + (row.id || [row.verb, type, id, published || ""].join(":")) : "zhihu:" + type + ":" + id,
      title: kind === "activities" ? String(row.actor?.name || name) + String(row.action_text || row.verb || "发布动态") + "：" + title : title,
      link,
      description: String(entry.excerpt || entry.description || utils.plain_text(content)),
      content: content || undefined,
      author: { name: String(entry.author?.name || name), uri: ZhihuUserRSS.public_url(entry.author?.url) || homepage },
      image: image || undefined,
      ...(Number.isFinite(published) && published > 0 ? { published } : {}),
      ...(Number.isFinite(updated) && updated > 0 ? { updated } : {}),
    });
  }
  static public_url(value) {
    const url = String(value || "").replace(/^\/\//, "https://");
    return /^https?:\/\//i.test(url) ? url : "";
  }
  static numeric_id(value) {
    try {
      if (typeof value === "number" && !Number.isSafeInteger(value)) {
        return Result.Err(
          "知乎作品 ID 必须以字符串返回",
          "UPSTREAM_INVALID_RESPONSE",
        );
      }
      const id = String(value || "");
      if (!/^\d+$/.test(id)) {
        return Result.Err("知乎作品 ID 无效", "UPSTREAM_INVALID_RESPONSE");
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
export const routes = [
  ["activities", "用户动态", "/people/:user_id", "/people/zhihu", "user_id"],
  ["answers", "用户回答", "/people/:user_id/answers", "/people/zhihu/answers", "user_id"],
  ["zvideos", "用户视频", "/people/:user_id/zvideos", "/people/zhihu/zvideos", "user_id"],
  ["asks", "用户提问", "/people/:user_id/asks", "/people/zhihu/asks", "user_id"],
  ["posts", "用户文章", "/people/:user_id/posts", "/people/zhihu/posts", "user_id"],
  ["column", "专栏", "/column/:column_id", "/column/googledevelopers", "column_id"],
  ["pins", "用户想法", "/people/:user_id/pins", "/people/zhihu/pins", "user_id"],
  ["collection", "收藏夹", "/collection/:collection_id", "/collection/26444956", "collection_id"],
].map(([kind, name, path, example, parameter]) => {
  const script = new ZhihuUserRSS(kind);
  return {
    name: "知乎" + name,
    path: "/zhihu" + path,
    url: "www.zhihu.com",
    platform: "知乎",
    maintainers: [{ nickname: "findrss", url: "", avatar: "" }],
    example: "/zhihu" + example,
    parameters: { [parameter]: { user_id: "用户主页 /people/ 后的标识", column_id: "专栏主页中的标识", collection_id: "收藏夹页面中的数字 ID" }[parameter] },
    description: "读取最新一页" + name + "；Cookie 须由管理员确认后显式获取。",
    handler: ctx => script.run(ctx),
  };
});
