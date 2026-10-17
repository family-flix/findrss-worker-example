// access_tokens 表的读写：令牌本体、余额/累计列，以及跨 user_credentials/users 的取数。
//
// 纯 SQL 层：只回原始行 / 数字 / 布尔 / void，不 import service、不造 Response。
// 「未撤销且未过期」的谓词只在这里拼（走 `AccessTokenModel.active_sql`），
// 调用方拿到的永远是原始行，`is_active_at` 的判定留给上层。

import { AccessTokenModel } from "../domain/access_token.js";

export class RepositoryAccessToken {
  /** @param {{ sql: SqlStorage }} deps */
  constructor({ sql }) {
    this.sql = sql;
  }

  /** @param {string} id @returns {Record<string, unknown> | undefined} */
  find(id) {
    return this.sql
      .exec("SELECT * FROM access_tokens WHERE id = ? LIMIT 1", id)
      .toArray()[0];
  }

  /**
   * 「未撤销且未过期」的令牌行。
   * @param {string} id @param {number} now
   * @returns {Record<string, unknown> | undefined}
   */
  find_active(id, now) {
    return this.sql
      .exec(
        `SELECT * FROM access_tokens WHERE id = ? AND ${AccessTokenModel.active_sql()} LIMIT 1`,
        id,
        now)
      .toArray()[0];
  }

  /**
   * 指定用户名下的「未撤销且未过期」令牌行。
   * @param {string} id @param {string} user_id @param {number} now
   * @returns {Record<string, unknown> | undefined}
   */
  find_active_for_user(id, user_id, now) {
    return this.sql
      .exec(
        `SELECT * FROM access_tokens
         WHERE id = ? AND user_id = ? AND ${AccessTokenModel.active_sql()} LIMIT 1`,
        id,
        user_id,
        now)
      .toArray()[0];
  }

  /** @param {string} id @param {string} user_id @param {number} now @returns {boolean} */
  is_active_for_user(id, user_id, now) {
    return this.sql
      .exec(
        `SELECT id FROM access_tokens
         WHERE id = ? AND user_id = ? AND ${AccessTokenModel.active_sql()} LIMIT 1`,
        id,
        user_id,
        now)
      .toArray().length > 0;
  }

  /**
   * 只取余额三列（读者积分总览）。
   * @param {string} id @param {string} user_id @param {number} now
   * @returns {{ credit_balance: number, total_credits_granted: number, total_credits_used: number } | undefined}
   */
  find_balance_for_user(id, user_id, now) {
    return this.sql
      .exec(
        `SELECT credit_balance, total_credits_granted, total_credits_used
         FROM access_tokens
         WHERE id = ? AND user_id = ? AND ${AccessTokenModel.active_sql()} LIMIT 1`,
        id,
        user_id,
        now)
      .toArray()[0];
  }

  /** @param {string} id @returns {Record<string, unknown> | undefined} 未撤销（不计过期）。 */
  find_not_revoked(id) {
    return this.sql
      .exec(
        "SELECT * FROM access_tokens WHERE id = ? AND revoked_at IS NULL LIMIT 1",
        id)
      .toArray()[0];
  }

  /** @param {string} id @returns {boolean} 未撤销（不计过期）。 */
  exists_not_revoked(id) {
    return this.sql
      .exec(
        "SELECT id FROM access_tokens WHERE id = ? AND revoked_at IS NULL LIMIT 1",
        id)
      .toArray().length > 0;
  }

  /** @param {string} token_hash @returns {Record<string, unknown> | undefined} */
  find_by_hash(token_hash) {
    return this.sql
      .exec("SELECT * FROM access_tokens WHERE token_hash = ? LIMIT 1", token_hash)
      .toArray()[0];
  }

  /** @param {string} token_hash @returns {boolean} 哈希是否已存在。 */
  exists_by_hash(token_hash) {
    return this.sql
      .exec("SELECT id FROM access_tokens WHERE token_hash = ? LIMIT 1", token_hash)
      .toArray().length > 0;
  }

  /**
   * 令牌 + 凭据邮箱（用于 `verify_access_token`）。
   * @param {string} token_hash
   * @returns {Record<string, unknown> | undefined}
   */
  find_with_credential_by_hash(token_hash) {
    return this.sql
      .exec(
        `SELECT access_tokens.*, user_credentials.email,
                user_credentials.email_verified_at
         FROM access_tokens
         LEFT JOIN user_credentials ON user_credentials.user_id = access_tokens.user_id
         WHERE access_tokens.token_hash = ? LIMIT 1`,
        token_hash)
      .toArray()[0];
  }

  /**
   * 令牌 + 凭据邮箱（用于新建后回读）。
   * @param {string} id
   * @returns {Record<string, unknown> | undefined}
   */
  find_with_credential_by_id(id) {
    return this.sql
      .exec(
        `SELECT access_tokens.*, user_credentials.email
         FROM access_tokens
         LEFT JOIN user_credentials ON user_credentials.user_id = access_tokens.user_id
         WHERE access_tokens.id = ? LIMIT 1`,
        id)
      .toArray()[0];
  }

  /**
   * 令牌 + 用户名 + 凭据（用于 token 方式登录）。
   * @param {string} token_hash
   * @returns {Record<string, unknown> | undefined}
   */
  find_login_by_token_hash(token_hash) {
    return this.sql
      .exec(
        `SELECT access_tokens.*, users.name AS user_name, user_credentials.email,
                user_credentials.email_verified_at
         FROM access_tokens
         JOIN users ON users.id = access_tokens.user_id
         LEFT JOIN user_credentials ON user_credentials.user_id = users.id
         WHERE access_tokens.token_hash = ? LIMIT 1`,
        token_hash)
      .toArray()[0];
  }

  /**
   * 按邮箱取最新一个未撤销令牌（用于密码方式登录，含 password_hash/salt）。
   * @param {string} email
   * @returns {Record<string, unknown> | undefined}
   */
  find_login_by_email(email) {
    return this.sql
      .exec(
        `SELECT access_tokens.*, users.name AS user_name, user_credentials.email,
                user_credentials.email_verified_at,
                user_credentials.password_hash, user_credentials.password_salt
         FROM user_credentials
         JOIN users ON users.id = user_credentials.user_id
         JOIN access_tokens ON access_tokens.user_id = users.id
         WHERE user_credentials.email = ? AND access_tokens.revoked_at IS NULL
         ORDER BY access_tokens.created_at DESC LIMIT 1`,
        email)
      .toArray()[0];
  }

  /**
   * 令牌 + 用户名 + 凭据（用于 `verify_reader_identity`）。
   * @param {string} id @param {string} user_id
   * @returns {Record<string, unknown> | undefined}
   */
  find_with_user(id, user_id) {
    return this.sql
      .exec(
        `SELECT access_tokens.*, users.name AS user_name, user_credentials.email,
                user_credentials.email_verified_at
         FROM access_tokens
         JOIN users ON users.id = access_tokens.user_id
         LEFT JOIN user_credentials ON user_credentials.user_id = users.id
         WHERE access_tokens.id = ? AND access_tokens.user_id = ? LIMIT 1`,
        id,
        user_id)
      .toArray()[0];
  }

  /** @returns {Record<string, unknown>[]} 未撤销令牌 + 邮箱，创建时间倒序。 */
  list({ limit, offset = 0 } = {}) {
    return this.sql
      .exec(
        `SELECT access_tokens.*, user_credentials.email
         FROM access_tokens
         LEFT JOIN user_credentials ON user_credentials.user_id = access_tokens.user_id
         WHERE access_tokens.revoked_at IS NULL
         ORDER BY access_tokens.created_at DESC, access_tokens.id ${limit === undefined ? "" : "LIMIT ? OFFSET ?"}`,
        ...(limit === undefined ? [] : [limit, offset]))
      .toArray();
  }

  count_listed() {
    return Number(this.sql.exec("SELECT COUNT(*) AS count FROM access_tokens WHERE revoked_at IS NULL").toArray()[0]?.count ?? 0);
  }

  /** @param {string} user_id @returns {Record<string, unknown>[]} 含已撤销，倒序。 */
  list_for_user(user_id) {
    return this.sql
      .exec(
        `SELECT access_tokens.*, user_credentials.email
         FROM access_tokens
         LEFT JOIN user_credentials ON user_credentials.user_id = access_tokens.user_id
         WHERE access_tokens.user_id = ?
         ORDER BY access_tokens.created_at DESC`,
        user_id)
      .toArray();
  }

  /** @returns {number} */
  count_active() {
    return Number(
      this.sql
        .exec("SELECT COUNT(*) AS count FROM access_tokens WHERE revoked_at IS NULL")
        .toArray()[0]?.count ?? 0);
  }

  /**
   * @param {{
   *   id: string, user_id: string, name: string, token_hash: string, token_hint: string,
   *   expires_at: number | null, created_at: number,
   *   credit_balance: number, total_credits_granted: number,
   * }} fields
   * @returns {void}
   */
  insert(fields) {
    this.sql.exec(
      `INSERT INTO access_tokens (
        id, user_id, name, token_hash, token_hint, expires_at, created_at, last_used_at,
        revoked_at, credit_balance, total_credits_granted, total_credits_used
      ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, 0)`,
      fields.id,
      fields.user_id,
      fields.name,
      fields.token_hash,
      fields.token_hint,
      fields.expires_at,
      fields.created_at,
      fields.credit_balance,
      fields.total_credits_granted);
  }

  /** @param {string} id @param {number} balance @param {number} granted_delta @returns {void} */
  set_balance_granted(id, balance, granted_delta) {
    this.sql.exec(
      `UPDATE access_tokens
       SET credit_balance = ?,
           total_credits_granted = total_credits_granted + ?
       WHERE id = ?`,
      balance,
      granted_delta,
      id);
  }

  /** @param {string} id @param {number} balance @param {number} used_delta @returns {void} */
  set_balance_used(id, balance, used_delta) {
    this.sql.exec(
      `UPDATE access_tokens
       SET credit_balance = ?, total_credits_used = total_credits_used + ?
       WHERE id = ?`,
      balance,
      used_delta,
      id);
  }

  /** @param {string} id @param {number} now @returns {void} */
  set_last_used(id, now) {
    this.sql.exec("UPDATE access_tokens SET last_used_at = ? WHERE id = ?", now, id);
  }

  /** @param {string} id @param {number} expires_at @returns {void} */
  set_expiry(id, expires_at) {
    this.sql.exec("UPDATE access_tokens SET expires_at = ? WHERE id = ?", expires_at, id);
  }

  /** @param {string} id @param {number} now @returns {void} */
  revoke(id, now) {
    this.sql.exec("UPDATE access_tokens SET revoked_at = ? WHERE id = ?", now, id);
  }

  /** @param {string} user_id @param {number} now @returns {void} */
  revoke_for_user(user_id, now) {
    this.sql.exec(
      "UPDATE access_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL",
      now,
      user_id);
  }
}
