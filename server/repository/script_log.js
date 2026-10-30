// script_logs 表的读写：脚本执行日志的落库、按 route 倒序翻页与保留期裁剪。
//
// 纯 SQL 层：只回原始行（`list_by_route`）或写入/删除，不 import domain、不造 Response。
// 字段归一（截断、枚举兜底、JSON 序列化）由调用方在写前完成。

export class RepositoryScriptLog {
  /** @param {{ sql: D1Store }} deps */
  constructor({
    sql
  }) {
    this.sql = sql;
  }

  /**
   * @param {{
   *   route: string, path: string, source: string, method: string, pathname: string,
   *   params_json: string, query_json: string, status: string, phase: string, level: string,
   *   message: string, error_text: string | null, lines_json: string, elapsed_ms: number,
   *   invoked: number, device_id: string | null, created_at: number,
   * }} fields
   * @returns {void}
   */
  async insert(fields) {
    await this.sql.exec(`INSERT INTO script_logs (
        route, path, source, method, pathname, params_json, query_json,
        status, phase, level, message, error_text, lines_json,
        elapsed_ms, invoked, device_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, fields.route, fields.path, fields.source, fields.method, fields.pathname, fields.params_json, fields.query_json, fields.status, fields.phase, fields.level, fields.message, fields.error_text, fields.lines_json, fields.elapsed_ms, fields.invoked, fields.device_id, fields.created_at);
  }

  /**
   * 按 id 倒序翻页（`before_id` 为 null 时取第一页）。`limit` 由调用方传「页大小 + 1」。
   * @param {string} route
   * @param {number | null} before_id
   * @param {number} limit
   * @returns {Record<string, unknown>[]}
   */
  async list_by_route(route, before_id, limit) {
    if (before_id === null) {
      return (await this.sql.exec("SELECT * FROM script_logs WHERE route = ? ORDER BY id DESC LIMIT ?", route, limit)).toArray();
    }
    return (await this.sql.exec(`SELECT * FROM script_logs WHERE route = ? AND id < ?
         ORDER BY id DESC LIMIT ?`, route, before_id, limit)).toArray();
  }

  /** 所有脚本的错误消息共用既有日志，按 id 倒序分页。 */
  async list_errors(before_id, limit) {
    return (await this.sql.exec(`SELECT logs.*, scripts.metadata_json AS script_metadata_json
       FROM script_logs AS logs LEFT JOIN scripts AS scripts ON scripts.route = logs.route
       WHERE logs.status = 'error' AND (? IS NULL OR logs.id < ?)
       ORDER BY logs.id DESC LIMIT ?`, before_id, before_id, limit)).toArray();
  }

  /** @param {string} route @returns {void} */
  async delete_for_route(route) {
    await this.sql.exec("DELETE FROM script_logs WHERE route = ?", route);
  }

  /** @param {number} read_id @returns {void} */
  async delete_errors_through(read_id) {
    await this.sql.exec("DELETE FROM script_logs WHERE status = 'error' AND id <= ?", read_id);
  }

  /** @param {number} cutoff @returns {void} */
  async delete_before(cutoff) {
    await this.sql.exec("DELETE FROM script_logs WHERE created_at < ?", cutoff);
  }
}
