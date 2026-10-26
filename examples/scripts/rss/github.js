import { utils } from "@findrss/util";

export const version = "1.0.0";
export const platform = {
  name: "GitHub",
  icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" data-n="github-platform-icon"><path data-n="github-icon-mark" d="M12 .3a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2.2c-3.3.7-4-1.4-4-1.4-.5-1.4-1.3-1.8-1.3-1.8-1.1-.8.1-.8.1-.8 1.2.1 1.8 1.2 1.8 1.2 1.1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.8-1.6-2.7-.3-5.5-1.3-5.5-5.9 0-1.3.5-2.4 1.2-3.2-.1-.3-.5-1.5.2-3.2 0 0 1-.3 3.3 1.2a11.4 11.4 0 0 1 6 0C17.4 4.9 18.4 5.2 18.4 5.2c.7 1.7.3 2.9.2 3.2.8.8 1.2 1.9 1.2 3.2 0 4.6-2.8 5.6-5.5 5.9.4.4.8 1.1.8 2.2v3.4c0 .3.2.7.8.6A12 12 0 0 0 12 .3Z"/></svg>',
};

export class GithubReleasesRSS extends RSSScript {
  async fetch(ctx) {
    try {
      const org = String(ctx.params?.org || "");
      const pro = String(ctx.params?.pro || "");
      if (!/^[A-Za-z0-9-]{1,39}$/.test(org)) {
        return Result.Err(
          "org 必须为 1–39 位字母、数字或连字符",
          "INVALID_PARAMETER",
        );
      }
      if (!/^[A-Za-z0-9_.-]{1,100}$/.test(pro) || pro === "." || pro === "..") {
        return Result.Err(
          "pro 必须为 1–100 位字母、数字、下划线、点或连字符，且不能为 . 或 ..",
          "INVALID_PARAMETER",
        );
      }
      const repository = org + "/" + pro;
      const link = "https://github.com/" + repository + "/releases";
      const fetched = await utils.request_text(ctx, link + ".atom", {
        headers: {
          Accept: "application/atom+xml,application/xml;q=0.9,*/*;q=0.8",
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36",
          Referer: link,
        },
      });
      if (fetched.error) return fetched;
      const parsed = utils.document_nodes(fetched.data, true);
      if (parsed.error) return parsed;
      const feed = utils.first(parsed.data, "feed");
      if (!feed) {
        return Result.Err(
          "GitHub 未返回发布订阅，请确认公开仓库存在且可访问",
          "UPSTREAM_INVALID_RESPONSE",
        );
      }
      const items = utils.select(feed, "entry").map((entry) => {
        const link =
          utils.attribute(entry, 'link[rel="alternate"]', "href") ||
          utils.attribute(entry, "link[href]", "href");
        const body =
          utils.first(entry, "content") || utils.first(entry, "summary");
        const content = utils
          .descendants(body)
          .map((node) => node.text || "")
          .join("");
        return {
          id: utils.field(entry, "id") || link,
          title: utils.field(entry, "title"),
          link,
          description: utils.plain_text(content),
          content,
          published: utils.field(entry, "published") || undefined,
          updated: utils.field(entry, "updated") || undefined,
          author: utils.field(entry, "author > name") || org,
        };
      });
      return Result.Ok({
        id: "github:releases:" + repository,
        title: repository + " Releases",
        link,
        description: repository + " 的 GitHub 发布记录",
        language: feed.attrs["xml:lang"] || "",
        author: { name: org, uri: "https://github.com/" + org },
        updated: utils.field(feed, "> updated") || undefined,
        items,
      });
    } catch (error) {
      return Result.Err(error, error?.code ?? "UPSTREAM_INVALID_RESPONSE");
    }
  }
}

const script = new GithubReleasesRSS();
export const routes = [
  {
    path: "/github/:org/:pro/release",
    name: "GitHub 发布列表",
    url: "github.com",
    maintainers: ["findrss"],
    example: "/github/ltaoo/wx_channels_download/release",
    parameters: { org: "GitHub 用户或组织名", pro: "仓库名" },
    description:
      "读取公开仓库的 Releases Atom 订阅，保留版本标题、更新说明、链接和上游时间，无需 Cookie。",
    handler: (ctx) => script.run(ctx),
  },
];
