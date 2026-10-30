// devices / device_logs 两张表的读写：设备注册表与设备日志。
//
// 纯 SQL 层：只回原始行 / Set / 布尔，不 import domain、不造 Response。
// 字段归一（截断、枚举兜底、JSON 序列化）由调用方在写前完成。

export class RepositoryDevice {
  /** @param {{ sql: D1Store }} deps */
  constructor({
    sql
  }) {
    this.sql = sql;
  }

  /** @param {string} device_id @returns {DeviceRegistryRow | undefined} */
  async find(device_id) {
    return (await this.sql.exec("SELECT * FROM devices WHERE device_id = ? LIMIT 1", device_id)).toArray()[0];
  }

  /**
   * 只取 `disabled` 列：`accept_connection` 判断设备是否被管理员禁用。
   * @param {string} device_id
   * @returns {{ disabled: number } | undefined}
   */
  async find_disabled(device_id) {
    return (await this.sql.exec("SELECT disabled FROM devices WHERE device_id = ? LIMIT 1", device_id)).toArray()[0];
  }

  /** @param {string} device_id @returns {boolean} */
  async is_registered(device_id) {
    return (await this.sql.exec("SELECT 1 FROM devices WHERE device_id = ? LIMIT 1", device_id)).toArray().length > 0;
  }

  /** @returns {DeviceRegistryRow[]} */
  async list_registry() {
    return (await this.sql.exec(`SELECT device_id, connection_id, methods_json, device_name, device_os, connected_at,
                max_concurrency, last_seen_at, disconnected_at, status, disabled
         FROM devices ORDER BY device_id`)).toArray();
  }

  /**
   * 单台设备在飞的调用数（assigned + running）。走
   * `calls_device_load(assigned_device_id, status)` 索引点查——调度每次都要按设备取这个数，
   * 不能退化成全表 GROUP BY。
   * @param {string} device_id
   * @returns {number}
   */
  async count_active_for_device(device_id) {
    const row = (await this.sql.exec(`SELECT COUNT(*) AS active_count FROM calls
         WHERE assigned_device_id = ? AND status IN ('assigned', 'running')`, device_id)).toArray()[0];
    return row === undefined ? 0 : Number(row.active_count);
  }

  /** @returns {DeviceLoadRow[]} 每台设备在飞（assigned/running）的任务数。 */
  async list_load_counts() {
    return (await this.sql.exec(`SELECT assigned_device_id, COUNT(*) AS active_count FROM calls
         WHERE status IN ('assigned', 'running') AND assigned_device_id IS NOT NULL
         GROUP BY assigned_device_id`)).toArray();
  }

  /**
   * 设备（重）连：插入或就地更新注册行，状态置 online。
   * @param {{
   *   device_id: string, connection_id: string, methods_json: string,
   *   device_name: string, device_os: string, max_concurrency: number, connected_at: number,
   * }} fields
   * @returns {void}
   */
  async upsert_connection(fields) {
    await this.sql.exec(`INSERT INTO devices (
         device_id, connection_id, methods_json, connected_at,
         device_name, device_os, max_concurrency, last_seen_at, disconnected_at, status
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 'online')
       ON CONFLICT(device_id) DO UPDATE SET
         connection_id = excluded.connection_id,
         methods_json = excluded.methods_json,
         device_name = excluded.device_name,
         device_os = excluded.device_os,
         max_concurrency = excluded.max_concurrency,
         connected_at = excluded.connected_at,
         last_seen_at = excluded.last_seen_at,
         disconnected_at = NULL,
         status = 'online'`, fields.device_id, fields.connection_id, fields.methods_json, fields.connected_at, fields.device_name, fields.device_os, fields.max_concurrency, fields.last_seen_at);
  }

  /**
   * 心跳/活动：只更新匹配 connection_id 的那一行，状态回到 online。
   * @param {string} device_id @param {string} connection_id @param {number} now
   * @returns {void}
   */
  async set_seen(device_id, connection_id, now) {
    // 用数据库时间戳限流，DO 休眠或重启后仍不会重新按每条消息落库。
    await this.sql.exec(`UPDATE devices
       SET last_seen_at = ?, status = 'online', disconnected_at = NULL
       WHERE device_id = ? AND connection_id = ?
         AND (last_seen_at <= ? OR status <> 'online' OR disconnected_at IS NOT NULL)`, now, device_id, connection_id, now - 5 * 60 * 1000);
  }

  /**
   * 连接关闭/出错：状态置 offline。
   * @param {string} device_id @param {string} connection_id @param {number} now
   * @returns {void}
   */
  async set_offline(device_id, connection_id, now) {
    await this.sql.exec(`UPDATE devices
       SET status = 'offline', last_seen_at = ?, disconnected_at = ?
       WHERE device_id = ? AND connection_id = ?
         AND (status <> 'offline' OR disconnected_at IS NULL)`, now, now, device_id, connection_id);
  }

  /**
   * summary 里发现连接已不存在：只改状态与断开时间（不动 last_seen_at）。
   * @param {string} device_id @param {string} connection_id @param {number} now
   * @returns {void}
   */
  async set_stale_offline(device_id, connection_id, now) {
    await this.sql.exec(`UPDATE devices
       SET status = 'offline', disconnected_at = ?
       WHERE device_id = ? AND connection_id = ? AND status = 'online'`, now, device_id, connection_id);
  }

  /** @param {string} device_id @param {boolean} disabled @returns {void} */
  async set_disabled(device_id, disabled) {
    await this.sql.exec("UPDATE devices SET disabled = ? WHERE device_id = ?", disabled ? 1 : 0, device_id);
  }

  /** @param {string} device_id @returns {void} */
  async delete(device_id) {
    await this.sql.exec("DELETE FROM devices WHERE device_id = ?", device_id);
  }

  /**
   * @param {{
   *   device_id: string, connection_id: string | null, category: string, event_type: string,
   *   direction: string, level: string, task_id: string | null, method: string | null,
   *   message: string, metadata_json: string, created_at: number,
   * }} fields
   * @returns {void}
   */
  async insert_log(fields) {
    await this.sql.exec(`INSERT INTO device_logs (
        device_id, connection_id, category, event_type, direction, level,
        task_id, method, message, metadata_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, fields.device_id, fields.connection_id, fields.category, fields.event_type, fields.direction, fields.level, fields.task_id, fields.method, fields.message, fields.metadata_json, fields.created_at);
  }

  /**
   * 按 id 倒序翻页（category / before_id 可空）。`limit` 由调用方传「页大小 + 1」。
   * @param {string} device_id @param {string} category @param {number | null} before_id @param {number} limit
   * @returns {DeviceLogRow[]}
   */
  async list_logs(device_id, category, before_id, limit) {
    if (before_id !== null && category !== "") {
      return (await this.sql.exec(`SELECT * FROM device_logs
           WHERE device_id = ? AND category = ? AND id < ?
           ORDER BY id DESC LIMIT ?`, device_id, category, before_id, limit)).toArray();
    }
    if (before_id !== null) {
      return (await this.sql.exec(`SELECT * FROM device_logs WHERE device_id = ? AND id < ?
           ORDER BY id DESC LIMIT ?`, device_id, before_id, limit)).toArray();
    }
    if (category !== "") {
      return (await this.sql.exec(`SELECT * FROM device_logs WHERE device_id = ? AND category = ?
           ORDER BY id DESC LIMIT ?`, device_id, category, limit)).toArray();
    }
    return (await this.sql.exec(`SELECT * FROM device_logs WHERE device_id = ?
         ORDER BY id DESC LIMIT ?`, device_id, limit)).toArray();
  }

  /** @param {number} cutoff @returns {void} */
  async delete_logs_before(cutoff) {
    await this.sql.exec("DELETE FROM device_logs WHERE created_at < ?", cutoff);
  }

  /** @param {string} device_id @returns {void} */
  async delete_logs_for(device_id) {
    await this.sql.exec("DELETE FROM device_logs WHERE device_id = ?", device_id);
  }
}
