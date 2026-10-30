// 订阅源目录、头像和广场文章快照的读写。
//
// 纯 SQL 层：只回原始行 / 数字 / void，不 import service、不造 Response。
// 关键词用 LIKE 转义，标签用 JSON 精确匹配，全部查询值经参数绑定。

import { DISCOVERY_CATEGORY_TAGS, MAX_DISCOVERY_SOURCES } from "../lib/constants.js";
import { SourceAddressModel } from "../domain/source_address.js";
import { escape_like } from "./sql_like.js";
const snapshot_schedule_states = new WeakMap();
export class RepositoryDiscoverySource {
  /** @param {{ sql: D1Store }} deps */
  constructor({
    sql
  }) {
    this.sql = sql;
    if (!snapshot_schedule_states.has(sql)) snapshot_schedule_states.set(sql, {
      rows: null,
      loaded_at: 0
    });
    this.snapshot_schedule_state = snapshot_schedule_states.get(sql);
  }
  list_metadata() {
    const now = Date.now();
    const state = this.snapshot_schedule_state;
    if (!state.metadata || now - state.metadata.loaded_at >= 300000 || now < state.metadata.loaded_at) {
      state.metadata = {
        loaded_at: now,
        counts: new Map(),
        types: null
      };
    }
    return state.metadata;
  }
  query_conditions({
    include_disabled,
    category = "",
    query = "",
    tags = [],
    source_type = "",
    status = "all",
    visibility = "all"
  }) {
    const conditions = [];
    const parameters = [];
    if (!include_disabled) {
      // 公开目录只展示启用中的公开源；非公开源（require_token）不出现在广场页面。
      conditions.push("enabled = 1", "require_token = 0");
    }
    if (include_disabled && status !== "all") {
      conditions.push("enabled = ?");
      parameters.push(status === "enabled" ? 1 : 0);
    }
    if (include_disabled && visibility !== "all") {
      conditions.push("require_token = ?");
      parameters.push(visibility === "private" ? 1 : 0);
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
      conditions.push("(title LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\' OR website LIKE ? ESCAPE '\\' OR (social_url || social_urls_json) LIKE ? ESCAPE '\\' OR discovery_sources.feed_url LIKE ? ESCAPE '\\' OR tags_json LIKE ? ESCAPE '\\' OR category IN (SELECT value FROM json_each(?)))");
      const pattern = "%" + escape_like(query) + "%";
      parameters.push(pattern, pattern, pattern, pattern, pattern, pattern, JSON.stringify(Object.entries(DISCOVERY_CATEGORY_TAGS).filter(([, label]) => label.toLowerCase().includes(query.toLowerCase())).map(([key]) => key)));
    }
    for (const selected_tag of tags) {
      const legacy_category = Object.keys(DISCOVERY_CATEGORY_TAGS).find(key => DISCOVERY_CATEGORY_TAGS[key] === selected_tag);
      conditions.push("(EXISTS (SELECT 1 FROM json_each(CASE WHEN json_valid(tags_json) THEN CASE WHEN json_type(tags_json) = 'array' THEN tags_json ELSE '[]' END ELSE '[]' END) WHERE value = ?) OR category = ?)");
      parameters.push(selected_tag, legacy_category ?? "__no_category__");
    }
    const where = conditions.length === 0 ? "" : "WHERE " + conditions.join(" AND ");
    return {
      where,
      parameters
    };
  }

  /** 管理及公开列表支持 limit/offset，无分页参数时供内部调用及全量导出使用。 */
  async list(filters) {
    const {
      include_disabled,
      limit,
      offset = 0
    } = filters;
    const {
      where,
      parameters
    } = this.query_conditions(filters);
    const order = include_disabled ? "created_at DESC, id" : "sort_order ASC, title COLLATE NOCASE, discovery_sources.id";
    const pagination = limit === undefined ? "LIMIT " + (include_disabled ? MAX_DISCOVERY_SOURCES : 500) : "LIMIT ? OFFSET ?";
    if (limit !== undefined) parameters.push(limit, offset);
    return (await this.sql.exec(`SELECT discovery_sources.*, (SELECT object_key FROM discovery_source_avatars WHERE source_id = discovery_sources.id) AS avatar_object_key,
                snapshots.articles_json, snapshots.saved_at AS snapshot_saved_at,
                snapshots.attempted_at AS snapshot_attempted_at, snapshots.error AS snapshot_error, snapshots.adaptive_interval
         FROM (SELECT * FROM discovery_sources ${where} ORDER BY ${order} ${pagination}) AS discovery_sources
         LEFT JOIN discovery_source_snapshots AS snapshots
         ON snapshots.source_id = discovery_sources.id AND snapshots.feed_url = discovery_sources.feed_url
         ORDER BY ${order}`, ...parameters)).toArray();
  }
  async count_filtered(filters) {
    const {
      where,
      parameters
    } = this.query_conditions(filters);
    const counts = this.list_metadata().counts;
    const key = JSON.stringify([where, parameters]);
    if (!counts.has(key)) {
      if (counts.size >= 64) counts.clear();
      counts.set(key, Number((await this.sql.exec(`SELECT COUNT(*) AS count FROM discovery_sources ${where}`, ...parameters)).toArray()[0]?.count ?? 0));
    }
    return counts.get(key);
  }
  async list_tags() {
    return (await this.sql.exec("SELECT category, tags_json FROM discovery_sources WHERE enabled = 1")).toArray();
  }
  async list_types() {
    const metadata = this.list_metadata();
    metadata.types ??= (await this.sql.exec("SELECT DISTINCT source_type FROM discovery_sources ORDER BY source_type")).toArray();
    return metadata.types.map(row => ({
      ...row
    }));
  }
  async snapshot_next_at(interval) {
    return (await this.sql.exec(`SELECT MIN(COALESCE(s.attempted_at, 0) + ?) AS next_at
      FROM discovery_sources d LEFT JOIN discovery_source_snapshots s ON s.source_id = d.id AND s.feed_url = d.feed_url
      WHERE d.enabled = 1 AND d.require_token = 0`, interval)).toArray()[0]?.next_at ?? null;
  }
  async snapshot_schedule() {
    const now = Date.now();
    // 调度会在设备响应、抓取完成和 alarm 中反复调用，避免每次扫描全部源。
    // 写入时同步更新 / 失效；定期重读也能接收数据库外部维护的变更。
    const state = this.snapshot_schedule_state;
    if (!state.rows || now - state.loaded_at >= 300000 || now < state.loaded_at) {
      const rows = (await this.sql.exec(`SELECT d.*, s.attempted_at AS snapshot_attempted_at, s.adaptive_interval
        FROM discovery_sources d LEFT JOIN discovery_source_snapshots s ON s.source_id = d.id AND s.feed_url = d.feed_url
        WHERE d.enabled = 1`)).toArray();
      state.rows = new Map(rows.map(row => [row.id, row]));
      state.loaded_at = now;
    }
    return [...state.rows.values()].map(row => ({
      ...row
    }));
  }
  async snapshot_adaptive(id, interval) {
    await this.sql.exec("UPDATE discovery_source_snapshots SET adaptive_interval = ? WHERE source_id = ? AND adaptive_interval != ?", interval, id, interval);
    const row = this.snapshot_schedule_state.rows?.get(id);
    if (row?.snapshot_attempted_at != null) row.adaptive_interval = interval;
  }
  async snapshot_due(before, limit) {
    return (await this.sql.exec(`SELECT d.* FROM discovery_sources d LEFT JOIN discovery_source_snapshots s
      ON s.source_id = d.id AND s.feed_url = d.feed_url
      WHERE d.enabled = 1 AND d.require_token = 0 AND COALESCE(s.attempted_at, 0) <= ?
      ORDER BY COALESCE(s.attempted_at, 0), d.sort_order, d.id LIMIT ?`, before, limit)).toArray();
  }
  async snapshot_get(id) {
    return (await this.sql.exec("SELECT * FROM discovery_source_snapshots WHERE source_id = ?", id)).toArray()[0];
  }
  async snapshot_attempt(id, feed_url, now) {
    await this.sql.exec(`INSERT INTO discovery_source_snapshots (source_id, feed_url, attempted_at) VALUES (?, ?, ?)
      ON CONFLICT(source_id) DO UPDATE SET attempted_at = excluded.attempted_at,
      articles_json = CASE WHEN feed_url = excluded.feed_url THEN articles_json ELSE '[]' END,
      saved_at = CASE WHEN feed_url = excluded.feed_url THEN saved_at ELSE 0 END, feed_url = excluded.feed_url`, id, feed_url, now);
    const row = this.snapshot_schedule_state.rows?.get(id);
    if (row) {
      if (row.feed_url !== feed_url) this.snapshot_schedule_state.rows = null;else {
        row.snapshot_attempted_at = now;
        // 地址曾不匹配时 JOIN 没带出旧行的学习间隔，upsert 却会保留它。
        row.adaptive_interval ??= (await this.sql.exec("SELECT adaptive_interval FROM discovery_source_snapshots WHERE source_id = ?", id)).toArray()[0]?.adaptive_interval ?? 0;
      }
    }
  }
  async snapshot_save(id, feed_url, articles, now, error = "", fingerprint = "") {
    if (error) await this.sql.exec("UPDATE discovery_source_snapshots SET error = ? WHERE source_id = ? AND feed_url = ? AND error != ?", error, id, feed_url, error);else await this.sql.exec("UPDATE discovery_source_snapshots SET articles_json = ?, saved_at = ?, error = '', poll_fingerprint = ? WHERE source_id = ? AND feed_url = ?", JSON.stringify(articles), now, fingerprint, id, feed_url);
  }
  async snapshot_delete(id) {
    this.snapshot_schedule_state.rows = null;
    await this.sql.exec("DELETE FROM discovery_source_snapshots WHERE source_id = ?", id);
  }
  async snapshot_save_articles(id, articles) {
    await this.sql.exec("UPDATE discovery_source_snapshots SET articles_json = ? WHERE source_id = ?", JSON.stringify(articles), id);
  }

  /** @param {string} id @returns {Record<string, unknown> | undefined} */
  async find(id) {
    return (await this.sql.exec(`SELECT discovery_sources.*, (SELECT object_key FROM discovery_source_avatars WHERE source_id = discovery_sources.id) AS avatar_object_key
        FROM discovery_sources WHERE id = ? LIMIT 1`, id)).toArray()[0];
  }

  /** @param {string} id @returns {Record<string, unknown> | undefined} 仅启用中的公开源。 */
  async find_enabled(id) {
    return (await this.sql.exec(`SELECT discovery_sources.*, (SELECT object_key FROM discovery_source_avatars WHERE source_id = discovery_sources.id) AS avatar_object_key
        FROM discovery_sources WHERE id = ? AND enabled = 1 AND require_token = 0 LIMIT 1`, id)).toArray()[0];
  }

  /** @param {string} id @returns {boolean} */
  async exists(id) {
    return (await this.sql.exec("SELECT id FROM discovery_sources WHERE id = ? LIMIT 1", id)).toArray().length > 0;
  }

  /**
   * 同来源的其它启用公开源（只回 id/title，用于详情页内部链接网）。
   * @param {string} id @param {string} source_type @param {number} limit
   * @returns {Array<{ id: string, title: string }>}
   */
  async list_related(id, source_type, limit) {
    return (await this.sql.exec(`SELECT id, title FROM discovery_sources
         WHERE enabled = 1 AND require_token = 0 AND id != ? AND source_type = ?
         ORDER BY sort_order ASC, title COLLATE NOCASE LIMIT ?`, id, source_type, limit)).toArray().map(item => ({
      id: String(item.id),
      title: String(item.title)
    }));
  }

  /** @returns {number} */
  async count() {
    return Number((await this.sql.exec("SELECT COUNT(*) AS count FROM discovery_sources")).toArray()[0]?.count ?? 0);
  }

  /** @param {string} feed_url @returns {boolean} */
  async feed_url_taken(feed_url) {
    return (await this.sql.exec("SELECT id FROM discovery_sources WHERE feed_url = ? LIMIT 1", feed_url)).toArray().length > 0;
  }

  /** @param {string} feed_url @param {string} id @returns {boolean} */
  async feed_url_taken_by_other(feed_url, id) {
    return (await this.sql.exec("SELECT id FROM discovery_sources WHERE feed_url = ? AND id != ? LIMIT 1", feed_url, id)).toArray().length > 0;
  }

  /** @returns {Record<string, unknown>[]} 启用且免 token 的源（公开性判定用）。 */
  async list_public_routes(pathname) {
    let decoded;
    try {
      decoded = pathname === undefined ? undefined : decodeURIComponent(pathname);
    } catch {
      return [];
    }
    return (await this.sql.exec("SELECT id,feed_url,enabled,require_token FROM discovery_sources WHERE enabled=1 AND require_token=0" + (decoded === undefined ? "" : " AND route_pathname=?") + " LIMIT 500", ...(decoded === undefined ? [] : [decoded]))).toArray();
  }
  async list_private_routes(pathname) {
    let decoded;
    try {
      decoded = pathname === undefined ? undefined : decodeURIComponent(pathname);
    } catch {
      return [];
    }
    return (await this.sql.exec("SELECT * FROM discovery_sources WHERE enabled=1 AND require_token=1" + (decoded === undefined ? "" : " AND route_pathname=?") + " ORDER BY id", ...(decoded === undefined ? [] : [decoded]))).toArray();
  }

  /** XML 构建时按完整路由地址匹配社媒主页，公开与私密源共用。 */
  async list_social_routes() {
    return (await this.snapshot_schedule()).filter(row => row.social_url !== "").sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0).slice(0, MAX_DISCOVERY_SOURCES).map(({
      feed_url,
      social_url
    }) => ({
      feed_url,
      social_url
    }));
  }

  /**
   * @param {{
   *   id: string, title: string, description: string, website: string, social_url?: string, social_urls_json?: string, feed_url: string,
   *   category: string, tags_json: string, enabled: number, require_token: number, credit_cost: number,
   *   sort_order: number, source_type: string, created_at: number, updated_at: number,
   * }} fields
   * @returns {void}
   */
  async insert(fields) {
    this.snapshot_schedule_state.metadata = null;
    this.snapshot_schedule_state.rows = null;
    await this.sql.exec(`INSERT INTO discovery_sources (
        id, title, description, website, social_url, social_urls_json, feed_url, route_pathname, category, tags_json,
        enabled, require_token, credit_cost, sort_order, source_type, created_at, updated_at, poll_policy_json, poll_updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, fields.id, fields.title, fields.description, fields.website, fields.social_url ?? "", fields.social_urls_json ?? JSON.stringify(fields.social_url ? [fields.social_url] : []), fields.feed_url, SourceAddressModel(fields.feed_url).route_pathname, fields.category, fields.tags_json, fields.enabled, fields.require_token, fields.credit_cost ?? 1, fields.sort_order, fields.source_type, fields.created_at, fields.updated_at, fields.poll_policy_json || '{"mode":"inherit"}', fields.poll_updated_at || 0);
  }

  /**
   * @param {{
   *   id: string, title: string, description: string, website: string, social_url?: string, social_urls_json?: string, feed_url: string,
   *   category: string, tags_json: string, enabled: number, require_token: number, credit_cost: number,
   *   sort_order: number, source_type: string, updated_at: number,
   * }} fields
   * @returns {void}
   */
  async update(fields) {
    this.snapshot_schedule_state.metadata = null;
    this.snapshot_schedule_state.rows = null;
    await this.sql.exec(`UPDATE discovery_sources
       SET title = ?, description = ?, website = ?, social_url = ?, social_urls_json = ?, feed_url = ?, route_pathname = ?, category = ?,
           tags_json = ?, enabled = ?, require_token = ?, credit_cost = ?, sort_order = ?, source_type = ?,
           updated_at = ?, poll_policy_json = ?, poll_updated_at = ?
       WHERE id = ?`, fields.title, fields.description, fields.website, fields.social_url ?? "", fields.social_urls_json ?? JSON.stringify(fields.social_url ? [fields.social_url] : []), fields.feed_url, SourceAddressModel(fields.feed_url).route_pathname, fields.category, fields.tags_json, fields.enabled, fields.require_token, fields.credit_cost ?? 1, fields.sort_order, fields.source_type, fields.updated_at, fields.poll_policy_json || '{"mode":"inherit"}', fields.poll_updated_at || 0, fields.id);
  }

  /** @param {string} id @returns {void} 连同头像一起删。 */
  async delete(id) {
    this.snapshot_schedule_state.metadata = null;
    await this.snapshot_delete(id);
    await this.sql.exec("DELETE FROM discovery_source_calls WHERE source_id = ?", id);
    await this.sql.exec("DELETE FROM discovery_sources WHERE id = ?", id);
    await this.sql.exec("DELETE FROM discovery_source_avatars WHERE source_id = ?", id);
  }

  /** @param {string} source_id @returns {Record<string, unknown> | undefined} */
  async avatar_get(source_id) {
    return (await this.sql.exec("SELECT content_type, bytes, object_key FROM discovery_source_avatars WHERE source_id = ? LIMIT 1", source_id)).toArray()[0];
  }

  /**
   * @param {string} source_id @param {string} content_type @param {Uint8Array} bytes @param {number} now
   * @param {string} [object_key] R2 对象 key；旧 SQLite 头像为空。
   * @returns {void}
   */
  async avatar_put(source_id, content_type, bytes, now, object_key = "") {
    await this.sql.exec(`INSERT OR REPLACE INTO discovery_source_avatars (source_id, content_type, bytes, updated_at, object_key)
       VALUES (?, ?, ?, ?, ?)`, source_id, content_type, bytes, now, object_key);
  }

  /** @param {string} source_id @returns {void} */
  async avatar_delete(source_id) {
    await this.sql.exec("DELETE FROM discovery_source_avatars WHERE source_id = ?", source_id);
  }

  /** @param {string} source_id @param {number} ts @returns {void} */
  async set_avatar_ts(source_id, ts) {
    await this.sql.exec("UPDATE discovery_sources SET avatar_updated_at = ? WHERE id = ?", ts, source_id);
  }
}
