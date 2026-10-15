/** HOT */
export const platform = {"name": "微博", "icon": "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"32\" height=\"32\" viewBox=\"0 0 32 32\" data-n=\"weibo-platform-icon\"><path fill=\"red\" d=\"M1 18c-1-5 3-9 9-10 1-3 4-5 7-4 3 1 3 4 2 6 5 1 9 4 9 8 0 6-8 11-16 11C5 29 1 25 1 18Z\" data-n=\"weibo-icon-path-1\" /><path fill=\"#fff\" d=\"M5 21c0-4 4-6 9-6s9 2 9 6-4 6-9 6-9-2-9-6Z\" data-n=\"weibo-icon-path-2\" /><circle cx=\"13\" cy=\"21\" r=\"3.2\" data-n=\"weibo-icon-circle-3\" /><circle cx=\"12\" cy=\"20\" r=\".8\" fill=\"#fff\" data-n=\"weibo-icon-circle-4\" /><path fill=\"none\" stroke=\"#ff0\" stroke-linecap=\"round\" stroke-width=\"1.6\" d=\"M22 9c3 1 5 3 6 6M23 6c4 1 7 4 8 8\" data-n=\"weibo-icon-path-5\" /></svg>"};
import { utils } from '@findrss/util';
/*
Adapted from https://github.com/newsnext/newsnow/tree/0f95b2c998dffbfd2ddbc51b47b5809887dc6b97/server/sources
MIT License

Copyright (c) 2024 ourongxing

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

*/
const source = {
  "id": "weibo",
  "name": "微博 · 实时热搜",
  "home": "https://weibo.com"
};
export const permissions = {
  "cookies": [{
    "id": "weibo",
    "origin": "https://s.weibo.com",
    "path_prefix": "/top/",
    "names": ["SUB", "SUBP"],
    "purpose": "读取微博实时热搜榜"
  }]
};
export class WeiboHotRank extends HotRankScript {
  async fetch(ctx) {
    try {
      const request_options = {};
      request_options.headers = {
        Referer: source.home,
        ...request_options.headers
      };
      const acquired = await ctx.cookies.get("weibo");
      if (acquired.error) return acquired;
      request_options.cookies = acquired.data;
      const fetched = await utils.request_text(ctx, "https://s.weibo.com/top/summary?cate=realtimehot", request_options);
      if (fetched.error) return fetched;
      const parsed = utils.document_nodes(fetched.data);
      if (parsed.error) return parsed;
      const list = utils.rows(parsed.data, "#pl_top_realtimehot table tbody tr");
      if (list.error) return list;
      const rows = list.data;
      const entries = [],
        seen = new Set();
      for (const row of rows) {
        if (!utils.first(row, 'td.td-02 a')) continue;
        const id = utils.identity(utils.field(row, "td.td-02 a"));
        if (id.error) return id;
        if (seen.has(id.data)) continue;
        seen.add(id.data);
        const link = utils.absolute_url(utils.attribute(row, "td.td-02 a", "href"), "https://s.weibo.com/");
        if (link.error) return link;
        const pinned = utils.first(row, '.icon-top') !== undefined || utils.field(row, "td.td-01") === '置顶';
        const raw_rank = utils.field(row, "td.td-01");
        const rank = pinned ? null : raw_rank === undefined || raw_rank === null || raw_rank === '' ? null : Number(raw_rank);
        const heat_text = String(utils.field(row, "td.td-02 span") ?? '').trim();
        const heat_number = heat_text === '' ? NaN : Number(heat_text.replace(/,/g, ''));
        entries.push({
          id: source.id + ':' + id.data,
          title: utils.plain_text(utils.field(row, "td.td-02 a")),
          link: link.data,
          rank,
          pinned,
          heat: {
            value: Number.isFinite(heat_number) && heat_number >= 0 ? heat_number : null,
            unit: "热度",
            text: heat_text
          }
        });
      }
      ctx.log('榜单解析完成', {
        source: source.id,
        count: entries.length,
        missing_rank: entries.filter(entry => entry.rank === null && !entry.pinned).length
      });
      return Result.Ok({
        title: source.name,
        link: source.home,
        entries
      });
    } catch (error) {
      return Result.Err(error, error?.code ?? 'UPSTREAM_INVALID_RESPONSE');
    }
  }
}
const script = new WeiboHotRank();
export const route = {
  "name": "微博 · 实时热搜",
  "path": "/weibo/hot",
  "url": "weibo.com",
  "maintainers": ["findrss"],
  "example": "/weibo/hot",
  "parameters": {},
  "description": "列表快照 JSON，保留上游顺序、已提供的排名与热度；未知排名和热度为 null。",
  handler: ctx => script.run(ctx),
};
