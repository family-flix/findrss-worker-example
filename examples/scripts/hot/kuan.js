/** HOT */
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
  "id": "coolapk",
  "name": "酷安 · 今日最热",
  "home": "https://coolapk.com"
};
export class KuanHotRank extends HotRankScript {
  async fetch(ctx) {
    try {
      const request_options = {
        headers: this.app_headers()
      };
      request_options.headers = {
        Referer: source.home,
        ...request_options.headers
      };
      const fetched = await utils.request_json(ctx, "https://api.coolapk.com/v6/page/dataList?url=%2Ffeed%2FstatList%3FcacheExpires%3D300%26statType%3Dday%26sortField%3Ddetailnum%26title%3D%E4%BB%8A%E6%97%A5%E7%83%AD%E9%97%A8&title=%E4%BB%8A%E6%97%A5%E7%83%AD%E9%97%A8&subTitle=&page=1", request_options);
      if (fetched.error) return fetched;
      const data = fetched.data;
      if (!data || typeof data !== 'object') return Result.Err('上游未返回数据对象', 'UPSTREAM_INVALID_RESPONSE');
      if (data.need_force_login) return Result.Err('上游要求登录，请更新并授权 Cookie', 'UPSTREAM_AUTH_REQUIRED');
      if (data.error || data.errors?.length || (typeof data.code === 'number' && data.code < 0) || (data.error_code !== undefined && data.error_code !== 0)) return Result.Err('上游拒绝请求，请检查账户权限或验证页面', 'UPSTREAM_INVALID_RESPONSE');
      const list = utils.array_at(data, "data");
      if (list.error) return list;
      const rows = list.data;
      const entries = [],
        seen = new Set();
      for (const row of rows) {
        if (!row.id) continue;
        const id = utils.identity(row.id);
        if (id.error) return id;
        if (seen.has(id.data)) continue;
        seen.add(id.data);
        const link = utils.absolute_url(row.url, "https://www.coolapk.com/");
        if (link.error) return link;
        const pinned = false;
        const raw_rank = row.rank;
        const rank = pinned ? null : raw_rank === undefined || raw_rank === null || raw_rank === '' ? null : Number(raw_rank);
        const heat_text = String(row.targetRow?.subTitle ?? '').trim();
        const heat_number = heat_text === '' ? NaN : Number(heat_text.replace(/,/g, ''));
        entries.push({
          id: source.id + ':' + id.data,
          title: utils.plain_text(row.editor_title || utils.plain_text(row.message).split('\n')[0]),
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
  base64_ascii(value) {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let encoded = "";
    for (let i = 0; i < value.length; i += 3) {
      const chunk = (value.charCodeAt(i) << 16) | ((value.charCodeAt(i + 1) || 0) << 8) | (value.charCodeAt(i + 2) || 0);
      encoded += alphabet[(chunk >>> 18) & 63] + alphabet[(chunk >>> 12) & 63] + (i + 1 < value.length ? alphabet[(chunk >>> 6) & 63] : "=") + (i + 2 < value.length ? alphabet[chunk & 63] : "=");
    }
    return encoded;
  }
  app_headers() {
    const device = [10, 6, 6, 6, 14].map(length => Math.random().toString(36).substring(2, length)).join("-");
    const now = Math.round(Date.now() / 1000);
    const seed = "token://com.coolapk.market/c67ef5943784d09750dcfbb31020f0ab?" + this.md5_ascii(String(now)) + "$" + device + "&com.coolapk.market";
    return {
      "X-Requested-With": "XMLHttpRequest",
      "X-App-Id": "com.coolapk.market",
      "X-App-Token": this.md5_ascii(this.base64_ascii(seed)) + device + "0x" + now.toString(16),
      "X-Sdk-Int": "29",
      "X-Sdk-Locale": "zh-CN",
      "X-App-Version": "11.0",
      "X-Api-Version": "11",
      "X-App-Code": "2101202",
      "User-Agent": "Dalvik/2.1.0 (Linux; U; Android 10; Redmi K30 5G MIUI/V12.0.3.0.QGICMXM) (#Build; Redmi; Redmi K30 5G; QKQ1.191222.002 test-keys; 10) +CoolMarket/11.0-2101202"
    };
  }
}
const script = new KuanHotRank();
export const route = {
  "name": "酷安 · 今日最热",
  "path": "/kuan",
  "url": "coolapk.com",
  "maintainers": ["findrss"],
  "example": "/kuan",
  "parameters": {},
  "description": "列表快照 JSON，保留上游顺序、已提供的排名与热度；未知排名和热度为 null。",
  handler: ctx => script.run(ctx),
};
