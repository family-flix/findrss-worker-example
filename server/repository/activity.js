// user_events 表的读写：操作事件落库、按 keyset 翻页与保留期/条数裁剪。
//
// 纯 SQL 层：只回原始行 / void，不 import service、不造 Response。
// 字段归一（类型兜底、subject 截断、metadata 序列化）由调用方在写前完成。

export class RepositoryActivity {
  /** @param {{ sql: D1Store }} deps */
  constructor({
    sql
  }) {
    this.sql = sql;
  }

  /**
   * @param {{
   *   id: string, user_id: string, access_token_id: string, type: string,
   *   subject: string, metadata_json: string, created_at: number,
   * }} fields
   * @returns {void}
   */
  async insert(fields) {
    await this.sql.exec(`INSERT INTO user_events
         (id, user_id, access_token_id, type, subject, metadata_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`, fields.id, fields.user_id, fields.access_token_id, fields.type, fields.subject, fields.metadata_json, fields.created_at);
  }

  /**
   * 某用户的一页事件，多取一条判有无下一页。
   * @param {string} user_id
   * @param {string} clause_suffix 已带前导 " AND " 的片段，可为空串
   * @param {unknown[]} params
   * @param {number} limit 调用方传「页大小 + 1」
   * @returns {Record<string, unknown>[]}
   */
  async rows_for_user(user_id, clause_suffix, params, limit) {
    return (await this.sql.exec(`SELECT * FROM user_events WHERE user_id = ?${clause_suffix}
         ORDER BY created_at DESC, id DESC LIMIT ?`, user_id, ...params, limit)).toArray();
  }

  /** @param {number} cutoff @returns {void} */
  async delete_before(cutoff) {
    await this.sql.exec("DELETE FROM user_events WHERE created_at < ?", cutoff);
  }

  /** @returns {string[]} 事件流里出现过的用户 id。 */
  async list_user_ids() {
    return (await this.sql.exec("SELECT DISTINCT user_id FROM user_events")).toArray().map(row => String(row.user_id));
  }

  /**
   * 每用户只保留最近 `max` 条，其余删除。
   * @param {string} user_id @param {number} max @returns {void}
   */
  async trim_user(user_id, max) {
    await this.sql.exec(`DELETE FROM user_events WHERE user_id = ? AND id NOT IN (
         SELECT id FROM user_events WHERE user_id = ?
         ORDER BY created_at DESC, id DESC LIMIT ?
       )`, user_id, user_id, max);
  }
}
