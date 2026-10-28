export const DEFAULT_RSS_SCRIPT = String.raw`/** RSS */
import { utils } from '@findrss/util';
export const kind = 'rss';
export const tags = ['科技', '文章'];
class SolidotRSS extends RSSScript {
  async fetch(ctx) {
    ctx.log('开始获取 Solidot RSS');
    const fetched = await utils.request_text(ctx, 'https://www.solidot.org/index.rss');
    if (fetched.error) return fetched;
    const items = utils.feed_items(fetched.data, 'https://www.solidot.org/');
    if (items.error) return items;
    ctx.log('RSS 解析完成', { count: items.data.length });
    return Result.Ok({ title: 'Solidot', link: 'https://www.solidot.org/', description: 'Solidot 最新文章', items: items.data });
  }
}
const script = new SolidotRSS();
export const route = { path: '/solidot', name: 'Solidot', platform: {"name": "网页"}, url: 'https://www.solidot.org/',
  maintainers: [{ nickname: 'findrss', url: '', avatar: '' }], handler: ctx => script.run(ctx) };
`;

export const DEFAULT_HOT_SCRIPT = String.raw`/** HOT */
export const platform = {"name": "网页"};
export const kind = "hot";
export const tags = ["热榜"];
import { utils } from "@findrss/util";

// 热榜是一次榜单快照：rank 决定顺序，heat 表达平台热度，observed_at 是采集时间。
// HotRankScript 由宿主 QuickJS 注入，无需导入或重复声明。
export class BaiduHotRank extends HotRankScript {
  async fetch(ctx) {
    try {
      ctx.log("获取百度首页热榜");
      const r = await ctx.fetchText("https://www.baidu.com/", {
        headers: { "User-Agent": "Mozilla/5.0" },
      });
      if (r.error) {
        return r;
      }
      const html = r.data;
      const embedded = html.match(
        /<textarea\b[^>]*\bid\s*=\s*["']hotsearch_data["'][^>]*>([\s\S]*?)<\/textarea\s*>/i,
      );
      let rows;
      if (embedded) {
        const parsed = parseJSON(utils.decode_html(embedded[1]));
        if (parsed.error) {
          return Result.Err(
            "百度 hotsearch_data 不是有效 JSON",
            "UPSTREAM_INVALID_RESPONSE",
          );
        }
        rows = parsed.data?.hotsearch;
      } else {
        rows = [];
        const match_segments = html.matchAll(
          /<li\b[^>]*\bclass=["'][^"']*\bhotsearch-item\b[^"']*["'][^>]*>[\s\S]*?<\/li\s*>/gi,
        );
        for (const match of match_segments) {
          const block = match[0];
          const title = block.match(
            /<span\b[^>]*\bclass=["'][^"']*\btitle-content-title\b[^"']*["'][^>]*>([\s\S]*?)<\/span\s*>/i,
          );
          const decoded = utils.decode_html(
            title ? title[1].replace(/<[^>]*>/g, "") : "",
          );
          rows.push({
            card_title: decoded,
            index: block.match(/\bdata-index=["'](\d+)["']/i)?.[1],
          });
        }
      }
      if (!Array.isArray(rows) || !rows.length) {
        return Result.Err(
          "百度首页未找到热榜，可能返回了验证页",
          "UPSTREAM_INVALID_RESPONSE",
        );
      }
      const entries = [];
      for (const row of rows) {
        if (!row || !/^\d+$/.test(String(row.index))) {
          return Result.Err(
            "百度热榜条目缺少有效排名",
            "UPSTREAM_INVALID_RESPONSE",
          );
        }
        const title = String(row.card_title || "").trim();
        const rank = Number(row.index);
        const heat_text = String(row.heat_score ?? "").trim();
        entries.push({
          id: "baidu:" + encodeURIComponent(title),
          title,
          link: "https://www.baidu.com/s?wd=" + encodeURIComponent(title),
          rank: rank === 0 ? null : rank,
          pinned: rank === 0,
          heat: {
            value: heat_text === "" ? null : Number(heat_text),
            unit: "百度热度",
            text: heat_text,
          },
        });
      }
      return Result.Ok({
        title: "百度热榜",
        link: "https://www.baidu.com/",
        entries,
      });
    } catch (error) {
      return Result.Err(error, error?.code ?? "UPSTREAM_INVALID_RESPONSE");
    }
  }
}

const script = new BaiduHotRank();
// 当前宿主的普通路由输出 JSON；热榜不冒充含 items 的 RSS feed。
export const route = {
  path: "/baidu/hot",
  name: "百度热榜",
  url: "https://www.baidu.com/",
  maintainers: ["findrss"],
  example: "/baidu/hot",
  parameters: {},
  description: "榜单快照 JSON，包含上游排名、热度和采集时间。",
  handler: (ctx) => script.run(ctx),
};

`;

export const DEFAULT_CLIP_SCRIPT = "/*\nMIT License\n\nCopyright (c) 2026 ltaoo\n\nPermission is hereby granted, free of charge, to any person obtaining a copy\nof this software and associated documentation files (the \"Software\"), to deal\nin the Software without restriction, including without limitation the rights\nto use, copy, modify, merge, publish, distribute, sublicense, and/or sell\ncopies of the Software, and to permit persons to whom the Software is\nfurnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all\ncopies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED \"AS IS\", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR\nIMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,\nFITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE\nAUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER\nLIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,\nOUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE\nSOFTWARE.\n*/\nexport const kind = \"clip\";\nexport const version = \"1.0.0\";\nexport const platform = { name: \"GitHub\", icon: \"\" };\n\nclass GitHubReadmeClip extends ClipScript {\n  async fetch(ctx) {\n    const { owner, repo } = ctx.params;\n    if (!/^[a-zA-Z0-9][a-zA-Z0-9-]{0,38}$/.test(owner || \"\") || !/^[a-zA-Z0-9_.-]{1,100}$/.test(repo || \"\")\n      || repo === \".\" || repo === \"..\") return Result.Err(\"无效的 GitHub 仓库地址\", \"INVALID_PARAMETER\");\n    const link = \"https://github.com/\" + owner + \"/\" + repo;\n    const captured = await ctx.clip.capture(link, {\n      selector: \"article.markdown-body\", viewport: { width: 1280, height: 900 }, wait_ms: 1000,\n    });\n    if (captured.error) return captured;\n    return Result.Ok({ title: owner + \"/\" + repo + \" README\", link,\n      html: captured.data.html, stats: captured.data.stats });\n  }\n}\nconst script = new GitHubReadmeClip();\nexport const route = {\n  path: \"/github/:owner/:repo/readme\", name: \"GitHub README 剪藏\",\n  example: \"/github/ltaoo/findrss-worker/readme\", parameters: { owner: \"所有者\", repo: \"仓库名\" },\n  description: \"保存仓库首页 README，包含正文样式和可读取的图片。\",\n  handler: ctx => script.run(ctx),\n};\n";

export const DEFAULT_DETECT_SCRIPT = "import { utils } from \"@findrss/util\";\nexport const kind = \"detect\";\nexport const version = \"1.0.0\";\nexport const platform = { name: \"GitHub\", icon: \"\" };\n\nclass GitHubReleasesDetect extends DetectScript {\n  async fetch(ctx) {\n    const { owner, repo } = ctx.params;\n    if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(owner || \"\") || !/^[A-Za-z0-9_.-]{1,100}$/.test(repo || \"\") || repo === \".\" || repo === \"..\")\n      return Result.Err(\"无效的 GitHub 仓库地址\", \"INVALID_PARAMETER\");\n    const link = \"https://github.com/\" + owner + \"/\" + repo + \"/releases\";\n    const fetched = await utils.request_text(ctx, link + \".atom\", { headers: { Accept: \"application/atom+xml\" } });\n    if (fetched.error) return fetched;\n    const parsed = utils.document_nodes(fetched.data, true);\n    if (parsed.error) return parsed;\n    const feed = utils.first(parsed.data, \"feed\");\n    if (!feed) return Result.Err(\"GitHub 未返回发布订阅\", \"UPSTREAM_INVALID_RESPONSE\");\n    const items = [];\n    for (const entry of utils.select(feed, \"entry\")) {\n      const address = utils.absolute_url(utils.attribute(entry, 'link[rel=\"alternate\"]', \"href\") || utils.attribute(entry, \"link[href]\", \"href\"), link);\n      if (address.error) return address;\n      const id = utils.field(entry, \"id\") || address.data;\n      const title = utils.field(entry, \"title\");\n      if (!id || !title) return Result.Err(\"发布条目缺少 ID 或标题\", \"UPSTREAM_INVALID_RESPONSE\");\n      const body = utils.first(entry, \"content\") || utils.first(entry, \"summary\");\n      const content = utils.descendants(body).map(node => node.text || \"\").join(\"\");\n      items.push({ id, data: { title, link: address.data, content } });\n    }\n    return Result.Ok({ title: owner + \"/\" + repo + \" Releases 检测\", link,\n      snapshot: { releases: { type: \"list\", coverage: \"window\", scope: \"releases-atom\", ordered: false, items } } });\n  }\n}\nconst script = new GitHubReleasesDetect();\nexport const route = {\n  path: \"/github/:owner/:repo/releases/detect\", name: \"GitHub Releases 内容检测\",\n  example: \"/github/ltaoo/findrss-worker/releases/detect\", parameters: { owner: \"所有者\", repo: \"仓库名\" },\n  description: \"比较 Releases Atom 窗口中的发布标题和说明；窗口移出不代表上游删除。\",\n  handler: ctx => script.run(ctx),\n};\n";
