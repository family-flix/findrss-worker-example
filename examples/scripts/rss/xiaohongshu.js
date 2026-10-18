import { utils } from "@findrss/util";

export const version = "1.1.0";
export const platform = {
  name: "小红书",
  icon: '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" data-n="xiaohongshu-platform-icon"><path data-n="xiaohongshu-pixels-ff2040-16" fill="#ff2040" fill-opacity="0.062745" d="M4 0h1v1H4zM31 4h1v1H31zM0 27h1v1H0zM27 31h1v1H27z" />\n    <path data-n="xiaohongshu-pixels-ff2040-32" fill="#ff2040" fill-opacity="0.125490" d="M27 0h1v1H27zM31 27h1v1H31z" />\n    <path data-n="xiaohongshu-pixels-ff2440-112" fill="#ff2440" fill-opacity="0.439216" d="M26 31h1v1H26z" />\n    <path data-n="xiaohongshu-pixels-ff2441-177" fill="#ff2441" fill-opacity="0.694118" d="M0 6h1v1H0zM31 6h1v1H31zM0 25h1v1H0zM31 25h1v1H31z" />\n    <path data-n="xiaohongshu-pixels-ff2441-207" fill="#ff2441" fill-opacity="0.811765" d="M31 24h1v1H31zM7 31h1v1H7z" />\n    <path data-n="xiaohongshu-pixels-ff2442-112" fill="#ff2442" fill-opacity="0.439216" d="M5 0h1v1H5zM31 5h1v1H31zM0 26h1v1H0z" />\n    <path data-n="xiaohongshu-pixels-ff2442-126" fill="#ff2442" fill-opacity="0.494118" d="M2 2h1v1H2zM29 2h1v1H29z" />\n    <path data-n="xiaohongshu-pixels-ff2442-129" fill="#ff2442" fill-opacity="0.505882" d="M2 29h1v1H2zM29 29h1v1H29z" />\n    <path data-n="xiaohongshu-pixels-ff2442-175" fill="#ff2442" fill-opacity="0.686275" d="M6 0h1v1H6zM25 0h1v1H25zM6 31h1v1H6zM25 31h1v1H25z" />\n    <path data-n="xiaohongshu-pixels-ff2442-239" fill="#ff2442" fill-opacity="0.937255" d="M4 1h1v1H4zM30 4h1v1H30zM1 27h1v1H1zM27 30h1v1H27z" />\n    <path data-n="xiaohongshu-pixels-ff2442" fill="#ff2442" d="M9 0h14v1H9zM5 1h22v1H5zM3 2h26v1H3zM2 3h28v2H2zM1 5h30v4H1zM0 9h32v2H0zM0 11h7v1H0zM9 11h4v1H9zM15 11h6v1H15zM24 11h8v1H24zM0 12h6v2H0zM9 12h3v2H9zM15 12h1v2H15zM28 12h4v2H28zM0 14h4v2H0zM16 14h1v1H16zM19 14h2v1H19zM26 14h6v1H26zM15 15h2v1H15zM19 15h1v2H19zM28 15h4v6H28zM0 16h3v3H0zM16 16h1v2H16zM19 17h2v1H19zM24 17h2v2H24zM9 18h1v2H9zM0 19h4v1H0zM0 20h6v1H0zM8 20h3v1H8zM14 20h1v1H14zM24 20h1v1H24zM0 21h32v2H0zM1 23h30v4H1zM2 27h28v2H2zM3 29h26v1H3zM5 30h22v1H5zM9 31h14v1H9z" />\n    <path data-n="xiaohongshu-pixels-ff2443-207" fill="#ff2443" fill-opacity="0.811765" d="M24 0h1v1H24zM0 7h1v1H0z" />\n    <path data-n="xiaohongshu-pixels-ff2540-96" fill="#ff2540" fill-opacity="0.376471" d="M31 26h1v1H31zM1 28h1v1H1zM30 28h1v1H30z" />\n    <path data-n="xiaohongshu-pixels-ff2541-223" fill="#ff2541" fill-opacity="0.874510" d="M30 27h1v1H30z" />\n    <path data-n="xiaohongshu-pixels-ff2542-96" fill="#ff2542" fill-opacity="0.376471" d="M26 0h1v1H26zM28 1h1v1H28zM1 3h1v1H1zM0 5h1v1H0zM3 30h1v1H3zM28 30h1v1H28zM5 31h1v1H5z" />\n    <path data-n="xiaohongshu-pixels-ff2542-223" fill="#ff2542" fill-opacity="0.874510" d="M7 0h2v1H7zM23 0h1v1H23zM27 1h1v1H27zM1 4h1v1H1zM31 7h1v2H31zM0 8h1v1H0zM0 23h1v2H0zM31 23h1v1H31zM4 30h1v1H4zM8 31h1v1H8zM23 31h2v1H23z" />\n    <path data-n="xiaohongshu-pixels-ff2640-94" fill="#ff2640" fill-opacity="0.368627" d="M30 3h1v1H30z" />\n    <path data-n="xiaohongshu-pixels-ff2643-94" fill="#ff2643" fill-opacity="0.368627" d="M3 1h1v1H3z" />\n    <path data-n="xiaohongshu-pixels-ff2840-32" fill="#ff2840" fill-opacity="0.125490" d="M0 4h1v1H0zM4 31h1v1H4z" />\n    <path data-n="xiaohongshu-pixels-ff314e" fill="#ff314e" d="M20 18h1v1H20zM27 20h1v1H27z" />\n    <path data-n="xiaohongshu-pixels-ff324e" fill="#ff324e" d="M8 11h1v1H8zM21 11h1v1H21zM3 16h1v1H3zM15 16h1v1H15zM3 18h1v1H3zM15 18h1v1H15zM5 19h1v1H5zM24 19h1v1H24zM21 20h1v1H21z" />\n    <path data-n="xiaohongshu-pixels-ff3f5a" fill="#ff3f5a" d="M6 12h1v5H6zM14 13h1v1H14zM15 17h1v1H15zM11 18h1v1H11zM11 20h1v1H11zM20 20h1v1H20zM23 20h1v1H23z" />\n    <path data-n="xiaohongshu-pixels-ff4059" fill="#ff4059" d="M7 11h1v1H7zM11 14h1v1H11z" />\n    <path data-n="xiaohongshu-pixels-ff405a" fill="#ff405a" d="M23 11h1v1H23zM12 12h1v1H12zM25 12h1v1H25zM27 15h1v1H27zM12 16h1v1H12zM11 19h1v1H11z" />\n    <path data-n="xiaohongshu-pixels-ff4d65" fill="#ff4d65" d="M13 11h1v1H13zM20 12h1v1H20zM11 15h1v1H11zM5 18h1v1H5z" />\n    <path data-n="xiaohongshu-pixels-ff4d66" fill="#ff4d66" d="M4 19h1v1H4z" />\n    <path data-n="xiaohongshu-pixels-ff4e66" fill="#ff4e66" d="M3 17h1v1H3zM6 17h1v1H6zM9 17h1v1H9z" />\n    <path data-n="xiaohongshu-pixels-ff5b71" fill="#ff5b71" d="M14 11h1v1H14zM22 11h1v1H22zM20 13h1v1H20zM21 14h1v1H21zM21 17h1v2H21zM6 18h1v1H6zM12 18h1v1H12zM16 18h1v1H16zM19 18h1v1H19zM10 19h1v1H10zM20 19h2v1H20z" />\n    <path data-n="xiaohongshu-pixels-ff687d" fill="#ff687d" d="M26 12h1v1H26zM11 16h1v1H11zM14 18h1v1H14zM8 19h1v1H8zM7 20h1v1H7z" />\n    <path data-n="xiaohongshu-pixels-ff697d" fill="#ff697d" d="M9 16h1v1H9zM6 20h1v1H6zM25 20h1v1H25z" />\n    <path data-n="xiaohongshu-pixels-ff7689" fill="#ff7689" d="M12 13h1v1H12zM15 14h1v1H15zM9 15h1v1H9zM12 15h1v1H12zM14 19h1v1H14zM12 20h2v1H12zM15 20h5v1H15zM22 20h1v1H22zM26 20h1v1H26z" />\n    <path data-n="xiaohongshu-pixels-ff7788" fill="#ff7788" d="M8 12h1v7H8zM23 14h1v1H23zM23 17h1v3H23zM13 18h1v1H13z" />\n    <path data-n="xiaohongshu-pixels-ff8395" fill="#ff8395" d="M27 12h1v1H27z" />\n    <path data-n="xiaohongshu-pixels-ff8494" fill="#ff8494" d="M19 12h1v1H19zM5 17h1v1H5zM11 17h1v1H11z" />\n    <path data-n="xiaohongshu-pixels-ff92a0" fill="#ff92a0" d="M9 14h1v1H9zM24 14h1v1H24zM5 16h1v1H5zM14 16h1v1H14z" />\n    <path data-n="xiaohongshu-pixels-ff9fac" fill="#ff9fac" d="M24 12h1v1H24zM26 15h1v1H26z" />\n    <path data-n="xiaohongshu-pixels-ff9fad" fill="#ff9fad" d="M20 15h1v1H20z" />\n    <path data-n="xiaohongshu-pixels-ffa0ac" fill="#ffa0ac" d="M12 17h1v1H12z" />\n    <path data-n="xiaohongshu-pixels-ffadb8" fill="#ffadb8" d="M14 12h1v1H14zM16 12h3v1H16zM5 15h1v1H5z" />\n    <path data-n="xiaohongshu-pixels-ffbac3" fill="#ffbac3" d="M27 13h1v1H27z" />\n    <path data-n="xiaohongshu-pixels-ffbbc4" fill="#ffbbc4" d="M21 12h1v1H21zM26 13h1v1H26zM21 15h1v1H21zM26 18h1v1H26z" />\n    <path data-n="xiaohongshu-pixels-ffc8cf" fill="#ffc8cf" d="M19 13h1v1H19zM5 14h1v1H5zM18 14h1v4H18z" />\n    <path data-n="xiaohongshu-pixels-ffc8d0" fill="#ffc8d0" d="M26 17h1v1H26zM15 19h1v1H15z" />\n    <path data-n="xiaohongshu-pixels-ffc9cf" fill="#ffc9cf" d="M23 12h1v1H23zM23 15h1v1H23z" />\n    <path data-n="xiaohongshu-pixels-ffd5dc" fill="#ffd5dc" d="M18 18h1v1H18zM27 19h1v1H27z" />\n    <path data-n="xiaohongshu-pixels-ffd6db" fill="#ffd6db" d="M24 15h1v1H24zM27 16h1v1H27z" />\n    <path data-n="xiaohongshu-pixels-ffe3e8" fill="#ffe3e8" d="M14 15h1v1H14z" />\n    <path data-n="xiaohongshu-pixels-ffe4e7" fill="#ffe4e7" d="M13 12h1v1H13zM12 14h1v1H12zM13 15h1v1H13zM27 17h1v2H27z" />\n    <path data-n="xiaohongshu-pixels-ffe4e8" fill="#ffe4e8" d="M4 14h1v1H4zM20 16h1v1H20z" />\n    <path data-n="xiaohongshu-pixels-fff1f3" fill="#fff1f3" d="M25 13h1v1H25zM4 18h1v1H4zM10 18h1v1H10z" />\n    <path data-n="xiaohongshu-pixels-ffffff" fill="#fff" d="M7 12h1v7H7zM22 12h1v1H22zM13 13h1v1H13zM16 13h3v1H16zM21 13h4v1H21zM10 14h1v4H10zM13 14h2v1H13zM17 14h1v5H17zM22 14h1v2H22zM25 14h1v2H25zM4 15h1v3H4zM13 16h1v1H13zM21 16h6v1H21zM13 17h2v1H13zM22 17h1v3H22zM6 19h2v1H6zM12 19h2v1H12zM16 19h4v1H16zM25 19h2v1H25z" />\n  </svg>',
};

export const permissions = {
  cookies: [
    {
      id: "account_0",
      origin: "https://www.xiaohongshu.com",
      path_prefix: "/",
      names: ["web_session", "a1", "webId", "gid"],
      purpose: "读取用户授权的 小红书用户笔记 页面或接口",
    },
  ],
};
export class XiaohongshuUserRSS extends RSSScript {
  async fetch(ctx) {
    try {
      const uid = String(ctx.params?.uid || "").toLowerCase();
      if (!/^[a-f0-9]{24}$/.test(uid)) {
        return Result.Err(
          "uid 必须为用户主页中的 24 位十六进制 ID",
          "INVALID_PARAMETER",
        );
      }
      const full_content = /^(1|true)$/i.test(String(ctx.query?.full_content || ""));
      const link = "https://www.xiaohongshu.com/user/profile/" + uid;
      let user;
      try {
        const result_1 = await XiaohongshuUserRSS.request_text(ctx, link);
        if (result_1.error) throw result_1.error;
        const html = result_1.data;
        const result_2 = XiaohongshuUserRSS.initial_state(html);
        if (result_2.error) throw result_2.error;
        user = result_2.data?.user;
        if (!user?.userPageData?.basicInfo || !Array.isArray(user.notes)) {
          throw Object.assign(
            new Error("初始状态缺少用户资料或 notes 笔记数组"),
            {
              name: "FeedError",
              code: "UPSTREAM_INVALID_RESPONSE",
            },
          );
        }
      } catch (error) {
        return Result.Err(
          "小红书笔记读取失败：" +
            (error.message || "请求或响应解析失败") +
            "；请同步有效的 xiaohongshu.com Cookie，风控验证需手动完成。",
          error.code ?? "UPSTREAM_INVALID_RESPONSE",
        );
      }
      const basic = user.userPageData.basicInfo;
      const name = String(basic.nickname || uid);
      const seen = new Set();
      const items = [];
      for (const entry of user.notes.flat()) {
        const card = entry?.noteCard || entry?.note_card;
        if (!card) {
          continue;
        }
        const id = String(
          card.noteId || card.note_id || entry.id || "",
        ).toLowerCase();
        if (!/^[a-f0-9]{24}$/.test(id)) {
          return Result.Err(
            "小红书笔记缺少有效的 noteId",
            "UPSTREAM_INVALID_RESPONSE",
          );
        }
        if (seen.has(id)) {
          continue;
        }
        seen.add(id);
        const token = String(
          entry.xsecToken ||
            entry.xsec_token ||
            card.xsecToken ||
            card.xsec_token ||
            "",
        );
        const note_link =
          "https://www.xiaohongshu.com/explore/" +
          id +
          (token
            ? "?xsec_token=" +
              encodeURIComponent(token) +
              "&xsec_source=pc_user"
            : "");
        let note = card;
        if (full_content) {
          // 主页卡片只有摘要和封面；正文、完整图集和视频流来自详情页。
          const detail = await XiaohongshuUserRSS.request_text(ctx, note_link, {
            headers: { Referer: link },
          });
          if (detail.error) return detail;
          const state = XiaohongshuUserRSS.initial_state(detail.data);
          if (state.error) {
            return Result.Err(
              "小红书笔记 " + id + " 详情读取失败：" +
                state.error.message +
                "；请同步有效 Cookie，风控验证需手动完成。",
              state.error.code ?? "UPSTREAM_INVALID_RESPONSE",
            );
          }
          note = state.data?.note?.noteDetailMap?.[id]?.note;
          if (
            String(note?.noteId || note?.note_id || "").toLowerCase() !== id ||
            typeof note?.desc !== "string"
          ) {
            return Result.Err(
              "小红书笔记 " + id + " 详情缺少正文或 noteId 不匹配",
              "UPSTREAM_INVALID_RESPONSE",
            );
          }
        }
        const image_list = full_content ? note.imageList || note.image_list : [];
        const images = (Array.isArray(image_list) ? image_list : []).map(
          (value) => XiaohongshuUserRSS.cover_url(value),
        );
        const video = XiaohongshuUserRSS.video_url(note.video);
        if (
          full_content && (
            images.some((value) => !value) ||
            (note.type === "video" && !video) ||
            (note.type === "normal" && !images.length)
          )
        ) {
          return Result.Err(
            "小红书笔记 " + id + " 详情缺少完整图片或视频地址",
            "UPSTREAM_INVALID_RESPONSE",
          );
        }
        const image = images[0] || XiaohongshuUserRSS.cover_url(card.cover);
        const title = String(
          note.title ||
            card.displayTitle ||
            card.display_title ||
            card.title ||
            "小红书笔记 " + id,
        );
        const description = full_content ? note.desc : String(card.desc || title);
        const content =
          (description
            ? "<p>" +
              utils.escape_html(description).replace(/\n/g, "<br>") +
              "</p>"
            : "") +
          (video
            ? '<video controls preload="none"' +
              (image ? ' poster="' + utils.escape_html(image) + '"' : "") +
              ' src="' + utils.escape_html(video) + '"></video>'
            : images
                .map((value) =>
                  '<img src="' + utils.escape_html(value) + '" alt="">',
                )
                .join(""));
        items.push({
          id: "xiaohongshu:note:" + id,
          type: video ? "video" : images.length > 1 ? "gallery" : "article",
          title,
          link: note_link,
          published: note.time ?? card.time,
          description,
          ...(full_content ? { content } : {}),
          image: image || undefined,
          images: video ? [] : images,
          author: {
            name: String(note.user?.nickname || card.user?.nickname || name),
            uri: link,
          },
          ...(video
            ? {
                enclosure: {
                  url: video,
                  type: "video/mp4",
                },
              }
            : {}),
        });
      }
      return Result.Ok({
        id: "xiaohongshu:user:" + uid,
        title: name + " 的小红书笔记",
        link,
        description: String(basic.desc || ""),
        language: "zh-cn",
        author: {
          name,
          uri: link,
        },
        image:
          XiaohongshuUserRSS.public_url(basic.imageb || basic.images) ||
          (ctx.public_origin || "") + "/findrss-logo.png",
        updated: items[0]?.published || null,
        items,
        extra: {
          view: "timeline",
          show_thumbnails: true,
          proxy_images: true,
          headers: {
            referer: "https://www.xiaohongshu.com/",
          },
          tags: ["小红书"],
        },
      });
    } catch (error) {
      return Result.Err(error, error?.code ?? "UPSTREAM_INVALID_RESPONSE");
    }
  }
  static public_url(value) {
    const url = String(value || "")
      .replace(/^\/\//, "https://")
      .replace(/^http:\/\//, "https://");
    return /^https:\/\//i.test(url) ? url : "";
  }
  static initial_state(html) {
    try {
      for (const script of String(html).matchAll(
        /<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi,
      )) {
        const match = script[1].match(
          /^\s*window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*\})\s*;?\s*$/,
        );
        if (!match) {
          continue;
        }
        const json = match[1].replace(
          /("(?:\\.|[^"\\])*")|\bundefined\b/g,
          function (value, quoted) {
            return quoted || "null";
          },
        );
        try {
          const result_3 = parseJSON(json);
          if (result_3.error) throw result_3.error;
          return Result.Ok(result_3.data);
        } catch {
          return Result.Err(
            "小红书初始状态不是可解析的 JSON",
            "UPSTREAM_INVALID_RESPONSE",
          );
        }
      }
      return Result.Err(
        "小红书页面缺少 __INITIAL_STATE__，可能为登录或验证页面",
        "UPSTREAM_INVALID_RESPONSE",
      );
    } catch (error) {
      return Result.Err(error, error?.code ?? "UPSTREAM_INVALID_RESPONSE");
    }
  }
  static cover_url(cover) {
    const info = cover?.infoList || cover?.info_list;
    return XiaohongshuUserRSS.public_url(
      (Array.isArray(info)
        ? info.find(function (item) {
            return (item?.imageScene || item?.image_scene) === "WB_DFT";
          })?.url || info[info.length - 1]?.url
        : "") ||
        cover?.urlDefault ||
        cover?.url_default ||
        cover?.url ||
        cover?.urlPre,
    );
  }
  static video_url(video) {
    const stream = video?.media?.stream;
    // 优先使用浏览器和阅读器普遍支持的 H.264 MP4，再选其他编码。
    for (const variants of [stream?.h264, stream?.h265, stream?.h266, stream?.av1]) {
      const candidates = (Array.isArray(variants) ? variants : [])
        .filter((value) => !value.format || value.format === "mp4")
        .map((value) => ({
          url: [
            value.masterUrl,
            value.master_url,
            ...(value.backupUrls || value.backup_urls || []),
          ]
            .map((url) => XiaohongshuUserRSS.public_url(url))
            .find(Boolean),
          quality: (Number(value.width) || 0) * (Number(value.height) || 0),
          bitrate: Number(value.avgBitrate || value.avg_bitrate) || 0,
        }))
        .filter((value) => value.url)
        .sort((a, b) => b.quality - a.quality || b.bitrate - a.bitrate);
      if (candidates.length) return candidates[0].url;
    }
    return (
      XiaohongshuUserRSS.public_url(video?.url) ||
      XiaohongshuUserRSS.public_url(video?.consumer?.originVideoKey)
    );
  }
  static async request_text(ctx, url, options = {}) {
    options = {
      ...options,
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        Referer: "https://www.xiaohongshu.com/",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36",
        ...options.headers,
      },
    };
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
const script = new XiaohongshuUserRSS();
export const route = {
  name: "小红书用户笔记",
  path: "/xiaohongshu/user/profile/:uid",
  url: "www.xiaohongshu.com",
  maintainers: ["findrss"],
  example: "/xiaohongshu/user/profile/5d2aec020000000012037401",
  parameters: {
    uid: "用户主页 /user/profile/ 后的 24 位十六进制 ID，不是小红书号",
  },
  description:
    "默认读取用户主页首屏笔记和封面；添加 ?full_content=true（或 1）逐条请求详情，获取完整正文、图集和视频。Cookie 须由管理员确认后显式获取。",
  handler: (ctx) => script.run(ctx),
};
