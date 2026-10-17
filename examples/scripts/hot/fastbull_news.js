/** HOT */
export const version = "1.0.0";
export const platform = {"name": "网页"};
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
  "id": "fastbull-news",
  "name": "法布财经 · 头条",
  "home": "https://www.fastbull.cn"
};
export class FastbullNewsHotRank extends HotRankScript {
  async fetch(ctx) {
    try {
      const request_options = {};
      request_options.headers = {
        Referer: source.home,
        ...request_options.headers
      };
      const fetched = await utils.request_text(ctx, "https://www.fastbull.com/cn/news", request_options);
      if (fetched.error) return fetched;
      const parsed = utils.document_nodes(fetched.data);
      if (parsed.error) return parsed;
      const list = utils.rows(parsed.data, ".trending_type");
      if (list.error) return list;
      const rows = list.data;
      const entries = [],
        seen = new Set();
      for (const row of rows) {
        const id = utils.identity(row.attrs.href);
        if (id.error) return id;
        if (seen.has(id.data)) continue;
        seen.add(id.data);
        const link = utils.absolute_url(row.attrs.href, "https://www.fastbull.com/");
        if (link.error) return link;
        const pinned = false;
        const raw_rank = null;
        const rank = pinned ? null : raw_rank === undefined || raw_rank === null || raw_rank === '' ? null : Number(raw_rank);
        const heat_text = String('' ?? '').trim();
        const heat_number = heat_text === '' ? NaN : Number(heat_text.replace(/,/g, ''));
        entries.push({
          id: source.id + ':' + id.data,
          title: utils.plain_text(utils.field(row, ".title")),
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
const script = new FastbullNewsHotRank();
export const route = {
  "name": "法布财经 · 头条",
  "path": "/fastbull/news",
  "url": "www.fastbull.cn",
  "maintainers": ["findrss"],
  "example": "/fastbull/news",
  "parameters": {},
  "description": "列表快照 JSON，保留上游顺序、已提供的排名与热度；未知排名和热度为 null。",
  handler: ctx => script.run(ctx),
};
