// credit_transactions 表的读写：账本落库与 keyset 翻页。
//
// 纯 SQL 层：只回原始行 / void，不 import service、不造 Response。
// 过滤片段（keyset where / 归属子查询）由调用方（domain 的 ActivityCursorModel）拼好后传入。

export class RepositoryCredit {
  /** @param {{ sql: SqlStorage }} deps */
  constructor({ sql }) {
    this.sql = sql;
  }

  /**
   * @param {{
   *   id: string, access_token_id: string, task_id: string | null, type: string,
   *   amount: number, balance_after: number, method: string | null,
   *   subject?: string, note: string | null, created_at: number,
   * }} fields
   * @returns {void}
   */
  insert(fields) {
    this.sql.exec(
      `INSERT INTO credit_transactions (
        id, access_token_id, task_id, type, amount, balance_after, method, subject, note, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      fields.id,
      fields.access_token_id,
      fields.task_id,
      fields.type,
      fields.amount,
      fields.balance_after,
      fields.method,
      fields.subject ?? "",
      fields.note,
      fields.created_at);
  }

  /**
   * 某用户名下（按 token 反查，**不过滤 revoked_at**）的一页流水，多取一条判有无下一页。
   * @param {string} user_id
   * @param {string} clause_suffix 已带前导 " AND " 的片段，可为空串
   * @param {unknown[]} params
   * @param {number} limit 调用方传「页大小 + 1」
   * @returns {Record<string, unknown>[]}
   */
  rows_for_user(user_id, clause_suffix, params, limit) {
    return this.sql
      .exec(
        `SELECT * FROM credit_transactions
         WHERE access_token_id IN (SELECT id FROM access_tokens WHERE user_id = ?)${clause_suffix}
         ORDER BY created_at DESC, id DESC LIMIT ?`,
        user_id,
        ...params,
        limit)
      .toArray();
  }

  /**
   * 管理端账本一页：按 token 或用户名下过滤，再叠加 keyset 游标。
   * 两者都空即全量；`user_id` 分支按 token 反查且**不过滤 revoked_at**（轮换 token 不能把历史抹掉）。
   * @param {string} access_token_id @param {string} user_id
   * @param {string} cursor_clause 已带前导 " AND " 的片段，可为空串
   * @param {unknown[]} cursor_params
   * @param {number} limit 调用方传「页大小 + 1」
   * @returns {Record<string, unknown>[]}
   */
  list(access_token_id, user_id, cursor_clause, cursor_params, limit) {
    const clauses = [];
    const params = [];
    if (access_token_id !== "") {
      clauses.push("access_token_id = ?");
      params.push(access_token_id);
    } else if (user_id !== "") {
      clauses.push("access_token_id IN (SELECT id FROM access_tokens WHERE user_id = ?)");
      params.push(user_id);
    }
    if (cursor_clause !== "") {
      clauses.push(cursor_clause.replace(/^ AND /, ""));
      params.push(...cursor_params);
    }
    const filter = clauses.length === 0 ? "" : ` WHERE ${clauses.join(" AND ")}`;
    return this.sql
      .exec(
        `SELECT * FROM credit_transactions${filter} ORDER BY created_at DESC, id DESC LIMIT ?`,
        ...params,
        limit)
      .toArray();
  }
}
