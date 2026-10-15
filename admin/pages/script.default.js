export const DEFAULT_RSS_SCRIPT = String.raw`/** RSS */
import { utils } from '@findrss/util';
export const kind = 'rss';
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
export const route = { path: '/solidot', name: 'Solidot', platform: {"name": "网页", "icon": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"#98a0ae\" stroke-width=\"1.5\" stroke-linecap=\"round\" stroke-linejoin=\"round\" data-n=\"website-platform-icon\"><circle cx=\"12\" cy=\"12\" r=\"8.5\" data-n=\"website-icon-circle-1\" /><ellipse cx=\"12\" cy=\"12\" rx=\"3.6\" ry=\"8.5\" data-n=\"website-icon-ellipse-2\" /><path d=\"M3.7 9.4h16.6M3.7 14.6h16.6\" data-n=\"website-icon-path-3\" /></svg>"}, url: 'https://www.solidot.org/',
  maintainers: [{ nickname: 'findrss', url: '', avatar: '' }], handler: ctx => script.run(ctx) };
`;

export const DEFAULT_HOT_SCRIPT = String.raw`/** HOT */
export const platform = {"name": "网页", "icon": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"#98a0ae\" stroke-width=\"1.5\" stroke-linecap=\"round\" stroke-linejoin=\"round\" data-n=\"website-platform-icon\"><circle cx=\"12\" cy=\"12\" r=\"8.5\" data-n=\"website-icon-circle-1\" /><ellipse cx=\"12\" cy=\"12\" rx=\"3.6\" ry=\"8.5\" data-n=\"website-icon-ellipse-2\" /><path d=\"M3.7 9.4h16.6M3.7 14.6h16.6\" data-n=\"website-icon-path-3\" /></svg>"};
export const kind = "hot";
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
