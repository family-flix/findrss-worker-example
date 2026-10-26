import { utils } from "@findrss/util";

export const version = "1.1.0";
export const platform = {
  name: "网页",
};

export class TtkChaptersRSS extends RSSScript {
  async fetch(ctx) {
    try {
      const result_1 = TtkChaptersRSS.book_id(ctx, /^[A-Za-z0-9_-]{1,128}$/);
      if (result_1.error) return result_1;
      const link = "https://ttks.tw/novel/" + result_1.data + ".html";
      const result_2 = await TtkChaptersRSS.fetch_document(
        ctx,
        link,
        "https://ttks.tw/",
      );
      if (result_2.error) return result_2;
      const root = result_2.data;
      const frames = TtkChaptersRSS.nodes(root, function (node) {
        return TtkChaptersRSS.has_class(node, "chapters_frame");
      });
      const directory =
        frames.find(function (frame) {
          const siblings = frame.parent.children;
          const index = siblings.indexOf(frame);
          const heading = siblings
            .slice(0, index)
            .reverse()
            .find(function (node) {
              return TtkChaptersRSS.has_class(node, "chapters_title");
            });
          return /全部章[节節]/.test(TtkChaptersRSS.text(heading));
        }) ||
        frames[1] ||
        frames[0] ||
        TtkChaptersRSS.nodes(root, function (node) {
          return (
            ["chapters_frame", "chapter_list"].includes(node.attrs.id) ||
            ["chapter-list", "chapters", "catalog", "book-chapters"].some(
              function (name) {
                return TtkChaptersRSS.has_class(node, name);
              },
            )
          );
        })[0];
      if (!directory) {
        return Result.Err(
          "天天看书页面缺少完整章节目录",
          "UPSTREAM_INVALID_RESPONSE",
        );
      }
      const title =
        TtkChaptersRSS.text(
          TtkChaptersRSS.nodes(root, function (node) {
            return node.tag === "h1";
          })[0],
        ) ||
        TtkChaptersRSS.text(TtkChaptersRSS.first_class(root, "novel-title")) ||
        TtkChaptersRSS.text(TtkChaptersRSS.first_class(root, "book-title")) ||
        TtkChaptersRSS.meta(root, "og:title");
      const name = (
        TtkChaptersRSS.meta(root, "og:novel:author") ||
        TtkChaptersRSS.text(TtkChaptersRSS.first_class(root, "author")) ||
        TtkChaptersRSS.text(TtkChaptersRSS.first_class(root, "novel-author"))
      ).replace(/^作者\s*[:：]\s*/, "");
      const result_3 = TtkChaptersRSS.chapter_items(
        TtkChaptersRSS.nodes(directory, function (node) {
          return node.tag === "a";
        }),
        "ttk",
        link,
        {
          name: name || title,
          uri: link,
        },
      );
      if (result_3.error) return result_3;
      const result_4 = TtkChaptersRSS.feed(
        ctx,
        "ttk",
        link,
        title,
        name,
        TtkChaptersRSS.meta(root, "og:image"),
        result_3.data,
      );
      if (result_4.error) return result_4;
      return Result.Ok(result_4.data);
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
      result.push(...TtkChaptersRSS.nodes(child, matches));
    }
    return result;
  }
  static has_class(node, name) {
    return String(node.attrs.class || "")
      .split(/\s+/)
      .includes(name);
  }
  static raw_text(node) {
    return node
      ? node.text + node.children.map(TtkChaptersRSS.raw_text).join("")
      : "";
  }
  static text(node) {
    return TtkChaptersRSS.raw_text(node).replace(/\s+/g, " ").trim();
  }
  static first_class(root, name) {
    return TtkChaptersRSS.nodes(root, function (node) {
      return TtkChaptersRSS.has_class(node, name);
    })[0];
  }
  static meta(root, name) {
    return (
      TtkChaptersRSS.nodes(root, function (node) {
        return (
          node.tag === "meta" &&
          (node.attrs.property === name || node.attrs.name === name)
        );
      })[0]?.attrs.content || ""
    );
  }
  static async fetch_document(ctx, url, referer) {
    try {
      const result_5 = await TtkChaptersRSS.request_text(ctx, url, {
        headers: {
          Referer: referer,
          Accept: "text/html,application/xhtml+xml",
          "Accept-Language": "zh-CN,zh;q=0.9",
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36",
        },
      });
      if (result_5.error) return result_5;
      const result_6 = utils.document_nodes(result_5.data);
      if (result_6.error) return result_6;
      return Result.Ok(result_6.data);
    } catch (error) {
      return Result.Err(error, error?.code ?? "UPSTREAM_INVALID_RESPONSE");
    }
  }
  static chapter_items(links, platform, base, author) {
    try {
      const seen = new Set();
      const items = [];
      for (const node of links) {
        const result_7 = utils.absolute_url(node.attrs.href, base);
        if (result_7.error) return result_7;
        const link = result_7.data;
        const title = TtkChaptersRSS.text(node);
        if (!link || !title || seen.has(link)) {
          continue;
        }
        seen.add(link);
        items.push({
          id: platform + ":chapter:" + link,
          title,
          link,
          description: "",
          author,
          index: /^\d+$/.test(node.attrs["data-num"] || "")
            ? Number(node.attrs["data-num"])
            : items.length + 1,
        });
      }
      items.sort(function (a, b) {
        return b.index - a.index;
      });
      for (const item of items) {
        delete item.index;
      }
      return Result.Ok(items);
    } catch (error) {
      return Result.Err(error, error?.code ?? "UPSTREAM_INVALID_RESPONSE");
    }
  }
  static feed(
    ctx,
    platform,
    link,
    title,
    author_name,
    image,
    items,
    description = "",
  ) {
    try {
      if (!title) {
        return Result.Err(
          platform + " 页面缺少小说标题，可能为验证页面",
          "UPSTREAM_INVALID_RESPONSE",
        );
      }
      const result_8 = utils.absolute_url(image, link);
      if (result_8.error) return result_8;
      return Result.Ok({
        id: platform + ":book:" + ctx.params.book_id,
        title: title + " · 章节更新",
        link,
        description,
        language: platform === "ttk" ? "zh-tw" : "zh-cn",
        author: {
          name: author_name || title,
          uri: link,
        },
        image: result_8.data || (ctx.public_origin || "") + "/findrss-logo.png",
        updated: null,
        items,
        extra: {
          view: "article",
          show_thumbnails: true,
          proxy_images: true,
          tags: ["小说", platform],
        },
      });
    } catch (error) {
      return Result.Err(error, error?.code ?? "UPSTREAM_INVALID_RESPONSE");
    }
  }
  static book_id(ctx, pattern = /^\d{1,24}$/) {
    try {
      const id = String(ctx.params?.book_id || "");
      if (!pattern.test(id)) {
        return Result.Err("book_id 无效", "INVALID_PARAMETER");
      }
      return Result.Ok(id);
    } catch (error) {
      return Result.Err(error, error?.code ?? "UPSTREAM_INVALID_RESPONSE");
    }
  }
  static async request_text(ctx, url, options = {}) {
    return utils.request_text(ctx, url, options);
  }
}
const script = new TtkChaptersRSS();
export const route = {
  name: "天天看书小说章节",
  path: "/ttk/book/:book_id",
  url: "ttks.tw",
  maintainers: ["findrss"],
  example: "/ttk/book/daofeng",
  parameters: {
    book_id: "小说主页 /novel/ 后的标识（不含 .html）",
  },
  description:
    "读取小说全部章节区，排除最新章节重复区，按目录倒序输出；不抓取正文。",
  handler: (ctx) => script.run(ctx),
};
