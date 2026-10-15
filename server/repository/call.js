// calls 表的读写：设备调用的排队、租约、完成/失败与清理。
//
// 纯 SQL 层：只回原始行 / 数字 / void，不 import service、不造 Response。
// 租约时长（lease_deadline）与是否重试（is_retryable）的判定由调用方用 domain 助手在写前算好。

export class RepositoryCall {
  /** @param {{ sql: SqlStorage }} deps */
  constructor({ sql }) {
    this.sql = sql;
  }

  /** @param {string} id @returns {Record<string, unknown> | undefined} */
  find(id) {
    return this.sql
      .exec("SELECT * FROM calls WHERE id = ? LIMIT 1", id)
      .toArray()[0];
  }

  /**
   * 幂等键命中（同一发布设备 + 同一 key）。
   * @param {string} publisher_device_id @param {string} idempotency_key
   * @returns {Record<string, unknown> | undefined}
   */
  find_by_idempotency(publisher_device_id, idempotency_key) {
    return this.sql
      .exec(
        "SELECT * FROM calls WHERE publisher_device_id = ? AND idempotency_key = ? LIMIT 1",
        publisher_device_id,
        idempotency_key)
      .toArray()[0];
  }

  /**
   * 合并键命中：同一调用方的**在飞**（排队/已派发/执行中）同参调用。
   *
   * 刻意**不含 completed/failed**：合并的语义是「这次调用已经有人在下发了，别再来一次」，
   * 而不是「复用历史结果」。后者会把一条比 TTL 更旧的产出重新塞回缓存，等于悄悄延长
   * 数据寿命——历史结果该由调用方的缓存负责，不该由队列负责。
   *
   * `publisher_device_id` 必须进条件：否则 B 可以带着与 A 相同的合并键搭 A 的付费调用，
   * 变成绕过计费。同键跨调用方不合并。
   * @param {string} coalesce_key @param {string} publisher_device_id
   * @param {string} method @param {string} args_json
   * @returns {Record<string, unknown> | undefined}
   */
  find_inflight_by_coalesce(coalesce_key, publisher_device_id, method, args_json) {
    return this.sql
      .exec(
        `SELECT * FROM calls
         WHERE coalesce_key = ? AND publisher_device_id = ? AND method = ? AND args_json = ?
           AND status IN ('queued', 'assigned', 'running')
         ORDER BY created_at LIMIT 1`,
        coalesce_key,
        publisher_device_id,
        method,
        args_json)
      .toArray()[0];
  }

  /** @returns {number} 排队中的调用数（背压判定）。 */
  count_queued() {
    return Number(
      this.sql.exec("SELECT COUNT(*) AS count FROM calls WHERE status = 'queued'")
        .toArray()[0]?.count ?? 0);
  }

  /** @returns {Array<{ status: string, count: number }>} 按状态分组计数。 */
  count_by_status() {
    return this.sql
      .exec("SELECT status, COUNT(*) AS count FROM calls GROUP BY status ORDER BY status")
      .toArray();
  }

  /**
   * 列表查询：发布设备与状态各自可空。
   * @param {string} publisher_device_id @param {string} status @param {number} limit
   * @returns {Record<string, unknown>[]}
   */
  list(publisher_device_id, status, limit) {
    if (publisher_device_id !== "" && status !== "") {
      return this.sql
        .exec(
          "SELECT * FROM calls WHERE publisher_device_id = ? AND status = ? ORDER BY created_at DESC LIMIT ?",
          publisher_device_id,
          status,
          limit)
        .toArray();
    }
    if (publisher_device_id !== "") {
      return this.sql
        .exec(
          "SELECT * FROM calls WHERE publisher_device_id = ? ORDER BY created_at DESC LIMIT ?",
          publisher_device_id,
          limit)
        .toArray();
    }
    if (status !== "") {
      return this.sql
        .exec(
          "SELECT * FROM calls WHERE status = ? ORDER BY created_at DESC LIMIT ?",
          status,
          limit)
        .toArray();
    }
    return this.sql
      .exec("SELECT * FROM calls ORDER BY created_at DESC LIMIT ?", limit)
      .toArray();
  }

  /**
   * 可下发的排队调用：只回**当前有在线设备能接**的行，`limit` 传空闲槽位数。
   *
   * 为什么在 SQL 里过滤而不是取一批回 JS 里 `continue` 掉：`limit` 是「空闲槽位数」
   * （单设备并发 1 时就是 1），队首一条接不了的调用（目标设备离线 / 无人提供该方法）
   * 会一直占着这个窗口，把后面所有能跑的调用饿死。代价是这一句可能扫过一批接不了的行
   * 才凑够 `limit` 条——纯读，且最多物化 `limit` 条，比原来恒定物化 1000 条便宜得多。
   * @param {string[]} device_ids 在线设备 ID
   * @param {string[]} methods 在线设备提供的方法并集
   * @param {number} limit
   * @returns {Record<string, unknown>[]}
   */
  list_dispatchable(device_ids, methods, limit) {
    if (device_ids.length === 0 || methods.length === 0 || limit <= 0) return [];
    const device_slots = device_ids.map(() => "?").join(", ");
    const method_slots = methods.map(() => "?").join(", ");
    return this.sql
      .exec(
        `SELECT * FROM calls
         WHERE status = 'queued'
           AND (
             (target_device_id IS NOT NULL AND target_device_id IN (${device_slots}))
             OR (target_device_id IS NULL AND method IN (${method_slots}))
           )
         ORDER BY created_at LIMIT ?`,
        ...device_ids,
        ...methods,
        limit)
      .toArray();
  }

  /**
   * 租约已过期且仍在飞（assigned/running）的调用。
   * @param {number} now
   * @returns {Record<string, unknown>[]}
   */
  list_expired_leases(now) {
    return this.sql
      .exec(
        `SELECT * FROM calls
         WHERE status IN ('assigned', 'running')
           AND lease_expires_at <= ?`,
        now)
      .toArray();
  }

  /** @param {string} device_id @returns {Record<string, unknown>[]} */
  list_active_for_device(device_id) {
    return this.sql
      .exec(
        `SELECT * FROM calls
         WHERE assigned_device_id = ? AND status IN ('assigned', 'running')
         ORDER BY created_at`,
        device_id)
      .toArray();
  }

  /** @returns {number | null | undefined} 最近一个到期的租约时刻。 */
  min_lease_expires_at() {
    return this.sql
      .exec(
        `SELECT MIN(lease_expires_at) AS lease_expires_at FROM calls
         WHERE status IN ('assigned', 'running') AND lease_expires_at IS NOT NULL`)
      .toArray()[0]?.lease_expires_at;
  }

  /**
   * @param {{
   *   id: string, method: string, publisher_device_id: string, access_token_id: string | null,
   *   credit_cost: number, target_device_id: string | null, idempotency_key: string | null,
   *   coalesce_key: string | null,
   *   args_json: string, created_at: number, updated_at: number,
   * }} fields
   * @returns {void}
   */
  insert(fields) {
    this.sql.exec(
      `INSERT INTO calls (
        id, method, publisher_device_id, access_token_id, credit_cost, target_device_id,
        idempotency_key, coalesce_key, args_json, status, attempt_count, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', 0, ?, ?)`,
      fields.id,
      fields.method,
      fields.publisher_device_id,
      fields.access_token_id,
      fields.credit_cost,
      fields.target_device_id,
      fields.idempotency_key,
      fields.coalesce_key,
      fields.args_json,
      fields.created_at,
      fields.updated_at);
  }

  /** @param {string} id @param {number} lease_expires_at @param {number} now @returns {void} */
  set_running(id, lease_expires_at, now) {
    this.sql.exec(
      "UPDATE calls SET status = 'running', lease_expires_at = ?, updated_at = ? WHERE id = ?",
      lease_expires_at,
      now,
      id);
  }

  /** @param {string} id @param {number} lease_expires_at @param {number} now @returns {void} */
  set_heartbeat(id, lease_expires_at, now) {
    this.sql.exec(
      "UPDATE calls SET lease_expires_at = ?, updated_at = ? WHERE id = ?",
      lease_expires_at,
      now,
      id);
  }

  /** @param {string} id @param {string} result_json @param {number} now @returns {void} */
  set_completed(id, result_json, now) {
    this.sql.exec(
      `UPDATE calls SET status = 'completed', result_json = ?, error_message = NULL,
       lease_expires_at = NULL, updated_at = ?, completed_at = ? WHERE id = ?`,
      result_json,
      now,
      now,
      id);
  }

  /** @param {string} id @param {string} error_message @param {number} now @returns {void} */
  set_failed(id, error_message, now) {
    this.sql.exec(
      `UPDATE calls SET status = 'failed', error_message = ?, lease_expires_at = NULL,
       updated_at = ?, completed_at = ? WHERE id = ?`,
      error_message,
      now,
      now,
      id);
  }

  /**
   * 可重试失败：清掉租约回到排队。
   * @param {string} id @param {string} error_message @param {number} now @returns {void}
   */
  set_requeued(id, error_message, now) {
    this.sql.exec(
      `UPDATE calls SET status = 'queued', assigned_device_id = NULL, lease_token = NULL,
       lease_expires_at = NULL, error_message = ?, updated_at = ? WHERE id = ?`,
      error_message,
      now,
      id);
  }

  /**
   * 派发：只从 queued 抢单（并发下不重复指派）。
   * @param {string} id @param {string} device_id @param {string} lease_token
   * @param {number} lease_expires_at @param {number} now
   * @returns {void}
   */
  assign(id, device_id, lease_token, lease_expires_at, now) {
    this.sql.exec(
      `UPDATE calls SET status = 'assigned', assigned_device_id = ?, lease_token = ?,
       lease_expires_at = ?, attempt_count = attempt_count + 1, updated_at = ?
       WHERE id = ? AND status = 'queued'`,
      device_id,
      lease_token,
      lease_expires_at,
      now,
      id);
  }

  /**
   * 下发失败：把已指派的调用退回排队。
   * @param {string} id @param {number} now @returns {void}
   */
  release(id, now) {
    this.sql.exec(
      `UPDATE calls SET status = 'queued', assigned_device_id = NULL, lease_token = NULL,
       lease_expires_at = NULL, updated_at = ? WHERE id = ?`,
      now,
      id);
  }

  /**
   * 设备下线：把它身上所有在飞调用标记失败。
   * @param {string} device_id @param {string} error_message @param {number} now
   * @returns {void}
   */
  fail_for_device(device_id, error_message, now) {
    this.sql.exec(
      `UPDATE calls
       SET status = 'failed', assigned_device_id = NULL, lease_token = NULL,
           lease_expires_at = NULL, error_message = ?, updated_at = ?, completed_at = ?
       WHERE assigned_device_id = ? AND status IN ('assigned', 'running')`,
      error_message,
      now,
      now,
      device_id);
  }

  /**
   * 租约清理：耗尽的标 failed，未耗尽的退回 queued。
   * @param {number} now @param {number} max_attempts
   * @returns {void}
   */
  sweep_expired(now, max_attempts) {
    this.sql.exec(
      `UPDATE calls
       SET status = 'failed', error_message = 'task lease expired too many times',
           updated_at = ?, completed_at = ?
       WHERE status IN ('assigned', 'running')
         AND lease_expires_at <= ? AND attempt_count >= ?`,
      now,
      now,
      now,
      max_attempts);
    this.sql.exec(
      `UPDATE calls
       SET status = 'queued', assigned_device_id = NULL, lease_token = NULL,
           lease_expires_at = NULL, updated_at = ?
       WHERE status IN ('assigned', 'running')
         AND lease_expires_at <= ? AND attempt_count < ?`,
      now,
      now,
      max_attempts);
  }

  /** @param {number} cutoff @returns {void} */
  delete_completed_before(cutoff) {
    this.sql.exec(
      `DELETE FROM calls
       WHERE status IN ('completed', 'failed') AND completed_at < ?`,
      cutoff);
  }
}
