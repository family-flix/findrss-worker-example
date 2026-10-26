import { utils } from "@findrss/util";

export const version = "1.1.0";
export const platform = {
  name: "起点",
  icon: '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" role="img" aria-labelledby="qidian-title" data-n="qidian-platform-icon">\n  <title id="qidian-title" data-n="qidian-title">起点中文网</title>\n  <defs data-n="qidian-palette">\n    <linearGradient id="qidian-red" x1="0" y1="0" x2="0" y2="1" data-n="qidian-red-gradient">\n      <stop stop-color="#f32236" data-n="qidian-red-top"/>\n      <stop offset="1" stop-color="#e60012" data-n="qidian-red-bottom"/>\n    </linearGradient>\n  </defs>\n  <rect width="32" height="32" rx="4.8" fill="url(#qidian-red)" data-n="qidian-background"/>\n  <path fill="#fff" d="M6 9.2h1.2v2H9v1.1H7.2v2.1h2v1.1h-2v2.1h2v1.1h-2v2.4H6v-5.6H3.5v-1.1H6v-2.1H3.8v-1.1H6Zm-2.5 8.1h1.2v2.4c1.1 1.1 2.2 1.5 4.1 1.5h6.1v1.1H8.8c-2.1 0-3.4-.4-4.6-1.5l-.5 1.4H2.5c.7-1.4 1-3 1-4.9Zm6.6-7.2h4.6v5h-3.4v4.2h2.3v-2.9h1.1v3.3c0 .5-.3.7-.8.7h-2.9c-.6 0-.9-.3-.9-.9v-5.5h3.4v-2.8h-3.4Z" data-n="qidian-character-qi"/>\n  <path fill="#fff" fill-rule="evenodd" d="M21.2 9.2h1.2v1.4h5.3v1.2h-5.3v1.5h6.1v5.3H18v-5.3h3.2Zm-2 5.3v2.9h8.1v-2.9Z" data-n="qidian-character-dian-body"/>\n  <path fill="#fff" d="m18.1 19.8 1.1.3-.8 2.1-1.1-.3Zm3.1.2h1.1v2h-1.1Zm3 0h1.1l.2 2h-1.1Zm3.1-.1 1.1-.2.6 2.1-1.1.2Z" data-n="qidian-character-dian-dots"/>\n</svg>',
};

export const permissions = {
  cookies: [
    {
      id: "account_0",
      origin: "https://m.qidian.com",
      path_prefix: "/",
      names: ["QDLogin", "QDInfo", "ywguid", "ywkey", "_csrfToken"],
      purpose: "读取用户授权的 起点中文网章节 页面或接口",
    },
  ],
};

export class QidianChaptersRSS extends RSSScript {
  async fetch(ctx) {
    try {
      const result_1 = QidianChaptersRSS.numeric_id(
        ctx.params.book_id,
        "book_id",
      );
      if (result_1.error) return result_1;
      const book_id = result_1.data;
      const link = "https://m.qidian.com/book/" + book_id + "/";
      const result_2 = await QidianChaptersRSS.fetch_html(
        ctx,
        link + "catalog/",
        link,
      );
      if (result_2.error) {
        return result_2;
      }
      const html = result_2.data;
      const result_3 = QidianChaptersRSS.page_data(html);
      if (result_3.error) {
        return result_3;
      }
      const data = result_3.data;
      if (
        String(data.bookId) !== book_id ||
        !data.bookName ||
        !Array.isArray(data.vs)
      ) {
        return Result.Err(
          "起点页面缺少小说标题或完整目录，可能为验证页面",
          "UPSTREAM_INVALID_RESPONSE",
        );
      }
      const author = {
        name: String(data.authorInfo?.authorName || data.bookName),
        uri: link,
      };
      const items = [];
      const seen = new Set();
      for (const volume of data.vs) {
        if (!Array.isArray(volume.cs)) {
          return Result.Err(
            "起点章节目录格式无效",
            "UPSTREAM_INVALID_RESPONSE",
          );
        }
        for (const chapter of volume.cs) {
          const result_4 = QidianChaptersRSS.numeric_id(
            chapter.id,
            "章节 ID",
            "UPSTREAM_INVALID_RESPONSE",
          );
          if (result_4.error) {
            return result_4;
          }
          const chapter_id = result_4.data;
          if (seen.has(chapter_id)) {
            continue;
          }
          if (typeof chapter.cN !== "string" || !chapter.cN.trim()) {
            return Result.Err("起点章节缺少标题", "UPSTREAM_INVALID_RESPONSE");
          }
          seen.add(chapter_id);
          const original =
            "https://m.qidian.com/chapter/" + book_id + "/" + chapter_id + "/";
          const result_5 = QidianChaptersRSS.publication_time(chapter.uT);
          if (result_5.error) {
            return result_5;
          }
          const published = result_5.data;
          items.push({
            id: "qidian:chapter:" + original,
            title: chapter.cN.trim(),
            link: ctx.public_origin
              ? ctx.public_origin +
                "/qidian/chapter/" +
                book_id +
                "/" +
                chapter_id
              : original,
            author,
            description: "",
            ...(published == null
              ? {}
              : {
                  published,
                  updated: published,
                }),
          });
        }
      }
      if (Number(data.chapterTotalCnt) > items.length) {
        return Result.Err(
          "起点章节目录不完整，拒绝输出截断目录",
          "UPSTREAM_INVALID_RESPONSE",
        );
      }
      const result_6 = utils.document_nodes(html);
      if (result_6.error) {
        return result_6;
      }
      const root = result_6.data;
      ctx.log("起点目录解析", {
        book_id,
        title: data.bookName,
        chapters: items.length,
      });
      return Result.Ok({
        id: "qidian:book:" + book_id,
        title: data.bookName + " · 章节更新",
        link,
        description:
          QidianChaptersRSS.meta(root, "description") ||
          data.bookName + "最新章节",
        language: "zh-cn",
        author,
        image: "https://bookcover.yuewen.com/qdbimg/349573/" + book_id + "/180",
        updated:
          items.reduce(function (latest, item) {
            return Math.max(latest, item.updated || 0);
          }, 0) || null,
        items: items.reverse(),
        extra: {
          view: "article",
          show_thumbnails: true,
          proxy_images: true,
          tags: ["小说", "起点中文网"],
        },
      });
    } catch (error) {
      return Result.Err(error, error?.code ?? "UPSTREAM_INVALID_RESPONSE");
    }
  }
  static async fetch_chapter(ctx) {
    try {
      const result_7 = QidianChaptersRSS.numeric_id(
        ctx.params.book_id,
        "book_id",
      );
      if (result_7.error) {
        return result_7;
      }
      const book_id = result_7.data;
      const result_8 = QidianChaptersRSS.numeric_id(
        ctx.params.chapter_id,
        "chapter_id",
      );
      if (result_8.error) {
        return result_8;
      }
      const chapter_id = result_8.data;
      const link =
        "https://m.qidian.com/chapter/" + book_id + "/" + chapter_id + "/";
      const result_9 = await QidianChaptersRSS.fetch_html(
        ctx,
        link,
        "https://m.qidian.com/book/" + book_id + "/",
      );
      if (result_9.error) {
        return result_9;
      }
      const html = result_9.data;
      const result_10 = QidianChaptersRSS.page_data(html);
      if (result_10.error) {
        return result_10;
      }
      const data = result_10.data;
      if (String(data.bookInfo?.bookId) !== book_id || !data.chapterInfo) {
        return Result.Err(
          "起点页面缺少章节信息，可能为验证页面",
          "UPSTREAM_INVALID_RESPONSE",
        );
      }
      const result_11 = utils.document_nodes(html);
      if (result_11.error) {
        return result_11;
      }
      const root = result_11.data;
      const body = QidianChaptersRSS.nodes(root, function (node) {
        return node.tag === "main" && node.attrs.id === "c-" + chapter_id;
      })[0];
      const title = String(data.chapterInfo.chapterName || "").trim();
      const paragraphs = body
        ? QidianChaptersRSS.nodes(body, function (node) {
            return node.tag === "p";
          })
            .map(QidianChaptersRSS.text)
            .filter(Boolean)
        : [];
      ctx.log("起点正文解析", {
        book_id,
        chapter_id,
        title,
        paragraphs: paragraphs.length,
      });
      if (
        !paragraphs.length &&
        data.chapterInfo.vipStatus === 1 &&
        !data.chapterInfo.isBuy
      ) {
        return Result.Err(
          "起点章节需要登录并订阅，请在后台更新具有该章节阅读权限的 Cookie",
          data.isLogin === 0
            ? "UPSTREAM_AUTH_REQUIRED"
            : "UPSTREAM_ACCESS_DENIED",
        );
      }
      if (!title || !paragraphs.length) {
        return Result.Err(
          "起点页面缺少章节标题或正文，可能为验证页面",
          "UPSTREAM_INVALID_RESPONSE",
        );
      }
      if (
        /[\uE000-\uF8FF\u{F0000}-\u{FFFFD}\u{100000}-\u{10FFFD}\uFFFD]/u.test(
          title + paragraphs.join(""),
        )
      ) {
        return Result.Err(
          "起点正文含未识别的字体编码或解码损坏，拒绝输出乱码",
          "UPSTREAM_INVALID_RESPONSE",
        );
      }
      const seconds = data.chapterInfo.updateTimestamp;
      const result_13 = await (async () => {
        if (
          Number.isSafeInteger(seconds) &&
          Number.isFinite(new Date(seconds * 1000).getTime())
        ) {
          return Result.Ok(seconds * 1000);
        }
        const result_12 = QidianChaptersRSS.publication_time(
          data.chapterInfo.updateTime,
        );
        if (result_12.error) {
          return result_12;
        }
        return Result.Ok(result_12.data);
      })();
      if (result_13.error) {
        return result_13;
      }
      const published = result_13.data;
      return Result.Ok({
        title,
        paragraphs,
        published,
      });
    } catch (error) {
      return Result.Err(error, error?.code ?? "UPSTREAM_INVALID_RESPONSE");
    }
  }
  static async proxy_content(ctx) {
    try {
      const result_14 = await QidianChaptersRSS.fetch_chapter(ctx);
      if (result_14.error) {
        return result_14;
      }
      const chapter = result_14.data;
      const title = utils.escape_html(chapter.title);
      const published = chapter.published;
      return Result.Ok({
        content_type: "text/html; charset=utf-8",
        body:
          '<!doctype html><html lang="zh-CN" data-n="chapter-page"><head data-n="chapter-head">' +
          '<meta charset="utf-8" data-n="chapter-charset"><meta name="viewport" content="width=device-width, initial-scale=1" data-n="chapter-viewport">' +
          '<title data-n="chapter-page-title">' +
          title +
          '</title></head><body data-n="chapter-body"><article data-n="chapter-article">' +
          '<h1 data-n="chapter-title">' +
          title +
          "</h1>" +
          (published == null
            ? ""
            : '<time data-n="chapter-published" datetime="' +
              new Date(published).toISOString() +
              '">' +
              new Date(published + 8 * 3600000)
                .toISOString()
                .slice(0, 19)
                .replace("T", " ") +
              "</time>") +
          chapter.paragraphs
            .map(function (paragraph) {
              return (
                '<p data-n="chapter-paragraph">' +
                utils.escape_html(paragraph) +
                "</p>"
              );
            })
            .join("\n") +
          "</article></body></html>",
      });
    } catch (error) {
      return Result.Err(error, error?.code ?? "UPSTREAM_INVALID_RESPONSE");
    }
  }
  static numeric_id(value, name, code = "INVALID_PARAMETER") {
    try {
      if (
        (typeof value === "number" && !Number.isSafeInteger(value)) ||
        !/^\d{1,24}$/.test(String(value ?? ""))
      ) {
        return Result.Err(name + " 无效", code);
      }
      return Result.Ok(String(value));
    } catch (error) {
      return Result.Err(error, error?.code ?? "UPSTREAM_INVALID_RESPONSE");
    }
  }
  static async fetch_html(ctx, url, referer) {
    try {
      ctx.log("起点页面请求", url);
      const result_15 = await QidianChaptersRSS.request_text(ctx, url, {
        headers: {
          Referer: referer,
          Accept: "text/html,application/xhtml+xml",
          "Accept-Language": "zh-CN,zh;q=0.9",
          "User-Agent":
            "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
        },
      });
      if (result_15.error) {
        return result_15;
      }
      return Result.Ok(result_15.data);
    } catch (error) {
      return Result.Err(error, error?.code ?? "UPSTREAM_INVALID_RESPONSE");
    }
  }
  static page_data(html) {
    try {
      const source =
        /<script\b[^>]*\bid\s*=\s*["']vite-plugin-ssr_pageContext["'][^>]*>([\s\S]*?)<\/script\s*>/i.exec(
          html,
        );
      try {
        const result_16 = parseJSON(source?.[1] || "");
        if (result_16.error) {
          throw result_16.error;
        }
        const data = result_16.data.pageContext?.pageProps?.pageData;
        if (data && typeof data === "object" && !Array.isArray(data)) {
          return Result.Ok(data);
        }
      } catch {}
      return Result.Err(
        "起点页面缺少有效数据，可能为验证页面，请在后台更新 qidian.com Cookie",
        "UPSTREAM_INVALID_RESPONSE",
      );
    } catch (error) {
      return Result.Err(error, error?.code ?? "UPSTREAM_INVALID_RESPONSE");
    }
  }
  static nodes(root, matches) {
    const result = [];
    for (const child of root.children) {
      if (matches(child)) {
        result.push(child);
      }
      result.push(...QidianChaptersRSS.nodes(child, matches));
    }
    return result;
  }
  static raw_text(node) {
    return node
      ? node.text + node.children.map(QidianChaptersRSS.raw_text).join("")
      : "";
  }
  static text(node) {
    return QidianChaptersRSS.raw_text(node).replace(/\s+/g, " ").trim();
  }
  static meta(root, name) {
    return (
      QidianChaptersRSS.nodes(root, function (node) {
        return (
          node.tag === "meta" &&
          (node.attrs.property === name || node.attrs.name === name)
        );
      })[0]?.attrs.content || ""
    );
  }
  static publication_time(value) {
    if (!/^\d{4}[-/]\d{2}[-/]\d{2}/.test(String(value || "")))
      return Result.Ok(undefined);
    return utils.timestamp(value);
  }
  static async request_text(ctx, url, options = {}) {
    const permission = permissions.cookies.find((entry) =>
      String(url).startsWith(entry.origin + "/"),
    );
    if (permission) {
      const acquired = await ctx.cookies.get(permission.id);
      if (acquired.error) {
        return acquired;
      }
      return utils.request_text(ctx, url, {
        ...options,
        cookies: acquired.data,
      });
    }
    return utils.request_text(ctx, url, options);
  }
}
const script = new QidianChaptersRSS();
export const routes = [
  {
    name: "起点中文网章节列表",
    path: "/qidian/book/:book_id",
    url: "m.qidian.com",
    maintainers: ["findrss"],
    example: "/qidian/book/1036526469",
    parameters: {
      book_id: "小说详情页 /book/ 后的数字 ID",
    },
    description:
      "读取移动端完整跨卷目录，按目录倒序输出，章节链接指向正文代理；Cookie 须由管理员确认后显式获取。",
    handler: (ctx) => script.run(ctx),
  },
  {
    name: "起点中文网正文",
    path: "/qidian/chapter/:book_id/:chapter_id",
    url: "m.qidian.com",
    maintainers: ["findrss"],
    public: true,
    example: "/qidian/chapter/1036526469/745825165",
    parameters: {
      book_id: "小说数字 ID",
      chapter_id: "章节数字 ID",
    },
    description:
      "获取移动端可阅读的章节正文，直接返回 HTML；付费章节需有效阅读权限，不输出字体乱码。",
    handler: (ctx) => QidianChaptersRSS.proxy_content(ctx),
  },
];
