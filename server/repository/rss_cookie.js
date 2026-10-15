// rss_cookie_store 的读写：只存一行（id = 1），内容是脚本抓取用的 cookie 数组。
//
// 纯 SQL 层：只回原始数据（解析后的 cookie 数组 / 写入），不 import domain、不造 Response。

export class RepositoryRssCookie {
  /** @param {{ sql: SqlStorage }} deps */
  constructor({ sql }) {
    this.sql = sql;
  }

  /** @returns {Record<string, unknown>[]} */
  get() {
    const row = this.sql
      .exec("SELECT cookies_json FROM rss_cookie_store WHERE id = 1")
      .toArray()[0];
    if (row === undefined) return [];
    try {
      const cookies = JSON.parse(String(row.cookies_json));
      return Array.isArray(cookies) ? cookies : [];
    } catch {
      return [];
    }
  }

  /**
   * @param {Record<string, unknown>[]} cookies 已归一化的 cookie 列表
   * @param {number} now
   * @returns {void}
   */
  put(cookies, now) {
    this.sql.exec(
      `INSERT INTO rss_cookie_store (id, cookies_json, updated_at) VALUES (1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET cookies_json = excluded.cookies_json,
         updated_at = excluded.updated_at`,
      JSON.stringify(cookies),
      now);
  }
}
