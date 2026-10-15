/** HOT */
export const platform = {"name": "网页", "icon": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"#98a0ae\" stroke-width=\"1.5\" stroke-linecap=\"round\" stroke-linejoin=\"round\" data-n=\"website-platform-icon\"><circle cx=\"12\" cy=\"12\" r=\"8.5\" data-n=\"website-icon-circle-1\" /><ellipse cx=\"12\" cy=\"12\" rx=\"3.6\" ry=\"8.5\" data-n=\"website-icon-ellipse-2\" /><path d=\"M3.7 9.4h16.6M3.7 14.6h16.6\" data-n=\"website-icon-path-3\" /></svg>"};
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
  "id": "xueqiu-hotstock",
  "name": "雪球 · 热门股票",
  "home": "https://xueqiu.com"
};
export const permissions = {
  "cookies": [{
    "id": "xueqiu",
    "origin": "https://stock.xueqiu.com",
    "path_prefix": "/v5/stock/hot_stock/",
    "names": ["xq_a_token", "xq_r_token", "u"],
    "purpose": "读取雪球热门股票列表"
  }]
};
export class XueqiuHotstockHotRank extends HotRankScript {
  async fetch(ctx) {
    try {
      const request_options = {};
      request_options.headers = {
        Referer: source.home,
        ...request_options.headers
      };
      const acquired = await ctx.cookies.get("xueqiu");
      if (acquired.error) return acquired;
      request_options.cookies = acquired.data;
      const fetched = await utils.request_json(ctx, "https://stock.xueqiu.com/v5/stock/hot_stock/list.json?size=30&_type=10&type=10", request_options);
      if (fetched.error) return fetched;
      const data = fetched.data;
      if (!data || typeof data !== 'object') return Result.Err('上游未返回数据对象', 'UPSTREAM_INVALID_RESPONSE');
      if (data.need_force_login) return Result.Err('上游要求登录，请更新并授权 Cookie', 'UPSTREAM_AUTH_REQUIRED');
      if (data.error || data.errors?.length || (typeof data.code === 'number' && data.code < 0) || (data.error_code !== undefined && data.error_code !== 0)) return Result.Err('上游拒绝请求，请检查账户权限或验证页面', 'UPSTREAM_INVALID_RESPONSE');
      const list = utils.array_at(data, "data.items");
      if (list.error) return list;
      const rows = list.data;
      const entries = [],
        seen = new Set();
      for (const row of rows) {
        if (row.ad) continue;
        const id = utils.identity(row.code);
        if (id.error) return id;
        if (seen.has(id.data)) continue;
        seen.add(id.data);
        const link = utils.absolute_url('https://xueqiu.com/S/' + encodeURIComponent(id.data), source.home);
        if (link.error) return link;
        const pinned = false;
        const raw_rank = row.rank;
        const rank = pinned ? null : raw_rank === undefined || raw_rank === null || raw_rank === '' ? null : Number(raw_rank);
        const heat_text = String(row.value ?? '').trim();
        const heat_number = heat_text === '' ? NaN : Number(heat_text.replace(/,/g, ''));
        entries.push({
          id: source.id + ':' + id.data,
          title: utils.plain_text(row.name + ' (' + id.data + ')'),
          link: link.data,
          rank,
          pinned,
          heat: {
            value: Number.isFinite(heat_number) && heat_number >= 0 ? heat_number : null,
            unit: "关注热度",
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
const script = new XueqiuHotstockHotRank();
export const route = {
  "name": "雪球 · 热门股票",
  "path": "/xueqiu/hotstock",
  "url": "xueqiu.com",
  "maintainers": ["findrss"],
  "example": "/xueqiu/hotstock",
  "parameters": {},
  "description": "列表快照 JSON，保留上游顺序、已提供的排名与热度；未知排名和热度为 null。",
  handler: ctx => script.run(ctx),
};
