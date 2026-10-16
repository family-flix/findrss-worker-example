// 订阅源目录、头像和广场文章快照的读写。
//
// 纯 SQL 层：只回原始行 / 数字 / void，不 import service、不造 Response。
// 关键词用 LIKE 转义，标签用 JSON 精确匹配，全部查询值经参数绑定。

import { DISCOVERY_CATEGORY_TAGS, MAX_DISCOVERY_SOURCES } from "../lib/constants.js";
import { escape_like } from "./sql_like.js";

export class RepositoryDiscoverySource {
  /** @param {{ sql: SqlStorage }} deps */
  constructor({ sql }) {
    this.sql = sql;
  }

  query_conditions({ include_disabled, category = "", query = "", tags = [], source_type = "" }) {
    const conditions = [];
    const parameters = [];
    if (!include_disabled) {
      conditions.push("enabled = 1");
    }
    if (category !== "") {
      conditions.push("category = ?");
      parameters.push(category);
    }
    if (source_type !== "") {
      conditions.push("source_type = ?");
      parameters.push(source_type);
    }
    if (query !== "") {
      conditions.push(
        "(title LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\' OR website LIKE ? ESCAPE '\\' OR discovery_sources.feed_url LIKE ? ESCAPE '\\' OR tags_json LIKE ? ESCAPE '\\' OR category IN (SELECT value FROM json_each(?)))");
      const pattern = "%" + escape_like(query) + "%";
      parameters.push(pattern, pattern, pattern, pattern, pattern, JSON.stringify(
        Object.entries(DISCOVERY_CATEGORY_TAGS).filter(([, label]) => label.toLowerCase().includes(query.toLowerCase())).map(([key]) => key),
      ));
    }
    for (const selected_tag of tags) {
      const legacy_category = Object.keys(DISCOVERY_CATEGORY_TAGS).find((key) => DISCOVERY_CATEGORY_TAGS[key] === selected_tag);
      conditions.push("(EXISTS (SELECT 1 FROM json_each(CASE WHEN json_valid(tags_json) THEN CASE WHEN json_type(tags_json) = 'array' THEN tags_json ELSE '[]' END ELSE '[]' END) WHERE value = ?) OR category = ?)");
      parameters.push(selected_tag, legacy_category ?? "__no_category__");
    }
    const where = conditions.length === 0 ? "" : "WHERE " + conditions.join(" AND ");
    return { where, parameters };
  }

  /** 管理列表读取全部源；公开列表支持显式 limit/offset，无分页参数时兼容原有调用。 */
  list(filters) {
    const { include_disabled, limit, offset = 0 } = filters;
    const { where, parameters } = this.query_conditions(filters);
    const order = include_disabled ? "created_at DESC, id" : "sort_order ASC, title COLLATE NOCASE, discovery_sources.id";
    const pagination = limit === undefined ? "LIMIT " + (include_disabled ? MAX_DISCOVERY_SOURCES : 500) : "LIMIT ? OFFSET ?";
    if (limit !== undefined) parameters.push(limit, offset);
    return this.sql
      .exec(
        `SELECT discovery_sources.*, snapshots.articles_json, snapshots.saved_at AS snapshot_saved_at,
                snapshots.attempted_at AS snapshot_attempted_at, snapshots.error AS snapshot_error, snapshots.adaptive_interval
         FROM discovery_sources LEFT JOIN discovery_source_snapshots AS snapshots
         ON snapshots.source_id = discovery_sources.id AND snapshots.feed_url = discovery_sources.feed_url ${where}
         ORDER BY ${order} ${pagination}`,
        ...parameters)
      .toArray();
  }

  count_filtered(filters) {
    const { where, parameters } = this.query_conditions(filters);
    return Number(this.sql.exec(`SELECT COUNT(*) AS count FROM discovery_sources ${where}`, ...parameters).toArray()[0]?.count ?? 0);
  }

  list_tags() {
    return this.sql.exec("SELECT category, tags_json FROM discovery_sources WHERE enabled = 1").toArray();
  }

  list_types() {
    return this.sql.exec("SELECT DISTINCT source_type FROM discovery_sources ORDER BY source_type").toArray();
  }

  snapshot_next_at(interval) {
    return this.sql.exec(`SELECT MIN(COALESCE(s.attempted_at, 0) + ?) AS next_at
      FROM discovery_sources d LEFT JOIN discovery_source_snapshots s ON s.source_id = d.id AND s.feed_url = d.feed_url
      WHERE d.enabled = 1 AND d.require_token = 0`, interval).toArray()[0]?.next_at ?? null;
  }

  snapshot_schedule() {
    return this.sql.exec(`SELECT d.*, s.attempted_at AS snapshot_attempted_at, s.adaptive_interval
      FROM discovery_sources d LEFT JOIN discovery_source_snapshots s ON s.source_id = d.id AND s.feed_url = d.feed_url
      WHERE d.enabled = 1`).toArray();
  }

  snapshot_adaptive(id, interval) {
    this.sql.exec("UPDATE discovery_source_snapshots SET adaptive_interval = ? WHERE source_id = ?", interval, id);
  }

  snapshot_due(before, limit) {
    return this.sql.exec(`SELECT d.* FROM discovery_sources d LEFT JOIN discovery_source_snapshots s
      ON s.source_id = d.id AND s.feed_url = d.feed_url
      WHERE d.enabled = 1 AND d.require_token = 0 AND COALESCE(s.attempted_at, 0) <= ?
      ORDER BY COALESCE(s.attempted_at, 0), d.sort_order, d.id LIMIT ?`, before, limit).toArray();
  }

  snapshot_get(id) {
    return this.sql.exec("SELECT * FROM discovery_source_snapshots WHERE source_id = ?", id).toArray()[0];
  }

  snapshot_attempt(id, feed_url, now) {
    this.sql.exec(`INSERT INTO discovery_source_snapshots (source_id, feed_url, attempted_at) VALUES (?, ?, ?)
      ON CONFLICT(source_id) DO UPDATE SET attempted_at = excluded.attempted_at,
      articles_json = CASE WHEN feed_url = excluded.feed_url THEN articles_json ELSE '[]' END,
      saved_at = CASE WHEN feed_url = excluded.feed_url THEN saved_at ELSE 0 END, feed_url = excluded.feed_url`, id, feed_url, now);
  }

  snapshot_save(id, feed_url, articles, now, error = "", fingerprint = "") {
    if (error) this.sql.exec("UPDATE discovery_source_snapshots SET error = ? WHERE source_id = ? AND feed_url = ?", error, id, feed_url);
    else this.sql.exec("UPDATE discovery_source_snapshots SET articles_json = ?, saved_at = ?, error = '', poll_fingerprint = ? WHERE source_id = ? AND feed_url = ?",
      JSON.stringify(articles), now, fingerprint, id, feed_url);
  }

  snapshot_delete(id) {
    this.sql.exec("DELETE FROM discovery_source_snapshots WHERE source_id = ?", id);
  }

  /** @param {string} id @returns {Record<string, unknown> | undefined} */
  find(id) {
    return this.sql
      .exec("SELECT * FROM discovery_sources WHERE id = ? LIMIT 1", id)
      .toArray()[0];
  }

  /** @param {string} id @returns {Record<string, unknown> | undefined} 仅启用中的源。 */
  find_enabled(id) {
    return this.sql
      .exec("SELECT * FROM discovery_sources WHERE id = ? AND enabled = 1 LIMIT 1", id)
      .toArray()[0];
  }

  /** @param {string} id @returns {boolean} */
  exists(id) {
    return this.sql
      .exec("SELECT id FROM discovery_sources WHERE id = ? LIMIT 1", id)
      .toArray().length > 0;
  }

  /**
   * 同平台的其它启用源（只回 id/title，用于详情页内部链接网）。
   * @param {string} id @param {string} source_type @param {number} limit
   * @returns {Array<{ id: string, title: string }>}
   */
  list_related(id, source_type, limit) {
    return this.sql
      .exec(
        `SELECT id, title FROM discovery_sources
         WHERE enabled = 1 AND id != ? AND source_type = ?
         ORDER BY sort_order ASC, title COLLATE NOCASE LIMIT ?`,
        id,
        source_type,
        limit)
      .toArray()
      .map((item) => ({ id: String(item.id), title: String(item.title) }));
  }

  /** @returns {number} */
  count() {
    return Number(
      this.sql.exec("SELECT COUNT(*) AS count FROM discovery_sources").toArray()[0]?.count ?? 0);
  }

  /** @param {string} feed_url @returns {boolean} */
  feed_url_taken(feed_url) {
    return this.sql
      .exec("SELECT id FROM discovery_sources WHERE feed_url = ? LIMIT 1", feed_url)
      .toArray().length > 0;
  }

  /** @param {string} feed_url @param {string} id @returns {boolean} */
  feed_url_taken_by_other(feed_url, id) {
    return this.sql
      .exec(
        "SELECT id FROM discovery_sources WHERE feed_url = ? AND id != ? LIMIT 1",
        feed_url,
        id)
      .toArray().length > 0;
  }

  /** @returns {Record<string, unknown>[]} 启用且免 token 的源（公开性判定用）。 */
  list_public_routes() {
    return this.sql
      .exec(
        `SELECT feed_url, enabled, require_token FROM discovery_sources
         WHERE enabled = 1 AND require_token = 0 LIMIT 500`)
      .toArray();
  }

  list_private_routes() {
    return this.sql.exec("SELECT id, title, feed_url, credit_cost FROM discovery_sources WHERE enabled = 1 AND require_token = 1 ORDER BY id LIMIT ?", MAX_DISCOVERY_SOURCES).toArray();
  }

  /**
   * @param {{
   *   id: string, title: string, description: string, website: string, feed_url: string,
   *   category: string, tags_json: string, enabled: number, require_token: number, credit_cost: number,
   *   sort_order: number, source_type: string, created_at: number, updated_at: number,
   * }} fields
   * @returns {void}
   */
  insert(fields) {
    this.sql.exec(
      `INSERT INTO discovery_sources (
        id, title, description, website, feed_url, category, tags_json,
        enabled, require_token, credit_cost, sort_order, source_type, created_at, updated_at, poll_policy_json, poll_updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      fields.id,
      fields.title,
      fields.description,
      fields.website,
      fields.feed_url,
      fields.category,
      fields.tags_json,
      fields.enabled,
      fields.require_token,
      fields.credit_cost ?? 1,
      fields.sort_order,
      fields.source_type,
      fields.created_at,
      fields.updated_at,
      fields.poll_policy_json || '{"mode":"inherit"}',
      fields.poll_updated_at || 0);
  }

  /**
   * @param {{
   *   id: string, title: string, description: string, website: string, feed_url: string,
   *   category: string, tags_json: string, enabled: number, require_token: number, credit_cost: number,
   *   sort_order: number, source_type: string, updated_at: number,
   * }} fields
   * @returns {void}
   */
  update(fields) {
    this.sql.exec(
      `UPDATE discovery_sources
       SET title = ?, description = ?, website = ?, feed_url = ?, category = ?,
           tags_json = ?, enabled = ?, require_token = ?, credit_cost = ?, sort_order = ?, source_type = ?,
           updated_at = ?, poll_policy_json = ?, poll_updated_at = ?
       WHERE id = ?`,
      fields.title,
      fields.description,
      fields.website,
      fields.feed_url,
      fields.category,
      fields.tags_json,
      fields.enabled,
      fields.require_token,
      fields.credit_cost ?? 1,
      fields.sort_order,
      fields.source_type,
      fields.updated_at,
      fields.poll_policy_json || '{"mode":"inherit"}',
      fields.poll_updated_at || 0,
      fields.id);
  }

  /** @param {string} id @returns {void} 连同头像一起删。 */
  delete(id) {
    this.snapshot_delete(id);
    this.sql.exec("DELETE FROM discovery_source_calls WHERE source_id = ?", id);
    this.sql.exec("DELETE FROM discovery_sources WHERE id = ?", id);
    this.sql.exec("DELETE FROM discovery_source_avatars WHERE source_id = ?", id);
  }

  /** @param {string} source_id @returns {Record<string, unknown> | undefined} */
  avatar_get(source_id) {
    return this.sql
      .exec(
        "SELECT content_type, bytes, object_key FROM discovery_source_avatars WHERE source_id = ? LIMIT 1",
        source_id)
      .toArray()[0];
  }

  /**
   * @param {string} source_id @param {string} content_type @param {Uint8Array} bytes @param {number} now
   * @param {string} [object_key] R2 对象 key；旧 SQLite 头像为空。
   * @returns {void}
   */
  avatar_put(source_id, content_type, bytes, now, object_key = "") {
    this.sql.exec(
      `INSERT OR REPLACE INTO discovery_source_avatars (source_id, content_type, bytes, updated_at, object_key)
       VALUES (?, ?, ?, ?, ?)`,
      source_id,
      content_type,
      bytes,
      now,
      object_key);
  }

  /** @param {string} source_id @returns {void} */
  avatar_delete(source_id) {
    this.sql.exec("DELETE FROM discovery_source_avatars WHERE source_id = ?", source_id);
  }

  /** @param {string} source_id @param {number} ts @returns {void} */
  set_avatar_ts(source_id, ts) {
    this.sql.exec(
      "UPDATE discovery_sources SET avatar_updated_at = ? WHERE id = ?",
      ts,
      source_id);
  }
}
