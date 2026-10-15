// users / user_credentials / reader_email_verifications / reader_signup_ip_limits 的读写。
//
// 纯 SQL 层：只回原始行 / 数字 / 布尔 / void，不 import service、不造 Response。
// 邮箱归一与哈希由调用方在写前完成；列表的 LIKE 转义在这里做。

import { AccessTokenModel } from "../domain/access_token.js";

/**
 * 管理端用户列表的关键词过滤（`users.name` / `user_credentials.email`）。
 * @param {string} q 已 trim 截断的关键词
 * @returns {{ where: string, params: string[] }}
 */
function admin_filter(q) {
  if (q === "") return { where: "", params: [] };
  const pattern = "%" + q.replace(/[\\%_]/g, "\\$&") + "%";
  return {
    where: "WHERE (users.name LIKE ? OR user_credentials.email LIKE ? ESCAPE '\\')",
    params: [pattern, pattern],
  };
}

export class RepositoryUser {
  /** @param {{ sql: SqlStorage }} deps */
  constructor({ sql }) {
    this.sql = sql;
  }

  /** @param {string} user_id @returns {Record<string, unknown> | undefined} */
  find(user_id) {
    return this.sql
      .exec("SELECT * FROM users WHERE id = ? LIMIT 1", user_id)
      .toArray()[0];
  }

  /** @param {string} user_id @returns {boolean} */
  exists(user_id) {
    return this.sql
      .exec("SELECT id FROM users WHERE id = ? LIMIT 1", user_id)
      .toArray().length > 0;
  }

  /** @param {string} user_id @param {string} name @param {number} now @returns {void} */
  set_name(user_id, name, now) {
    this.sql.exec(
      "UPDATE users SET name = ?, updated_at = ? WHERE id = ?",
      name,
      now,
      user_id);
  }

  /** @param {string} user_id @returns {void} */
  delete(user_id) {
    this.sql.exec("DELETE FROM users WHERE id = ?", user_id);
  }

  /**
   * @param {{ id: string, name: string, created_at: number, updated_at: number }} fields
   * @returns {void}
   */
  insert(fields) {
    this.sql.exec(
      "INSERT INTO users (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)",
      fields.id,
      fields.name,
      fields.created_at,
      fields.updated_at);
  }

  /** @returns {number} 管理端用户总数（带关键词过滤）。 */
  count_admin(q) {
    const filter = admin_filter(q);
    return Number(
      this.sql
        .exec(
          `SELECT COUNT(DISTINCT users.id) AS count
           FROM users
           LEFT JOIN user_credentials ON user_credentials.user_id = users.id
           ${filter.where}`,
          ...filter.params)
        .toArray()[0]?.count ?? 0);
  }

  /**
   * 管理端用户列表（聚合 token 数 / 余额 / 最近使用）。
   * @param {string} q @param {number} limit @param {number} offset @param {number} now
   * @returns {Record<string, unknown>[]}
   */
  list_admin(q, limit, offset, now) {
    const filter = admin_filter(q);
    return this.sql
      .exec(
        `SELECT users.id, users.name, users.created_at, users.updated_at,
                user_credentials.email, user_credentials.email_verified_at,
                COUNT(access_tokens.id) AS token_count,
                SUM(CASE WHEN ${AccessTokenModel.active_sql("access_tokens.")}
                  THEN 1 ELSE 0 END) AS active_token_count,
                SUM(CASE WHEN ${AccessTokenModel.active_sql("access_tokens.")}
                  THEN access_tokens.credit_balance ELSE 0 END) AS credit_balance,
                SUM(CASE WHEN access_tokens.revoked_at IS NULL
                  THEN access_tokens.total_credits_used ELSE 0 END) AS total_credits_used,
                MAX(access_tokens.last_used_at) AS last_used_at
         FROM users
         LEFT JOIN user_credentials ON user_credentials.user_id = users.id
         LEFT JOIN access_tokens ON access_tokens.user_id = users.id
         ${filter.where}
         GROUP BY users.id
         ORDER BY users.created_at DESC
         LIMIT ? OFFSET ?`,
        now,
        now,
        ...filter.params,
        limit,
        offset)
      .toArray();
  }

  /** @param {string} user_id @returns {Record<string, unknown> | undefined} */
  find_credential(user_id) {
    return this.sql
      .exec(
        "SELECT email, password_hash, email_verified_at, created_at, updated_at FROM user_credentials WHERE user_id = ? LIMIT 1",
        user_id)
      .toArray()[0];
  }

  /** @param {string} user_id @returns {Record<string, unknown> | undefined} */
  find_credential_id(user_id) {
    return this.sql
      .exec("SELECT id FROM user_credentials WHERE user_id = ? LIMIT 1", user_id)
      .toArray()[0];
  }

  /** @param {string} user_id @returns {Record<string, unknown> | undefined} */
  find_credential_email(user_id) {
    return this.sql
      .exec("SELECT email FROM user_credentials WHERE user_id = ? LIMIT 1", user_id)
      .toArray()[0];
  }

  /** @param {string} user_id @returns {Record<string, unknown> | undefined} */
  find_credential_email_verified(user_id) {
    return this.sql
      .exec(
        "SELECT email, email_verified_at FROM user_credentials WHERE user_id = ? LIMIT 1",
        user_id)
      .toArray()[0];
  }

  /** @param {string} email @returns {Record<string, unknown> | undefined} */
  find_credential_by_email(email) {
    return this.sql
      .exec(
        "SELECT user_id, email_verified_at FROM user_credentials WHERE email = ? LIMIT 1",
        email)
      .toArray()[0];
  }

  /** @param {string} email @returns {boolean} */
  email_taken(email) {
    return this.sql
      .exec("SELECT id FROM user_credentials WHERE email = ? LIMIT 1", email)
      .toArray().length > 0;
  }

  /** @param {string} email @param {string} user_id @returns {boolean} */
  email_taken_by_other(email, user_id) {
    return this.sql
      .exec(
        "SELECT user_id FROM user_credentials WHERE email = ? AND user_id <> ? LIMIT 1",
        email,
        user_id)
      .toArray().length > 0;
  }

  /**
   * @param {{
   *   id: string, user_id: string, email: string, password_hash: string,
   *   password_salt: string, email_verified_at: number | null,
   *   created_at: number, updated_at: number,
   * }} fields
   * @returns {void}
   */
  insert_credential(fields) {
    this.sql.exec(
      `INSERT INTO user_credentials (
        id, user_id, email, password_hash, password_salt,
        email_verified_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      fields.id,
      fields.user_id,
      fields.email,
      fields.password_hash,
      fields.password_salt,
      fields.email_verified_at,
      fields.created_at,
      fields.updated_at);
  }

  /**
   * @param {string} user_id @param {string} email @param {number} email_verified_at @param {number} now
   * @returns {void}
   */
  set_credential_email(user_id, email, email_verified_at, now) {
    this.sql.exec(
      "UPDATE user_credentials SET email = ?, email_verified_at = ?, updated_at = ? WHERE user_id = ?",
      email,
      email_verified_at,
      now,
      user_id);
  }

  /** @param {string} user_id @param {number} now @returns {void} */
  mark_email_verified(user_id, now) {
    this.sql.exec(
      "UPDATE user_credentials SET email_verified_at = ?, updated_at = ? WHERE user_id = ?",
      now,
      now,
      user_id);
  }

  /** @param {string} user_id @returns {void} */
  delete_credential(user_id) {
    this.sql.exec("DELETE FROM user_credentials WHERE user_id = ?", user_id);
  }

  /** @param {string} user_id @param {string} password_hash @param {string} password_salt @param {number} now @returns {void} */
  set_password(user_id, password_hash, password_salt, now) {
    this.sql.exec(
      "UPDATE user_credentials SET password_hash = ?, password_salt = ?, updated_at = ? WHERE user_id = ?",
      password_hash,
      password_salt,
      now,
      user_id);
  }

  /** @param {string} user_id @returns {Record<string, unknown> | undefined} */
  find_verification(user_id) {
    return this.sql
      .exec(
        `SELECT code_hash, expires_at, attempts FROM reader_email_verifications
         WHERE user_id = ? LIMIT 1`,
        user_id)
      .toArray()[0];
  }

  /** @param {string} user_id @returns {Record<string, unknown> | undefined} */
  find_verification_sent_at(user_id) {
    return this.sql
      .exec(
        "SELECT sent_at FROM reader_email_verifications WHERE user_id = ? LIMIT 1",
        user_id)
      .toArray()[0];
  }

  /**
   * @param {string} user_id @param {string} code_hash @param {number} expires_at @param {number} sent_at
   * @returns {void}
   */
  upsert_verification(user_id, code_hash, expires_at, sent_at) {
    this.sql.exec(
      `INSERT INTO reader_email_verifications (user_id, code_hash, expires_at, attempts, sent_at)
       VALUES (?, ?, ?, 0, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         code_hash = excluded.code_hash,
         expires_at = excluded.expires_at,
         attempts = 0,
         sent_at = excluded.sent_at`,
      user_id,
      code_hash,
      expires_at,
      sent_at);
  }

  /** @param {string} user_id @returns {void} */
  bump_verification_attempts(user_id) {
    this.sql.exec(
      "UPDATE reader_email_verifications SET attempts = attempts + 1 WHERE user_id = ?",
      user_id);
  }

  /** @param {string} user_id @returns {void} */
  delete_verification(user_id) {
    this.sql.exec("DELETE FROM reader_email_verifications WHERE user_id = ?", user_id);
  }

  /** @param {string} ip_hash @returns {Record<string, unknown> | undefined} */
  signup_limit_find(ip_hash) {
    return this.sql
      .exec(
        "SELECT window_start, sends FROM reader_signup_ip_limits WHERE ip_hash = ? LIMIT 1",
        ip_hash)
      .toArray()[0];
  }

  /** @param {string} ip_hash @param {number} now @returns {void} */
  signup_limit_insert(ip_hash, now) {
    this.sql.exec(
      "INSERT INTO reader_signup_ip_limits (ip_hash, window_start, sends) VALUES (?, ?, 1)",
      ip_hash,
      now);
  }

  /** @param {string} ip_hash @param {number} now @returns {void} */
  signup_limit_reset(ip_hash, now) {
    this.sql.exec(
      "UPDATE reader_signup_ip_limits SET window_start = ?, sends = 1 WHERE ip_hash = ?",
      now,
      ip_hash);
  }

  /** @param {string} ip_hash @returns {void} */
  signup_limit_increment(ip_hash) {
    this.sql.exec(
      "UPDATE reader_signup_ip_limits SET sends = sends + 1 WHERE ip_hash = ?",
      ip_hash);
  }
}
