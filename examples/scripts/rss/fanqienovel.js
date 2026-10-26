import { utils } from "@findrss/util";

export const version = "1.1.0";
export const platform = {
  name: "番茄小说",
  icon: '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" role="img" aria-labelledby="fanqienovel-title" data-n="fanqienovel-platform-icon">\n  <title id="fanqienovel-title" data-n="fanqienovel-title">番茄小说</title>\n  <defs data-n="fanqienovel-palette">\n    <radialGradient id="fanqienovel-tomato" cx="52%" cy="77%" r="73%" data-n="fanqienovel-tomato-gradient">\n      <stop stop-color="#e92102" data-n="fanqienovel-tomato-center"/>\n      <stop offset=".55" stop-color="#ff4b0a" data-n="fanqienovel-tomato-middle"/>\n      <stop offset="1" stop-color="#ff8027" data-n="fanqienovel-tomato-edge"/>\n    </radialGradient>\n  </defs>\n  <rect x="1" y="1" width="30" height="30" rx="6.5" fill="#fff" data-n="fanqienovel-background"/>\n  <path fill="#f05223" d="M19.4 1h5.5v6.6l-2.7-1.7-2.8 1.7Z" data-n="fanqienovel-bookmark"/>\n  <path fill="url(#fanqienovel-tomato)" d="M1 18.7C5.2 15 10.8 11.6 16 11.6S26.9 15 31 18.7v5.8a6.5 6.5 0 0 1-6.5 6.5h-17A6.5 6.5 0 0 1 1 24.5Z" data-n="fanqienovel-tomato"/>\n  <path fill="#fff7ee" d="M15.1 18.6c0-1.1.4-2.1.9-2.1s1 1 1 2.1-.5 2-1 2-.9-.9-.9-2Zm-4.8 1c-.8-.8-1.2-.8-1.5-.5-.5.4-.1 1.3.5 2s2 1.4 2.2 1.2-.5-1.9-1.2-2.7Zm11.5-.6c-.4-.3-1.2.1-1.9.9s-1.2 2-1 2.3 1.5-.3 2.3-1.1 1-1.8.6-2.1ZM8.8 24.1c-1-.1-1.8.3-1.8.8s.8 1 1.9 1 2.2-.5 2.2-.8-1.3-.9-2.3-1Zm14.2 0c-1 .1-2.1.7-2.1 1s1.2.8 2.3.8 1.8-.5 1.8-1-.9-.9-2-.8Z" data-n="fanqienovel-seeds"/>\n</svg>',
};

export class FanqienovelChaptersRSS extends RSSScript {
  static encoded_characters =
    "";
  static decoded_characters =
    "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ的一是了我不人在他有这个上们来到时大地为子中你说生国年着就那和要她出也得里后自以会家可下而过天去能对小多然于心学么之都好看起发当没成只如事把还用第样道想作种开美总从无情己面最女但现前些所同日手又行意动方期它头经长儿回位分爱老因很给名法间斯知世什两次使身者被高已亲其进此话常与活正感见明问力理尔点文几定本公特做外孩相西果走将月十实向声车全信重三机工物气每并别真打太新比才便夫再书部水像眼等体却加电主界门利海受听表德少克代员许稜先口由死安写性马光白或住难望救命花结乐色更拉东神记处让母父应直字场平报友关放至张认接告入笑内英军候民岁往何度山觉路带万男边风解叫任金快原吃妈变通师立象数四失满战远格士音轻目条呢";
  static character_map = new Map(
    Array.from(
      FanqienovelChaptersRSS.encoded_characters,
      function (character, index) {
        return [character, FanqienovelChaptersRSS.decoded_characters[index]];
      },
    ),
  );
  async fetch(ctx) {
    try {
      const result_1 = FanqienovelChaptersRSS.book_id(ctx);
      if (result_1.error) return result_1;
      const book_id = result_1.data;
      const link = "https://fanqienovel.com/page/" + book_id;
      const result_2 = await FanqienovelChaptersRSS.fetch_document(
        ctx,
        link,
        "https://fanqienovel.com/",
      );
      if (result_2.error) return result_2;
      const root = result_2.data;
      let directory;
      try {
        const result_3 = await FanqienovelChaptersRSS.fetch_text(
          ctx,
          "https://fanqienovel.com/api/reader/directory/detail?bookId=" +
            book_id,
          link,
        );
        if (result_3.error) throw result_3.error;
        const result_4 = parseJSON(result_3.data);
        if (result_4.error) throw result_4.error;
        directory = result_4.data;
      } catch (failure) {
        if (failure.name === "FeedError") {
          return Result.Err(failure, "UPSTREAM_INVALID_RESPONSE");
        }
        return Result.Err(
          "番茄小说完整目录接口返回无效数据，可能为验证页面",
          "UPSTREAM_INVALID_RESPONSE",
        );
      }
      if (
        directory?.code !== 0 ||
        !Array.isArray(directory.data?.allItemIds) ||
        !Array.isArray(directory.data?.chapterListWithVolume)
      ) {
        return Result.Err(
          "番茄小说完整目录接口返回无效目录",
          "UPSTREAM_INVALID_RESPONSE",
        );
      }
      const result_5 = FanqienovelChaptersRSS.text(
        FanqienovelChaptersRSS.first_class(root, "info-name"),
      );
      if (result_5.error) return result_5;
      const title = result_5.data;
      const result_6 = FanqienovelChaptersRSS.text(
        FanqienovelChaptersRSS.first_class(root, "author-name-text"),
      );
      if (result_6.error) return result_6;
      const name = result_6.data;
      const author = {
        name: name || title,
        uri: link,
      };
      const image =
        FanqienovelChaptersRSS.json_ld_image(root.json_ld) ||
        FanqienovelChaptersRSS.nodes(root, function (node) {
          return (
            node.tag === "img" &&
            FanqienovelChaptersRSS.has_class(node, "book-cover")
          );
        })[0]?.attrs.src ||
        FanqienovelChaptersRSS.meta(root, "og:image");
      const result_7 = FanqienovelChaptersRSS.chapter_items(
        directory.data,
        author,
      );
      if (result_7.error) return result_7;
      const result_8 = FanqienovelChaptersRSS.text(
        FanqienovelChaptersRSS.first_class(root, "page-abstract-content"),
      );
      if (result_8.error) return result_8;
      const result_9 = FanqienovelChaptersRSS.feed(
        ctx,
        "fanqienovel",
        link,
        title,
        name,
        image,
        result_7.data.map(function (item) {
          const match =
            /^https:\/\/(?:www\.)?fanqienovel\.com\/reader\/(\d{1,24})(?:\?.*)?$/.exec(
              item.link,
            );
          return match && ctx.public_origin
            ? {
                ...item,
                link: ctx.public_origin + "/fanqienovel/chapter/" + match[1],
              }
            : item;
        }),
        result_8.data,
      );
      if (result_9.error) return result_9;
      return Result.Ok(result_9.data);
    } catch (error) {
      return Result.Err(error, error?.code ?? "UPSTREAM_INVALID_RESPONSE");
    }
  }
  static async fetch_chapter(ctx) {
    try {
      const chapter_id = String(ctx.params.chapter_id);
      if (!/^\d{1,24}$/.test(chapter_id)) {
        return Result.Err("chapter_id 无效", "INVALID_PARAMETER");
      }
      const link = "https://fanqienovel.com/reader/" + chapter_id;
      const result_10 = await FanqienovelChaptersRSS.fetch_document(
        ctx,
        link + "?enter_from=page",
        "https://fanqienovel.com/",
      );
      if (result_10.error) return result_10;
      const root = result_10.data;
      const result_11 = FanqienovelChaptersRSS.text(
        FanqienovelChaptersRSS.first_class(root, "muye-reader-title"),
      );
      if (result_11.error) return result_11;
      const title = result_11.data;
      const body = FanqienovelChaptersRSS.first_class(
        root,
        "muye-reader-content",
      );
      const wrapped_paragraphs = (body?.children || [])
        .filter(function (node) {
          return node.tag === "div";
        })
        .flatMap(function (node) {
          return node.children.filter(function (child) {
            return child.tag === "p";
          });
        });
      const values_13 = wrapped_paragraphs.length
        ? wrapped_paragraphs
        : (body?.children || []).filter(function (node) {
            return node.tag === "p";
          });
      const result_14 = utils.map_results(values_13, function (node) {
        try {
          const result_12 = FanqienovelChaptersRSS.decode_fanqie_text(
            FanqienovelChaptersRSS.raw_text(node),
          );
          if (result_12.error) return result_12;
          return Result.Ok(result_12.data.trim());
        } catch (error) {
          return Result.Err(error, error?.code ?? "UPSTREAM_INVALID_RESPONSE");
        }
      });
      if (result_14.error) return result_14;
      const paragraphs = result_14.data.filter(Boolean);
      ctx.log("番茄正文解析", {
        chapter_id,
        title,
        paragraphs: paragraphs.length,
      });
      if (!title || !paragraphs.length) {
        return Result.Err(
          "番茄小说页面缺少章节标题或正文，可能为验证页面",
          "UPSTREAM_INVALID_RESPONSE",
        );
      }
      const details = FanqienovelChaptersRSS.nodes(root, function (node) {
        return FanqienovelChaptersRSS.has_class(node, "desc-item");
      });
      const result_15 = FanqienovelChaptersRSS.text(details[1]);
      if (result_15.error) return result_15;
      let publish_at = result_15.data.replace(
        /^(?:发布时间|更新时间)：\s*/,
        "",
      );
      const timestamp_pattern =
        /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})?$/;
      if (!timestamp_pattern.test(publish_at)) {
        const metadata = root.json_ld.find(function (value) {
          return value?.dateModified || value?.upDate;
        });
        publish_at = String(metadata?.dateModified || metadata?.upDate || "");
      }
      const published = timestamp_pattern.test(publish_at)
        ? Date.parse(
            publish_at.replace(" ", "T") +
              (/Z$|[+-]\d{2}:\d{2}$/.test(publish_at) ? "" : "+08:00"),
          )
        : NaN;
      const content = paragraphs
        .map(function (paragraph) {
          return (
            '<p data-n="chapter-paragraph">' +
            utils.escape_html(paragraph) +
            "</p>"
          );
        })
        .join("\n");
      return Result.Ok({
        title,
        content,
        published: Number.isFinite(published) ? published : null,
      });
    } catch (error) {
      return Result.Err(error, error?.code ?? "UPSTREAM_INVALID_RESPONSE");
    }
  }
  static async proxy_content(ctx) {
    try {
      const result_16 = await FanqienovelChaptersRSS.fetch_chapter(ctx);
      if (result_16.error) return result_16;
      const chapter = result_16.data;
      const title = utils.escape_html(chapter.title);
      return Result.Ok({
        content_type: "text/html; charset=utf-8",
        body:
          '<!doctype html><html lang="zh-CN" data-n="chapter-page"><head data-n="chapter-head">' +
          '<meta charset="utf-8" data-n="chapter-charset"><meta name="viewport" content="width=device-width, initial-scale=1" data-n="chapter-viewport">' +
          '<title data-n="chapter-page-title">' +
          title +
          '</title></head><body data-n="chapter-body">' +
          '<article data-n="chapter-article"><h1 data-n="chapter-title">' +
          title +
          "</h1>" +
          (chapter.published === null
            ? ""
            : '<time data-n="chapter-published" datetime="' +
              new Date(chapter.published).toISOString() +
              '">' +
              new Date(chapter.published + 8 * 3600000)
                .toISOString()
                .slice(0, 19)
                .replace("T", " ") +
              "</time>") +
          chapter.content +
          "</article></body></html>",
      });
    } catch (error) {
      return Result.Err(error, error?.code ?? "UPSTREAM_INVALID_RESPONSE");
    }
  }
  static decode_fanqie_text(value) {
    try {
      const decoded = Array.from(value, function (character) {
        return FanqienovelChaptersRSS.character_map.get(character) || character;
      }).join("");
      if (
        /[\uE000-\uF8FF\u{F0000}-\u{FFFFD}\u{100000}-\u{10FFFD}\uFFFD]/u.test(
          decoded,
        )
      ) {
        return Result.Err(
          "番茄小说文本含未识别的字体编码或解码损坏，需要更新字体映射；拒绝输出乱码",
          "UPSTREAM_INVALID_RESPONSE",
        );
      }
      return Result.Ok(decoded);
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
      result.push(...FanqienovelChaptersRSS.nodes(child, matches));
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
      ? node.text + node.children.map(FanqienovelChaptersRSS.raw_text).join("")
      : "";
  }
  static text(node) {
    try {
      const result_17 = FanqienovelChaptersRSS.decode_fanqie_text(
        FanqienovelChaptersRSS.raw_text(node),
      );
      if (result_17.error) return result_17;
      return Result.Ok(result_17.data.replace(/\s+/g, " ").trim());
    } catch (error) {
      return Result.Err(error, error?.code ?? "UPSTREAM_INVALID_RESPONSE");
    }
  }
  static first_class(root, name) {
    return FanqienovelChaptersRSS.nodes(root, function (node) {
      return FanqienovelChaptersRSS.has_class(node, name);
    })[0];
  }
  static meta(root, name) {
    return (
      FanqienovelChaptersRSS.nodes(root, function (node) {
        return (
          node.tag === "meta" &&
          (node.attrs.property === name || node.attrs.name === name)
        );
      })[0]?.attrs.content || ""
    );
  }
  static image_value(value) {
    if (typeof value === "string") {
      return value;
    }
    if (Array.isArray(value)) {
      return value.map(FanqienovelChaptersRSS.image_value).find(Boolean) || "";
    }
    return value && typeof value === "object"
      ? FanqienovelChaptersRSS.image_value(
          value.url || value.contentUrl || value["@id"],
        )
      : "";
  }
  static json_ld_image(value) {
    if (Array.isArray(value)) {
      return (
        value.map(FanqienovelChaptersRSS.json_ld_image).find(Boolean) || ""
      );
    }
    return value && typeof value === "object"
      ? FanqienovelChaptersRSS.image_value(value.images || value.image) ||
          FanqienovelChaptersRSS.json_ld_image(value["@graph"])
      : "";
  }
  static async fetch_document(ctx, url, referer) {
    try {
      const result_18 = await FanqienovelChaptersRSS.fetch_text(
        ctx,
        url,
        referer,
      );
      if (result_18.error) return result_18;
      const result_19 = utils.document_nodes(result_18.data);
      if (result_19.error) return result_19;
      result_19.data.json_ld = [];
      for (const match of result_18.data.matchAll(
        /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
      )) {
        const parsed = parseJSON(match[1]);
        if (!parsed.error) result_19.data.json_ld.push(parsed.data);
      }
      return Result.Ok(result_19.data);
    } catch (error) {
      return Result.Err(error, error?.code ?? "UPSTREAM_INVALID_RESPONSE");
    }
  }
  static async fetch_text(ctx, url, referer) {
    try {
      ctx.log("番茄页面请求", url);
      const result_20 = await FanqienovelChaptersRSS.request_text(ctx, url, {
        headers: {
          Referer: referer,
          Accept: "text/html,application/xhtml+xml",
          "Accept-Language": "zh-CN,zh;q=0.9",
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36",
        },
      });
      if (result_20.error) return result_20;
      return Result.Ok(result_20.data);
    } catch (error) {
      return Result.Err(error, error?.code ?? "UPSTREAM_INVALID_RESPONSE");
    }
  }
  static chapter_items(directory, author) {
    try {
      if (!directory.chapterListWithVolume.every(Array.isArray)) {
        return Result.Err(
          "番茄小说完整目录格式无效",
          "UPSTREAM_INVALID_RESPONSE",
        );
      }
      const chapters = new Map();
      for (const chapter of directory.chapterListWithVolume.flat()) {
        if (
          !chapter ||
          typeof chapter.itemId !== "string" ||
          !/^\d{1,24}$/.test(chapter.itemId)
        ) {
          return Result.Err(
            "番茄小说目录包含无效章节 ID",
            "UPSTREAM_INVALID_RESPONSE",
          );
        }
        if (!chapters.has(chapter.itemId)) {
          chapters.set(chapter.itemId, chapter);
        }
      }
      const parsed_items = utils.map_results(
        [...new Set(directory.allItemIds)],
        function (chapter_id, index) {
          try {
            const chapter = chapters.get(chapter_id);
            if (
              typeof chapter_id !== "string" ||
              !/^\d{1,24}$/.test(chapter_id) ||
              !chapter ||
              typeof chapter.title !== "string" ||
              !chapter.title.trim()
            ) {
              return Result.Err(
                "番茄小说完整目录缺少章节或标题，拒绝输出截断目录",
                "UPSTREAM_INVALID_RESPONSE",
              );
            }
            const link = "https://fanqienovel.com/reader/" + chapter_id;
            const result_21 = FanqienovelChaptersRSS.decode_fanqie_text(
              chapter.title,
            );
            if (result_21.error) return result_21;
            const title = result_21.data.trim();
            const published = /^\d{1,12}$/.test(
              String(chapter.firstPassTime || ""),
            )
              ? Number(chapter.firstPassTime) * 1000
              : null;
            return Result.Ok({
              id: "fanqienovel:chapter:" + link,
              title,
              link,
              description: "",
              author,
              ...(published === null
                ? {}
                : {
                    published,
                    updated: published,
                  }),
              index: /^\d{1,9}$/.test(String(chapter.realChapterOrder || ""))
                ? Number(chapter.realChapterOrder)
                : index + 1,
            });
          } catch (error) {
            return Result.Err(
              error,
              error?.code ?? "UPSTREAM_INVALID_RESPONSE",
            );
          }
        },
      );
      if (parsed_items.error) return parsed_items;
      const items = parsed_items.data;
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
      const result_22 = utils.absolute_url(image, link);
      if (result_22.error) return result_22;
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
          result_22.data || (ctx.public_origin || "") + "/findrss-logo.png",
        updated:
          items.reduce(function (latest, item) {
            return Math.max(latest, item.updated || 0);
          }, 0) || null,
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
const script = new FanqienovelChaptersRSS();
export const routes = [
  {
    name: "番茄小说章节",
    path: "/fanqienovel/book/:book_id",
    url: "fanqienovel.com",
    maintainers: ["findrss"],
    example: "/fanqienovel/book/7143038691944959011",
    parameters: {
      book_id: "小说详情页 /page/ 后的数字 ID",
    },
    description:
      "通过完整目录接口获取全部卷，按章节序号降序输出；正文由独立路由代理。",
    handler: (ctx) => script.run(ctx),
  },
  {
    name: "番茄小说正文",
    path: "/fanqienovel/chapter/:chapter_id",
    public: true,
    url: "fanqienovel.com",
    maintainers: ["findrss"],
    example: "/fanqienovel/chapter/7143039277444481571",
    parameters: {
      chapter_id: "章节 /reader/ 后的数字 ID",
    },
    description: "获取章节正文并替换混淆字符，直接返回 HTML 页面。",
    handler: (ctx) => FanqienovelChaptersRSS.proxy_content(ctx),
  },
];
