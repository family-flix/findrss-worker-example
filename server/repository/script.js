// scripts 表的读写：脚本路由的列清单、按 path 的唯一性检查与启停。
//
// 纯 SQL 层：只回原始行 / 数字 / void，不 import service、不造 Response。
// 字段归一（截断、JSON 序列化、enabled 取值）由调用方在写前完成。

export class RepositoryScript {
  /** @param {{ sql: D1Store }} deps */
  constructor({
    sql
  }) {
    this.sql = sql;
  }

  /** @returns {Record<string, unknown>[]} 创建时间倒序、最多 500 条。 */
  async list() {
    return (await this.sql.exec("SELECT * FROM scripts ORDER BY created_at DESC, route LIMIT 500")).toArray();
  }

  /** @returns {number} */
  async count() {
    return Number((await this.sql.exec("SELECT COUNT(*) AS count FROM scripts")).toArray()[0]?.count ?? 0);
  }

  /** @param {string} route @returns {Record<string, unknown> | undefined} */
  async find(route) {
    return (await this.sql.exec("SELECT * FROM scripts WHERE route = ? LIMIT 1", route)).toArray()[0];
  }

  /** @param {string} route @returns {boolean} */
  async exists(route) {
    return (await this.sql.exec("SELECT route FROM scripts WHERE route = ? LIMIT 1", route)).toArray().length > 0;
  }

  /**
   * 取脚本的校验列（不含脚本本体）。
   * @param {string} route
   * @returns {Record<string, unknown> | undefined}
   */
  async find_config(route) {
    return (await this.sql.exec("SELECT route, script, path, metadata_json, enabled FROM scripts WHERE route = ? LIMIT 1", route)).toArray()[0];
  }

  /** @param {string} path @returns {Record<string, unknown> | undefined} 占用该 path 的行（只取 route）。 */
  async find_path_owner(path) {
    return (await this.sql.exec("SELECT route FROM scripts WHERE path = ? LIMIT 1", path)).toArray()[0];
  }

  /**
   * 除指定 route 外，占用该 path 的行。
   * @param {string} path @param {string} route
   * @returns {Record<string, unknown> | undefined}
   */
  async find_path_owner_excluding(path, route) {
    return (await this.sql.exec("SELECT route FROM scripts WHERE path = ? AND route <> ? LIMIT 1", path, route)).toArray()[0];
  }

  /** @returns {Record<string, unknown>[]} 启用且 path 非空，updated_at 倒序、最多 500 条。 */
  async list_enabled() {
    return (await this.sql.exec(`SELECT route, script, path, metadata_json, enabled, updated_at
         FROM scripts WHERE enabled = 1 AND path <> ''
         ORDER BY updated_at DESC LIMIT 500`)).toArray();
  }

  /**
   * @param {{
   *   route: string, title: string, path: string, metadata_json: string,
   *   script: string, enabled: number, created_at: number, updated_at: number,
   * }} fields
   * @returns {void}
   */
  async insert(fields) {
    await this.sql.exec(`INSERT INTO scripts (
         route, title, path, metadata_json, script, enabled, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, fields.route, fields.title, fields.path, fields.metadata_json, fields.script, fields.enabled, fields.created_at, fields.updated_at);
  }

  /**
   * @param {{
   *   route: string, title: string, path: string, metadata_json: string,
   *   script: string, enabled: number, updated_at: number,
   * }} fields
   * @returns {void}
   */
  async update(fields) {
    await this.sql.exec(`UPDATE scripts
       SET title = ?, path = ?, metadata_json = ?, script = ?, enabled = ?, updated_at = ?
       WHERE route = ?`, fields.title, fields.path, fields.metadata_json, fields.script, fields.enabled, fields.updated_at, fields.route);
  }

  /** @param {string} route @returns {void} */
  async delete(route) {
    await this.sql.exec("DELETE FROM scripts WHERE route = ?", route);
  }
}
