// 访问令牌（access_tokens 行）实体。
//
// 对外形状**只回掩码不回 token 本体**；`status` 是派生值而非存储列，
// `revoked` 优先于 `expired`（撤销是终态）。token 本体只在创建/轮换的响应里
// 由调用方单独拼上，不经过这个模型。
//
// 纯模块，可在 node --test 下直接覆盖。

import { MAX_ACCESS_TOKENS, MAX_ACCESS_TOKEN_LIFETIME_SECONDS } from "../lib/constants.js";

/** 令牌有效期下限（秒）。 */
const MIN_LIFETIME_SECONDS = 60;

/**
 * access_tokens 行实体。
 * @param {Record<string, unknown>} [row]
 */
export function AccessTokenModel(row) {
  const source = row ?? {};
  const state = Object.freeze({
    id: String(source.id ?? ""),
    name: String(source.name ?? ""),
    email: source.email ?? null,
    token_hint: String(source.token_hint ?? ""),
    revoked_at: source.revoked_at ?? null,
    expires_at: source.expires_at ?? null,
    created_at: Number(source.created_at ?? 0),
    last_used_at: source.last_used_at ?? null,
    credit_balance: Number(source.credit_balance ?? 0),
    total_credits_granted: Number(source.total_credits_granted ?? 0),
    total_credits_used: Number(source.total_credits_used ?? 0),
  });
  /**
   * @param {number} now
   * @returns {string}
   */
  const status_at = (now) => {
    if (state.revoked_at !== null) return "revoked";
    const expired = state.expires_at !== null && Number(state.expires_at) <= now;
    return expired ? "expired" : "active";
  };
  return Object.freeze({
    ...state,
    /** 给定时刻的状态：revoked → expired → active。 */
    status: (now = Date.now()) => status_at(now),
    /**
     * 是否未撤销且未过期——「能用来调用」的唯一判定。
     * @param {number} [now]
     * @returns {boolean}
     */
    is_active_at: (now = Date.now()) =>
      state.revoked_at === null && (state.expires_at === null || Number(state.expires_at) > now),
    toValue: (now = Date.now()) => ({
      id: state.id,
      name: state.name,
      email: state.email,
      token_hint: state.token_hint,
      status: status_at(now),
      expires_at: state.expires_at,
      created_at: state.created_at,
      last_used_at: state.last_used_at,
      credit_balance: state.credit_balance,
      total_credits_granted: state.total_credits_granted,
      total_credits_used: state.total_credits_used,
    }),
  });
}

AccessTokenModel.of = AccessTokenModel;
/** 活跃令牌数量上限。 */
AccessTokenModel.MAX_TOKENS = MAX_ACCESS_TOKENS;
/** 有效期下限（秒）。 */
AccessTokenModel.MIN_LIFETIME_SECONDS = MIN_LIFETIME_SECONDS;
/** 有效期上限（秒）。 */
AccessTokenModel.MAX_LIFETIME_SECONDS = MAX_ACCESS_TOKEN_LIFETIME_SECONDS;
/** 从 SQLite 行构造。 */
AccessTokenModel.fromRow = (row) => AccessTokenModel(row);
/**
 * 「未撤销且未过期」的 SQL 谓词片段（单个 `?` 绑定 now）。
 * 列名可加前缀（如 `access_tokens.`）以便用在 JOIN 的 CASE 里。
 * @param {string} [prefix]
 * @returns {string}
 */
AccessTokenModel.active_sql = (prefix = "") =>
  `${prefix}revoked_at IS NULL AND (${prefix}expires_at IS NULL OR ${prefix}expires_at > ?)`;
/**
 * 校验请求里的 `expires_in_seconds`（缺省即永不过期）。错误文案逐字不变。
 * @param {unknown} value
 * @returns {{ ok: true, expires_in_seconds: number | null }
 *   | { ok: false, error: { status: number, message: string } }}
 */
AccessTokenModel.validate_lifetime = (value) => {
  if (value === undefined || value === null) return { ok: true, expires_in_seconds: null };
  const seconds = Number(value);
  if (
    !Number.isInteger(seconds) ||
    seconds < MIN_LIFETIME_SECONDS ||
    seconds > MAX_ACCESS_TOKEN_LIFETIME_SECONDS
  ) {
    return { ok: false, error: { status: 400, message: "invalid expires_in_seconds" } };
  }
  return { ok: true, expires_in_seconds: seconds };
};
/**
 * 令牌哈希冲突的结果（`token_hash` 唯一）。
 * @returns {{ status: number, message: string }}
 */
AccessTokenModel.duplicate_reason = () => ({ status: 409, message: "access token already exists" });
