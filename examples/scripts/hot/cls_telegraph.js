/** HOT */
export const version = "1.0.0";
export const platform = {"name": "网页"};
import {
  utils
} from '@findrss/util';
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
  "id": "cls-telegraph",
  "name": "财联社 · 电报",
  "home": "https://www.cls.cn"
};
export class ClsTelegraphHotRank extends HotRankScript {
  async fetch(ctx) {
    try {
      const request_options = {
        headers: {
          Referer: "https://www.cls.cn/telegraph"
        }
      };
      request_options.headers = {
        Referer: source.home,
        ...request_options.headers
      };
      const fetched = await utils.request_json(ctx, "https://www.cls.cn/v1/roll/get_roll_list?" + this.signed_query({
        last_time: Math.floor(Date.now() / 1000),
        refresh_type: 1,
        rn: 30
      }), request_options);
      if (fetched.error) return fetched;
      const data = fetched.data;
      if (!data || typeof data !== 'object') return Result.Err('上游未返回数据对象', 'UPSTREAM_INVALID_RESPONSE');
      if (data.need_force_login) return Result.Err('上游要求登录，请更新并授权 Cookie', 'UPSTREAM_AUTH_REQUIRED');
      if (data.error || data.errors?.length || (typeof data.code === 'number' && data.code < 0) || (data.error_code !== undefined && data.error_code !== 0)) return Result.Err('上游拒绝请求，请检查账户权限或验证页面', 'UPSTREAM_INVALID_RESPONSE');
      const list = utils.array_at(data, "data.roll_data");
      if (list.error) return list;
      const rows = list.data;
      const entries = [],
        seen = new Set();
      for (const row of rows) {
        if (row.is_ad) continue;
        const id = utils.identity(row.id);
        if (id.error) return id;
        if (seen.has(id.data)) continue;
        seen.add(id.data);
        const link = utils.absolute_url('https://www.cls.cn/detail/' + encodeURIComponent(id.data), source.home);
        if (link.error) return link;
        const pinned = false;
        const raw_rank = row.rank;
        const rank = pinned ? null : raw_rank === undefined || raw_rank === null || raw_rank === '' ? null : Number(raw_rank);
        const heat_text = String(row.reading_num ?? '').trim();
        const heat_number = heat_text === '' ? NaN : Number(heat_text.replace(/,/g, ''));
        entries.push({
          id: source.id + ':' + id.data,
          title: utils.plain_text(row.title || row.brief),
          link: link.data,
          rank,
          pinned,
          heat: {
            value: Number.isFinite(heat_number) && heat_number >= 0 ? heat_number : null,
            unit: "阅读量",
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
  md5_ascii(value) {
    const bytes = [];
    for (let i = 0; i < value.length; i++) bytes.push(value.charCodeAt(i));
    const length = bytes.length;
    bytes.push(128);
    while (bytes.length % 64 !== 56) bytes.push(0);
    for (let i = 0; i < 8; i++)
      bytes.push(Math.floor((length * 8) / Math.pow(256, i)) & 255);
    let state = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476];
    const shifts = [
      [7, 12, 17, 22],
      [5, 9, 14, 20],
      [4, 11, 16, 23],
      [6, 10, 15, 21],
    ];
    for (let offset = 0; offset < bytes.length; offset += 64) {
      const words = [];
      for (let i = 0; i < 16; i++) {
        const p = offset + i * 4;
        words.push(
          bytes[p] |
          (bytes[p + 1] << 8) |
          (bytes[p + 2] << 16) |
          (bytes[p + 3] << 24),
        );
      }
      let [a, b, c, d] = state;
      for (let i = 0; i < 64; i++) {
        let f, g;
        if (i < 16) {
          f = (b & c) | (~b & d);
          g = i;
        } else if (i < 32) {
          f = (d & b) | (~d & c);
          g = (5 * i + 1) % 16;
        } else if (i < 48) {
          f = b ^ c ^ d;
          g = (3 * i + 5) % 16;
        } else {
          f = c ^ (b | ~d);
          g = (7 * i) % 16;
        }
        const sum =
          (a +
            f +
            Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) +
            words[g]) |
          0;
        const shift = shifts[Math.floor(i / 16)][i % 4];
        const next = (b + ((sum << shift) | (sum >>> (32 - shift)))) | 0;
        a = d;
        d = c;
        c = b;
        b = next;
      }
      state = state.map((v, i) => (v + [a, b, c, d][i]) | 0);
    }
    return state
      .map((v) => [0, 8, 16, 24]
        .map((s) => ((v >>> s) & 255).toString(16).padStart(2, "0"))
        .join(""),
      )
      .join("");
  }
  sha1_ascii(value) {
    const bytes = [...value].map(char => char.charCodeAt(0)),
      length = bytes.length;
    bytes.push(128);
    while (bytes.length % 64 !== 56) bytes.push(0);
    for (let i = 7; i >= 0; i--) bytes.push(Math.floor(length * 8 / 256 ** i) & 255);
    const rotate = (value, bits) => (value << bits) | (value >>> (32 - bits));
    let state = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0];
    for (let offset = 0; offset < bytes.length; offset += 64) {
      const words = [];
      for (let i = 0; i < 16; i++) {
        const p = offset + i * 4;
        words.push((bytes[p] << 24) | (bytes[p + 1] << 16) | (bytes[p + 2] << 8) | bytes[p + 3]);
      }
      for (let i = 16; i < 80; i++) words.push(rotate(words[i - 3] ^ words[i - 8] ^ words[i - 14] ^ words[i - 16], 1));
      let [a, b, c, d, e] = state;
      for (let i = 0; i < 80; i++) {
        const f = i < 20 ? (b & c) | (~b & d) : i < 40 ? b ^ c ^ d : i < 60 ? (b & c) | (b & d) | (c & d) : b ^ c ^ d;
        const k = i < 20 ? 0x5a827999 : i < 40 ? 0x6ed9eba1 : i < 60 ? 0x8f1bbcdc : 0xca62c1d6;
        const next = (rotate(a, 5) + f + e + k + words[i]) | 0;
        e = d;
        d = c;
        c = rotate(b, 30);
        b = a;
        a = next;
      }
      state = state.map((value, i) => (value + [a, b, c, d, e][i]) | 0);
    }
    return state.map(value => (value >>> 0).toString(16).padStart(8, "0")).join("");
  }
  signed_query(more = {}) {
    const params = {
      appName: "CailianpressWeb",
      os: "web",
      sv: "7.7.5",
      ...more
    };
    const query = Object.keys(params).sort().map(key => encodeURIComponent(key) + "=" + encodeURIComponent(params[key])).join("&");
    return query + "&sign=" + this.md5_ascii(this.sha1_ascii(query));
  }
}
const script = new ClsTelegraphHotRank();
export const route = {
  "name": "财联社 · 电报",
  "path": "/cls/telegraph",
  "url": "www.cls.cn",
  "maintainers": ["findrss"],
  "example": "/cls/telegraph",
  "parameters": {},
  "description": "列表快照 JSON，保留上游顺序、已提供的排名与热度；未知排名和热度为 null。",
  handler: ctx => script.run(ctx),
};
