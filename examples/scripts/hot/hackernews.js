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
  "id": "hackernews",
  "name": "Hacker News",
  "home": "https://news.ycombinator.com/"
};
export class HackernewsHotRank extends HotRankScript {
  async fetch(ctx) {
    try {
      let rows;
      const fetched = await utils.request_text(ctx, 'https://news.ycombinator.com/', {
        headers: {
          Referer: source.home
        }
      });
      if (!fetched.error) {
        const parsed = utils.document_nodes(fetched.data);
        if (!parsed.error) {
          const list = utils.rows(parsed.data, '.athing');
          if (!list.error) rows = list.data.map(row => ({
            id: row.attrs.id,
            title: utils.field(row, '.titleline a'),
            link: 'https://news.ycombinator.com/item?id=' + encodeURIComponent(row.attrs.id),
            rank: utils.field(row, '.rank').replace(/\.$/, '') || null,
            points: utils.field(parsed.data, '#score_' + row.attrs.id).replace(/ points?$/, '')
          }));
        }
      }
      if (!rows) {
        ctx.log('Hacker News 首页获取失败，尝试 hnrss');
        const fallback = await utils.request_text(ctx, 'https://hnrss.org/frontpage?count=30');
        if (fallback.error) return fallback;
        const parsed = utils.feed_items(fallback.data, 'https://hnrss.org/');
        if (parsed.error) return parsed;
        rows = parsed.data.map(row => {
          const link = row.description.match(/Comments URL:\s*<a[^>]*href=["']([^"']+)/i)?.[1] || row.link;
          return {
            ...row,
            id: link.match(/[?&]id=(\d+)/)?.[1] || row.id,
            link,
            rank: null
          };
        });
      }
      const entries = [],
        seen = new Set();
      for (const row of rows) {
        const id = utils.identity(row.id);
        if (id.error) return id;
        if (seen.has(id.data)) continue;
        seen.add(id.data);
        const link = utils.absolute_url(row.link, source.home);
        if (link.error) return link;
        const pinned = false;
        const raw_rank = row.rank;
        const rank = pinned ? null : raw_rank === undefined || raw_rank === null || raw_rank === '' ? null : Number(raw_rank);
        const heat_text = String(row.points ?? '').trim();
        const heat_number = heat_text === '' ? NaN : Number(heat_text.replace(/,/g, ''));
        entries.push({
          id: source.id + ':' + id.data,
          title: utils.plain_text(row.title),
          link: link.data,
          rank,
          pinned,
          heat: {
            value: Number.isFinite(heat_number) && heat_number >= 0 ? heat_number : null,
            unit: "积分",
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
const script = new HackernewsHotRank();
export const route = {
  "name": "Hacker News",
  "path": "/hackernews",
  "url": "news.ycombinator.com",
  "maintainers": ["findrss"],
  "example": "/hackernews",
  "parameters": {},
  "description": "列表快照 JSON，保留上游顺序、已提供的排名与热度；未知排名和热度为 null。",
  handler: ctx => script.run(ctx),
};
