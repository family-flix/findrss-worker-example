import { utils } from "@findrss/util";

export const version = "1.1.0";
export const platform = {
  name: "网页",
};

export class Source69shubaChaptersRSS extends RSSScript {
  async fetch(ctx) {
    try {
      const result_1 = Source69shubaChaptersRSS.book_id(ctx);
      if (result_1.error) return result_1;
      const id = result_1.data;
      const link = "https://www.69shuba.com/book/" + id + ".htm";
      const result_2 = await Source69shubaChaptersRSS.fetch_document(
        ctx,
        link,
        "https://www.69shuba.com/",
      );
      if (result_2.error) return result_2;
      const root = result_2.data;
      const more = Source69shubaChaptersRSS.nodes(root, function (node) {
        return (
          node.tag === "a" &&
          Source69shubaChaptersRSS.has_class(node, "more-btn") &&
          Source69shubaChaptersRSS.text(node).replace(/\s/g, "") === "完整目录"
        );
      })[0];
      const result_3 = utils.absolute_url(more?.attrs.href, link);
      if (result_3.error) return result_3;
      const directory_url = result_3.data;
      if (
        !/^https:\/\/(?:www\.)?69shuba\.com\/book\/\d+\/$/.test(
          directory_url,
        ) ||
        !directory_url.endsWith("/" + id + "/")
      ) {
        return Result.Err(
          "69书吧页面缺少有效的完整目录链接",
          "UPSTREAM_INVALID_RESPONSE",
        );
      }
      const result_4 = await Source69shubaChaptersRSS.fetch_document(
        ctx,
        directory_url,
        link,
      );
      if (result_4.error) return result_4;
      const directory_root = result_4.data;
      const directory =
        Source69shubaChaptersRSS.first_class(directory_root, "mu_contain") ||
        Source69shubaChaptersRSS.nodes(directory_root, function (node) {
          return node.attrs.id === "chapterlist";
        })[0] ||
        Source69shubaChaptersRSS.first_class(directory_root, "mulu_list") ||
        Source69shubaChaptersRSS.first_class(directory_root, "catalog") ||
        Source69shubaChaptersRSS.nodes(directory_root, function (node) {
          return node.attrs.id === "catalog";
        })[0];
      if (!directory) {
        return Result.Err(
          "69书吧页面缺少章节目录",
          "UPSTREAM_INVALID_RESPONSE",
        );
      }
      const title =
        Source69shubaChaptersRSS.meta(root, "og:novel:book_name") ||
        Source69shubaChaptersRSS.text(
          Source69shubaChaptersRSS.nodes(root, function (node) {
            return node.tag === "h1";
          })[0],
        );
      const name = Source69shubaChaptersRSS.meta(root, "og:novel:author");
      const result_5 = Source69shubaChaptersRSS.chapter_items(
        Source69shubaChaptersRSS.nodes(directory, function (node) {
          return node.tag === "a";
        }),
        "69shuba",
        directory_url,
        {
          name: name || title,
          uri: link,
        },
      );
      if (result_5.error) return result_5;
      const items = result_5.data;
      if (!items.length) {
        return Result.Err(
          "69书吧完整目录没有章节",
          "UPSTREAM_INVALID_RESPONSE",
        );
      }
      const result_6 = Source69shubaChaptersRSS.feed(
        ctx,
        "69shuba",
        link,
        title,
        name,
        Source69shubaChaptersRSS.meta(root, "og:image") ||
          Source69shubaChaptersRSS.nodes(
            Source69shubaChaptersRSS.first_class(root, "bookbox") || root,
            function (node) {
              return node.tag === "img";
            },
          )[0]?.attrs.src,
        items,
      );
      if (result_6.error) return result_6;
      return Result.Ok(result_6.data);
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
      result.push(...Source69shubaChaptersRSS.nodes(child, matches));
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
      ? node.text +
          node.children.map(Source69shubaChaptersRSS.raw_text).join("")
      : "";
  }
  static text(node) {
    return Source69shubaChaptersRSS.raw_text(node).replace(/\s+/g, " ").trim();
  }
  static first_class(root, name) {
    return Source69shubaChaptersRSS.nodes(root, function (node) {
      return Source69shubaChaptersRSS.has_class(node, name);
    })[0];
  }
  static meta(root, name) {
    return (
      Source69shubaChaptersRSS.nodes(root, function (node) {
        return (
          node.tag === "meta" &&
          (node.attrs.property === name || node.attrs.name === name)
        );
      })[0]?.attrs.content || ""
    );
  }
  static async fetch_document(ctx, url, referer) {
    try {
      const result_7 = await Source69shubaChaptersRSS.request_text(ctx, url, {
        headers: {
          Referer: referer,
          Accept: "text/html,application/xhtml+xml",
          "Accept-Language": "zh-CN,zh;q=0.9",
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36",
        },
      });
      if (result_7.error) return result_7;
      const result_8 = utils.document_nodes(result_7.data);
      if (result_8.error) return result_8;
      return Result.Ok(result_8.data);
    } catch (error) {
      return Result.Err(error, error?.code ?? "UPSTREAM_INVALID_RESPONSE");
    }
  }
  static chapter_items(links, platform, base, author) {
    try {
      const seen = new Set();
      const items = [];
      for (const node of links) {
        const result_9 = utils.absolute_url(node.attrs.href, base);
        if (result_9.error) return result_9;
        const link = result_9.data;
        const title = Source69shubaChaptersRSS.text(node);
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
      const result_10 = utils.absolute_url(image, link);
      if (result_10.error) return result_10;
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
        image:
          result_10.data || (ctx.public_origin || "") + "/findrss-logo.png",
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
const script = new Source69shubaChaptersRSS();
export const route = {
  name: "69书吧小说章节",
  path: "/69shuba/book/:book_id",
  url: "www.69shuba.com",
  maintainers: ["findrss"],
  example: "/69shuba/book/34567",
  parameters: {
    book_id: "小说详情页 /book/<ID>.htm 中的数字 ID",
  },
  description:
    "从详情页进入完整目录，按 data-num 或目录顺序倒序输出；不抓取正文。",
  handler: (ctx) => script.run(ctx),
};
