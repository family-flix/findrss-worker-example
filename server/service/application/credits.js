// 积分总览、订阅访问扣费、管理端账本查询与「我的用量」。
//
// 只回数据或抛 DurableObjectError，绝不造 Response。
import { AccessTokenModel } from "../../domain/access_token.js";
import { ActivityCursorModel, ActivityEventModel, ActivityPageModel } from "../../domain/activity_log.js";
import { CreditModel, CreditTransactionModel } from "../../domain/credits.js";
import { valid_identifier } from "../../lib/identifiers.js";
import { do_error } from "./error.js";
export class ServiceCredit {
  /**
   * @param {{ repo: Record<string, any>, storage?: D1Store }} deps
   */
  constructor({
    repo,
    storage
  }) {
    this.repo = repo;
    this.storage = storage;
  }
  async charge_feed_access(access_token_id, source) {
    return await this.storage.transaction(async () => {
      const now = Date.now();
      const token = await this.repo.access_tokens.find(access_token_id);
      if (!token || !AccessTokenModel.fromRow(token).is_active_at(now)) throw do_error("unauthorized", 401);
      const balance = Number(token.credit_balance);
      const cost = source.credit_cost;
      if (!CreditModel.can_spend(balance, cost)) {
        throw do_error("insufficient credits", 402, {
          required: cost,
          balance
        }, CreditModel.headers(balance));
      }
      const balance_after = balance - cost;
      if (cost > 0) {
        await this.repo.access_tokens.set_balance_used(access_token_id, balance_after, cost);
        await this.repo.credit.insert({
          id: crypto.randomUUID(),
          access_token_id,
          task_id: null,
          type: "charge",
          amount: -cost,
          balance_after,
          method: "get_feed",
          subject: ActivityEventModel.subject(source.title),
          note: "Feed access",
          created_at: now
        });
      }
      return CreditModel.headers(balance_after);
    });
  }

  /** @param {Request} request @returns {Record<string, unknown>} */
  async reader_credit_overview(request) {
    const user_id = (request.headers.get("X-Api-User-ID") ?? "").trim();
    const access_token_id = (request.headers.get("X-Api-Access-Token-ID") ?? "").trim();
    if (!valid_identifier(user_id) || !valid_identifier(access_token_id)) {
      throw do_error("authentication required", 401);
    }
    const now = Date.now();
    const token = await this.repo.access_tokens.find_balance_for_user(access_token_id, user_id, now);
    if (token === undefined) throw do_error("authentication required", 401);
    const redeemed_campaigns = (await this.repo.redemption.list_redeemed_campaigns(user_id)).map(row => ({
      id: String(row.id),
      name: String(row.name),
      redeemed_at: Number(row.redeemed_at)
    }));
    return {
      credit_balance: Number(token.credit_balance),
      total_credits_granted: Number(token.total_credits_granted),
      total_credits_used: Number(token.total_credits_used),
      redeemed_campaigns
    };
  }

  /**
   * 账本查询（管理端）。保留既有 `access_token_id`/`limit` 语义，
   * 新增 `user_id` 过滤与 keyset 游标（多取一条判有无下一页）。
   * @param {URL} url
   * @returns {Record<string, unknown>}
   */
  async list_credit_transactions(url) {
    const access_token_id = (url.searchParams.get("access_token_id") ?? "").trim();
    if (access_token_id !== "" && !valid_identifier(access_token_id)) {
      throw do_error("invalid access_token_id", 400);
    }
    const user_id = (url.searchParams.get("user_id") ?? "").trim();
    if (user_id !== "" && !valid_identifier(user_id)) {
      throw do_error("invalid user_id", 400);
    }
    const page_cursor = ActivityCursorModel.fromQuery(url);
    if (page_cursor === false) throw do_error("invalid cursor", 400);
    const limit_value = Number(url.searchParams.get("limit") ?? "100");
    const limit = Number.isFinite(limit_value) ? Math.max(1, Math.min(500, Math.floor(limit_value))) : 100;
    const where = ActivityCursorModel.where(page_cursor.cursor);
    const rows = await this.repo.credit.list(access_token_id, user_id, where.clause, where.params, limit + 1);
    const page = ActivityPageModel(rows, limit, row => CreditTransactionModel.fromRow(row).toValue()).toValue();
    return {
      credit_transactions: page.values,
      next_cursor: page.next_cursor
    };
  }

  /**
   * @param {Request} request
   * @returns {Record<string, unknown>}
   */
  async credit_usage(request) {
    const access_token_id = (request.headers.get("X-Api-Access-Token-ID") ?? "").trim();
    if (!valid_identifier(access_token_id)) {
      throw do_error("credit usage is only available to access tokens", 403);
    }
    const row = await this.repo.access_tokens.find(access_token_id);
    const now = Date.now();
    if (row === undefined || !AccessTokenModel.fromRow(row).is_active_at(now)) {
      throw do_error("unauthorized", 401);
    }
    return {
      credits: {
        balance: Number(row.credit_balance),
        total_granted: Number(row.total_credits_granted),
        total_used: Number(row.total_credits_used),
        default_call_cost: CreditModel.DEFAULT_COST
      }
    };
  }
}
