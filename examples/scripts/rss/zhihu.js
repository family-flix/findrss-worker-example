import { utils } from "@findrss/util";

export const version = "1.1.0";
export const platform = {
  name: "知乎",
  icon: '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" data-n="zhihu-platform-icon"><defs data-n="zhihu-icon-defs-1"><linearGradient id="zhihu-bg" x1="0" y1="1" x2="1" y2="0" data-n="zhihu-icon-linearGradient-2"><stop stop-color="#06f" data-n="zhihu-icon-stop-3" /><stop offset=".3" stop-color="#06f" data-n="zhihu-icon-stop-4" /><stop offset="1" stop-color="#00a5ff" data-n="zhihu-icon-stop-5" /></linearGradient></defs><rect width="24" height="24" rx="4.5" fill="url(#zhihu-bg)" data-n="zhihu-icon-rect-6" /><path fill="#fff" d="M7.685 4.078c-.271.73-.5 1.434-.68 2.11h4.587c.545-.006.445 1.168.445 1.171H9.384a58.104 58.104 0 0 1-.112 3.797h2.712c.388.023.393 1.251.393 1.266H9.183a9.223 9.223 0 0 1-.408 2.102l.757-.604c.452.456 1.512 1.712 1.906 2.177.473.681.063 2.081.063 2.081l-2.794-3.382c-.653 2.518-1.845 3.607-1.845 3.607-.523.468-1.58.82-2.64.516 2.218-1.73 3.44-3.917 3.667-6.497H4.491c0-.015.197-1.243.806-1.266h2.71c.024-.32.086-3.254.086-3.797H6.598c-.136.406-.158.447-.268.753-.594 1.095-1.603 1.122-1.907 1.155.906-1.821 1.416-3.6 1.591-4.064.425-1.124 1.671-1.125 1.671-1.125zM13.078 6h6.377v11.33h-2.573l-2.184 1.373-.401-1.373h-1.219zm1.313 1.219v8.86h.623l.263.937 1.455-.938h1.456v-8.86z" data-n="zhihu-icon-path-7" /></svg>',
};

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
export class ZhihuRSS extends RSSScript {
  constructor(kind) {
    super();
    this.kind = kind;
  }
  async fetch(ctx) {
    try {
      const kind = this.kind;
      const parameter =
        kind === "column"
          ? "column_id"
          : kind === "collection"
            ? "collection_id"
            : "user";
      const id = String(ctx.params?.[parameter] || "");
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) {
        return Result.Err(parameter + " 无效", "INVALID_PARAMETER");
      }
      if (kind === "collection" && !/^\d+$/.test(id)) {
        return Result.Err("collection_id 必须为数字", "INVALID_PARAMETER");
      }
      const homepage =
        kind === "column"
          ? (id.startsWith("c_")
              ? "https://www.zhihu.com/column/"
              : "https://zhuanlan.zhihu.com/") + id
          : "https://www.zhihu.com/" +
            (kind === "collection" ? "collection/" : "people/") +
            id;
      const link = ["column", "collection", "activities"].includes(kind)
        ? homepage
        : homepage + "/" + kind;
      const limit =
        kind === "activities" ? String(ctx.query?.limit ?? "20") : "20";
      if (!/^\d+$/.test(limit) || Number(limit) < 1 || Number(limit) > 50) {
        return Result.Err("limit 必须为 1–50 的整数", "INVALID_PARAMETER");
      }
      const query = {
        limit: String(Number(limit)),
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
      const endpoint =
        kind === "activities"
          ? "https://www.zhihu.com/api/v3/moments/" + id + "/activities"
          : kind === "column"
            ? "https://zhuanlan.zhihu.com/api/columns/" + id + "/items"
            : kind === "collection"
              ? "https://www.zhihu.com/api/v4/collections/" + id + "/items"
              : kind === "pins"
                ? "https://api.zhihu.com/pins/" + id + "/moments"
                : "https://www.zhihu.com/api/v4/members/" +
                  id +
                  "/" +
                  ({ posts: "articles", asks: "questions" }[kind] || kind);
      let result;
      try {
        const result_1 = await ZhihuRSS.request_text(
          ctx,
          endpoint +
            "?" +
            Object.entries(query)
              .map(function ([key, value]) {
                return key + "=" + encodeURIComponent(value);
              })
              .join("&"),
          {
            headers: ZhihuRSS.request_headers(link, kind === "activities"),
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
      const account = result.data.find(function (item) {
        return (
          item?.actor ||
          item?.author ||
          item?.target?.author ||
          item?.content?.author
        );
      });
      const author =
        account?.actor ||
        account?.author ||
        account?.target?.author ||
        account?.content?.author ||
        {};
      const name = String(author.name || id);
      const seen = new Set();
      const items = [];
      for (const entry of result.data) {
        if (kind === "activities" && !entry?.target) continue;
        const converted = ZhihuRSS.item(entry, kind, name, homepage);
        if (converted.error) return converted;
        const item = converted.data;
        if (seen.has(item.id)) {
          continue;
        }
        seen.add(item.id);
        items.push(item);
        if (kind === "activities" && items.length >= Number(limit)) break;
      }
      items.sort(function (a, b) {
        return (b.published || 0) - (a.published || 0);
      });
      return Result.Ok({
        id: ["column", "collection"].includes(kind)
          ? "zhihu:" + kind + ":" + id
          : "zhihu:user:" + id + ":" + kind,
        title: ["column", "collection"].includes(kind)
          ? "知乎" + (kind === "column" ? "专栏 " : "收藏夹 ") + id
          : name +
            " 的知乎" +
            {
              activities: "动态",
              answers: "回答",
              posts: "文章",
              zvideos: "视频",
              asks: "提问",
              pins: "想法",
            }[kind],
        link,
        description: String(
          author.headline ||
            (kind === "activities"
              ? author.description || "知乎用户 " + id + " 的动态"
              : ""),
        ),
        language: "zh-cn",
        author: {
          name,
          uri: homepage,
        },
        image:
          ZhihuRSS.public_url(author.avatar_url) ||
          (ctx.public_origin || "") + "/findrss-logo.png",
        updated: items[0]?.updated || items[0]?.published || null,
        items,
        extra: {
          view:
            kind === "zvideos"
              ? "video"
              : kind === "activities"
                ? "timeline"
                : "article",
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
    const entry =
      kind === "activities"
        ? row.target
        : kind === "collection"
          ? row?.content
          : kind === "pins"
            ? row?.target || row
            : row;
    const type =
      entry?.type ||
      {
        answers: "answer",
        posts: "article",
        zvideos: "zvideo",
        asks: "question",
        pins: "pin",
      }[kind];
    const identity = ["column", "roundtable", "people", "member"].includes(type)
      ? /^[A-Za-z0-9_-]{1,128}$/.test(String(entry?.id || ""))
        ? Result.Ok(String(entry.id))
        : Result.Err("知乎条目 ID 无效", "UPSTREAM_INVALID_RESPONSE")
      : ZhihuRSS.numeric_id(entry?.id);
    if (identity.error) return identity;
    const id = identity.data;
    let link;
    let title =
      entry.title ||
      entry.question?.title ||
      entry.name ||
      entry.subject ||
      entry.excerpt_title;
    let content =
      typeof entry.content === "string"
        ? entry.content
        : entry.detail ||
          entry.description ||
          entry.introduction ||
          entry.intro ||
          "";
    let image = ZhihuRSS.public_url(entry.image_url || entry.thumbnail);
    if (type === "answer") {
      const question = ZhihuRSS.numeric_id(entry.question?.id);
      if (question.error) return question;
      link =
        "https://www.zhihu.com/question/" + question.data + "/answer/" + id;
    } else if (type === "article") {
      link = "https://zhuanlan.zhihu.com/p/" + id;
    } else if (
      [
        "question",
        "pin",
        "zvideo",
        "collection",
        "topic",
        "roundtable",
      ].includes(type)
    ) {
      link = "https://www.zhihu.com/" + type + "/" + id;
    } else if (type === "column") {
      link = "https://zhuanlan.zhihu.com/" + id;
    } else if (type === "live") {
      link = "https://www.zhihu.com/lives/" + id;
    } else if (["people", "member"].includes(type)) {
      link =
        "https://www.zhihu.com/people/" +
        encodeURIComponent(entry.url_token || id);
    } else {
      link = ZhihuRSS.public_url(entry.url);
      if (!link)
        return Result.Err(
          "知乎条目类型或原文链接无效",
          "UPSTREAM_INVALID_RESPONSE",
        );
    }
    if (type === "pin" && Array.isArray(entry.content)) {
      content = entry.content
        .map((part) => {
          if (part.type === "text")
            return (
              "<p>" +
              utils
                .escape_html(part.own_text || part.text || "")
                .replace(/\n/g, "<br>") +
              "</p>"
            );
          const url = ZhihuRSS.public_url(part.url);
          if (!url) return "";
          if (part.type === "image") {
            if (!image) image = url;
            return '<p><img src="' + utils.escape_html(url) + '"></p>';
          }
          return (
            '<p><a href="' +
            utils.escape_html(url) +
            '">' +
            utils.escape_html(part.title || url) +
            "</a></p>"
          );
        })
        .join("");
    }
    title = String(
      (kind === "activities" ? utils.plain_text(title) : title) ||
        utils.plain_text(entry.excerpt || content).slice(0, 100) ||
        "知乎作品 " + id,
    );
    const published = Number(
      kind === "activities"
        ? row.created_time || row.created_at
        : entry.created_time ||
            entry.created ||
            entry.published_at ||
            entry.created_at,
    );
    const updated = Number(
      entry.updated_time || entry.updated || entry.updated_at,
    );
    return Result.Ok({
      id:
        kind === "activities"
          ? "zhihu:activity:" +
            (row.id || [row.verb, type, id, published || ""].join(":"))
          : "zhihu:" + type + ":" + id,
      title:
        kind === "activities"
          ? String(row.actor?.name || name) +
            String(row.action_text || row.verb || "发布动态") +
            "：" +
            title
          : title,
      link,
      description: String(
        entry.excerpt || entry.description || utils.plain_text(content),
      ),
      content: content || undefined,
      author: {
        name: String(entry.author?.name || row.actor?.name || name),
        uri: ZhihuRSS.public_url(entry.author?.url) || homepage,
      },
      image: image || undefined,
      ...(Number.isFinite(published) && published > 0 ? { published } : {}),
      ...(Number.isFinite(updated) && updated > 0 ? { updated } : {}),
    });
  }
  static request_headers(link, activities) {
    const headers = {
      Accept: "application/json, text/plain, */*",
      "Accept-Language": activities
        ? "zh-CN,zh;q=0.9,en;q=0.8"
        : "zh-CN,zh;q=0.9",
      Referer: link,
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36",
    };
    if (activities) {
      Object.assign(headers, {
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
        "sec-ch-ua":
          '"Chromium";v="154", "Google Chrome";v="154", "Not A(Brand";v="99"',
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": '"macOS"',
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-origin",
      });
    }
    return headers;
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
  ["activities", "用户动态", "/people/:user", "/people/zhihu", "user"],
  [
    "answers",
    "用户回答",
    "/people/:user/answers",
    "/people/zhihu/answers",
    "user",
  ],
  [
    "zvideos",
    "用户视频",
    "/people/:user/zvideos",
    "/people/zhihu/zvideos",
    "user",
  ],
  ["asks", "用户提问", "/people/:user/asks", "/people/zhihu/asks", "user"],
  ["posts", "用户文章", "/people/:user/posts", "/people/zhihu/posts", "user"],
  [
    "column",
    "专栏",
    "/column/:column_id",
    "/column/googledevelopers",
    "column_id",
  ],
  ["pins", "用户想法", "/people/:user/pins", "/people/zhihu/pins", "user"],
  [
    "collection",
    "收藏夹",
    "/collection/:collection_id",
    "/collection/26444956",
    "collection_id",
  ],
].map(([kind, name, path, example, parameter]) => {
  const script = new ZhihuRSS(kind);
  return {
    name: "知乎" + name,
    path: "/zhihu" + path,
    url: "www.zhihu.com",
    maintainers: [{ nickname: "findrss", url: "", avatar: "" }],
    example: "/zhihu" + example,
    parameters: {
      [parameter]: {
        user: "用户主页 /people/ 后的标识",
        column_id: "专栏主页中的标识",
        collection_id: "收藏夹页面中的数字 ID",
      }[parameter],
      ...(kind === "activities" ? { limit: "动态数量，默认 20，最多 50" } : {}),
    },
    description:
      "读取最新一页" +
      name +
      (kind === "activities" ? "，默认 20 条，可通过 limit 调整至 50 条" : "") +
      "；Cookie 须由管理员确认后显式获取。",
    handler: (ctx) => script.run(ctx),
  };
});
