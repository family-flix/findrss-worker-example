// rss_route_cache 表（`RssRouteCache` 的 L2）的读写：按 key 取条目、upsert、过期/超量清理。
//
// JSON/XML 快照的存储封装与分块在这里处理；TTL 由注入时钟的 infra/rss_cache.js 判定。
//
// `read` / `write` / `delete_expired` / `count` / `delete_oldest` 这组方法名**就是**
// infra 侧约定的 store 接口，所以组合根（`server/durable_object.js`）可以把本对象直接
// 注入 `RssRouteCache`，不需要适配层。必须如此：layering 规则不许
// `infra/` import `repository/`（见 `test/layering.test.js` 的 `ALLOWED.infra`）。

const snapshot_prefix = "findrss-snapshot-v1:";
const chunk_marker = "findrss-snapshot-chunks-v1";
const chunk_size = 64 * 1024;

export class RepositoryRssRouteCache {
  /** @param {{ sql: SqlStorage, storage?: DurableObjectStorage }} deps */
  constructor({ sql, storage, retain_keys = () => new Set() }) {
    this.sql = sql;
    this.retain_keys = retain_keys;
    this.transaction = storage ? task => storage.transactionSync(task) : task => task();
  }

  /**
   * @param {string} key
   * @returns {{ output_json: string, invoked: number, expires_at: number } | null}
   */
  read(key) {
    const row = (
      this.sql
        .exec(
          "SELECT output_json, invoked, expires_at FROM rss_route_cache WHERE key = ?",
          key)
        .toArray()[0] ?? null
    );
    if (!row) return null;
    if (row.output_json === chunk_marker) {
      row.output_json = this.sql.exec("SELECT body FROM rss_route_cache_chunks WHERE key = ? ORDER BY chunk_index", key)
        .toArray().map(chunk => chunk.body).join("");
    }
    if (row.output_json.startsWith(snapshot_prefix)) {
      const snapshot = JSON.parse(row.output_json.slice(snapshot_prefix.length));
      row.output_json = snapshot.output;
      row.rendered = snapshot.rendered;
    }
    return row;
  }

  /**
   * 写入或覆盖。刻意**不动 `created_at`**：它是 L2 的淘汰序，重写不该把一条老条目
   * 变成最新（那会让热点条目永远不被淘汰、冷条目被反复挤出）。
   * @param {{
   *   key: string, output_json: string, invoked: number, expires_at: number, created_at: number,
   * }} entry
   * @returns {void}
   */
  write(entry) {
    const body = entry.rendered ? snapshot_prefix + JSON.stringify({ output: entry.output_json, rendered: entry.rendered }) : entry.output_json;
    const chunked = entry.rendered && body.length > chunk_size;
    this.transaction(() => {
      this.sql.exec("DELETE FROM rss_route_cache_chunks WHERE key = ?", entry.key);
      if (chunked) {
        for (let offset = 0, index = 0; offset < body.length; index++) {
          let end = Math.min(offset + chunk_size, body.length);
          // SQLite 按 UTF-8 保存，不能把一个 emoji 的代理对拆到两个参数里。
          const last = body.charCodeAt(end - 1);
          if (end < body.length && last >= 0xD800 && last <= 0xDBFF) end--;
          this.sql.exec("INSERT INTO rss_route_cache_chunks (key, chunk_index, body) VALUES (?, ?, ?)", entry.key, index, body.slice(offset, end));
          offset = end;
        }
      }
      this.sql.exec(
        `INSERT INTO rss_route_cache (key, output_json, invoked, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET
           output_json = excluded.output_json,
           invoked = excluded.invoked,
           expires_at = excluded.expires_at`,
        entry.key,
        chunked ? chunk_marker : body,
        entry.invoked,
        entry.expires_at,
        entry.created_at);
    });
  }

  /** @param {string} key @returns {void} */
  delete(key) {
    this.transaction(() => {
      this.sql.exec("DELETE FROM rss_route_cache_chunks WHERE key = ?", key);
      this.sql.exec("DELETE FROM rss_route_cache WHERE key = ?", key);
    });
  }

  /** @param {number} now @returns {void} */
  delete_expired(now) {
    // 定时私密源也保留上次快照；读取前仍由服务层校验订阅身份。
    const retained = [...this.retain_keys()];
    const exclusion = retained.length ? ` AND key NOT IN (${retained.map(() => "?").join(",")})` : "";
    this.sql.exec("DELETE FROM rss_route_cache WHERE expires_at <= ? AND key NOT LIKE 'public-snapshot:%'" + exclusion, now, ...retained);
    this.delete_orphan_chunks();
  }

  /** 脚本配置变更后的全清（`RssRouteCache.invalidate_all` 的 L2 侧）。 @returns {void} */
  clear() {
    this.transaction(() => {
      this.sql.exec("DELETE FROM rss_route_cache_chunks");
      this.sql.exec("DELETE FROM rss_route_cache");
      this.sql.exec("UPDATE rss_public_feeds SET attempted_at = 0");
    });
  }

  /** @returns {number} */
  count() {
    const row = this.sql.exec("SELECT COUNT(*) AS total FROM rss_route_cache").toArray()[0];
    return row === undefined ? 0 : Number(row.total);
  }

  /**
   * 只保留 `created_at` 最新的 `keep` 行（`keep <= 0` 时清空）。L2 的行数上限由
   * 调用方按内存里的 `max_entries` 传进来——L1 与 L2 用同一个上限，L1 被挤掉的条目
   * 才能在 L2 里多活一会儿（这正是加 L2 的意义）。
   * @param {number} keep
   * @returns {void}
   */
  delete_oldest(keep) {
    if (keep <= 0) {
      this.sql.exec("DELETE FROM rss_route_cache");
      this.delete_orphan_chunks();
      return;
    }
    this.sql.exec(
      `DELETE FROM rss_route_cache WHERE key IN (
         SELECT key FROM rss_route_cache ORDER BY created_at DESC LIMIT -1 OFFSET ?
       )`,
      keep);
    this.delete_orphan_chunks();
  }

  delete_orphan_chunks() {
    this.sql.exec("DELETE FROM rss_route_cache_chunks WHERE key NOT IN (SELECT key FROM rss_route_cache)");
  }

  register_public(key, pathname, query, self_url, max_entries) {
    this.sql.exec(`INSERT INTO rss_public_feeds (key, pathname, query_json, self_url)
      SELECT ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM rss_public_feeds) < ? ON CONFLICT(key) DO NOTHING`,
      key, pathname, JSON.stringify([...query]), self_url, max_entries);
    return this.sql.exec("SELECT key FROM rss_public_feeds WHERE key = ?", key).toArray().length > 0;
  }

  public_next_at(interval) {
    return this.sql.exec("SELECT MIN(attempted_at + ?) AS next_at FROM rss_public_feeds", interval).toArray()[0]?.next_at ?? null;
  }

  public_schedule() {
    return this.sql.exec("SELECT * FROM rss_public_feeds ORDER BY attempted_at, key").toArray();
  }

  public_due(before, limit) {
    return this.sql.exec("SELECT * FROM rss_public_feeds WHERE attempted_at <= ? ORDER BY attempted_at, key LIMIT ?", before, limit).toArray();
  }

  public_attempt(key, now) {
    this.sql.exec("UPDATE rss_public_feeds SET attempted_at = ? WHERE key = ?", now, key);
  }

  delete_public(key) {
    this.sql.exec("DELETE FROM rss_public_feeds WHERE key = ?", key);
    this.delete(key);
  }
}
