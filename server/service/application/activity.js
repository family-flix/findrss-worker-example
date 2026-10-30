// 用户操作事件与积分流水的读取，以及事件落库。
//
// 只回数据或抛 DurableObjectError，绝不造 Response（router 是唯一翻译点）。
import { ActivityCursorModel, ActivityEventModel, ActivityPageModel } from "../../domain/activity_log.js";
import { CreditTransactionModel } from "../../domain/credits.js";
import { READER_SYNC_MAX_BODY } from "../../lib/constants.js";
import { valid_identifier } from "../../lib/identifiers.js";
import { do_error } from "./error.js";
export class ServiceActivity {
  /**
   * @param {{ repo: Record<string, any>, app: Record<string, any> }} deps
   */
  constructor({
    repo,
    app
  }) {
    this.repo = repo;
    /** 兄弟服务注册表（reader_auth 在 ServiceAuth 上）。 */
    this.app = app;
  }

  /**
   * 记一条用户主动操作事件。未知类型直接跳过。
   * 刻意整体 try/catch 只 warn：register/verify_email/redeem 都在 D1 原子提交
   * 里调用它，日志写失败绝不能回滚真实业务。
   * @param {{ user_id?: unknown, access_token_id?: unknown, type?: unknown, subject?: unknown, metadata?: unknown }} event
   * @returns {void}
   */
  async record_user_event(event) {
    try {
      const user_id = String(event?.user_id ?? "").trim();
      if (!valid_identifier(user_id)) return;
      const type = ActivityEventModel.normalize_type(event?.type);
      if (type === "") return;
      const access_token_id = String(event?.access_token_id ?? "").trim();
      await this.repo.activity.insert({
        id: crypto.randomUUID(),
        user_id,
        access_token_id: valid_identifier(access_token_id) ? access_token_id : "",
        type,
        subject: ActivityEventModel.subject(event?.subject),
        metadata_json: ActivityEventModel.metadata_json(event?.metadata),
        created_at: Date.now()
      });
    } catch (error) {
      console.warn("record_user_event failed", error);
    }
  }

  /**
   * 积分流水一页。归属按 token 反查 user（**不过滤 revoked_at**，否则轮换会抹掉历史）。
   * 多取一条判有无下一页。
   * @param {string} user_id
   * @param {{ created_at: number, id: string } | null} cursor
   * @param {number} limit
   * @returns {{ values: Record<string, unknown>[], next_cursor: string | null }}
   */
  async credit_history_rows(user_id, cursor, limit) {
    const where = ActivityCursorModel.where(cursor);
    const clause = where.clause === "" ? "" : ` AND ${where.clause}`;
    const rows = await this.repo.credit.rows_for_user(user_id, clause, where.params, limit + 1);
    return ActivityPageModel(rows, limit, row => CreditTransactionModel.fromRow(row).toValue()).toValue();
  }

  /**
   * 用户操作事件一页（keyset 倒序，多取一条判有无下一页）。
   * @param {string} user_id
   * @param {{ created_at: number, id: string } | null} cursor
   * @param {number} limit
   * @returns {{ values: Record<string, unknown>[], next_cursor: string | null }}
   */
  async user_event_rows(user_id, cursor, limit) {
    const where = ActivityCursorModel.where(cursor);
    const clause = where.clause === "" ? "" : ` AND ${where.clause}`;
    const rows = await this.repo.activity.rows_for_user(user_id, clause, where.params, limit + 1);
    return ActivityPageModel(rows, limit, row => ActivityEventModel.fromRow(row).toValue()).toValue();
  }

  /**
   * 读者自查积分流水。user_id 只认 reader_auth 从 header 拿到的身份，
   * query 里只有 cursor/limit 两个参数。
   * @param {Request} request
   * @returns {Record<string, unknown>}
   */
  async reader_credit_history(request) {
    const identity = await this.app.auth.reader_auth(request);
    if (identity === null) throw do_error("authentication required", 401);
    const url = new URL(request.url);
    const page_cursor = ActivityCursorModel.fromQuery(url);
    if (page_cursor === false) throw do_error("invalid cursor", 400);
    const page = await this.credit_history_rows(identity.user_id, page_cursor.cursor, ActivityPageModel.clamp_limit(url.searchParams.get("limit")));
    return {
      transactions: page.values,
      next_cursor: page.next_cursor
    };
  }

  /**
   * 读者自查操作记录（登录/加源/退订/手动刷新/兑换…）。
   * @param {Request} request
   * @returns {Record<string, unknown>}
   */
  async reader_events_list(request) {
    const identity = await this.app.auth.reader_auth(request);
    if (identity === null) throw do_error("authentication required", 401);
    const url = new URL(request.url);
    const page_cursor = ActivityCursorModel.fromQuery(url);
    if (page_cursor === false) throw do_error("invalid cursor", 400);
    const page = await this.user_event_rows(identity.user_id, page_cursor.cursor, ActivityPageModel.clamp_limit(url.searchParams.get("limit")));
    return {
      events: page.values,
      next_cursor: page.next_cursor
    };
  }

  /**
   * 阅读端上报一条阅读操作事件（加源/退订/手动刷新）。
   *
   * 独立的 findrss-reader 单元在中央账号模式下把阅读操作转发到这里，让用户看到
   * 一份完整事件流（api 侧的 user_events 还含登录/兑换/积分，只有 api 知道）。
   * 类型收窄到「阅读端可上报」子集，身份一律取自已校验的注入头。
   * @param {Request} request
   * @returns {Promise<Record<string, unknown>>}
   */
  async reader_events_post(request) {
    const identity = await this.app.auth.reader_auth(request);
    if (identity === null) throw do_error("authentication required", 401);
    const content_length = Number(request.headers.get("Content-Length") ?? "0");
    if (Number.isFinite(content_length) && content_length > READER_SYNC_MAX_BODY) {
      throw do_error("request body is too large", 413);
    }
    let body;
    try {
      body = await request.json();
    } catch {
      throw do_error("invalid JSON", 400);
    }
    const type = ActivityEventModel.normalize_reader_type(body?.type);
    if (type === "") throw do_error("invalid event type", 400);
    await this.record_user_event({
      user_id: identity.user_id,
      access_token_id: identity.access_token_id,
      type,
      subject: body?.subject,
      metadata: body?.metadata
    });
    return {
      recorded: true
    };
  }

  /**
   * 管理端按用户查日志。管理端已由外层 ADMIN_PASSWORD 鉴权，这里不做归属过滤。
   * @param {string} user_id
   * @param {URL} url
   * @returns {Record<string, unknown>}
   */
  async admin_user_activity(user_id, url) {
    if (!valid_identifier(user_id)) throw do_error("invalid user id", 400);
    const kind = (url.searchParams.get("kind") ?? "credits").trim();
    if (kind !== "credits" && kind !== "events") throw do_error("invalid kind", 400);
    const page_cursor = ActivityCursorModel.fromQuery(url);
    if (page_cursor === false) throw do_error("invalid cursor", 400);
    const limit = ActivityPageModel.clamp_limit(url.searchParams.get("limit"));
    if (kind === "credits") {
      const page = await this.credit_history_rows(user_id, page_cursor.cursor, limit);
      return {
        transactions: page.values,
        next_cursor: page.next_cursor
      };
    }
    const page = await this.user_event_rows(user_id, page_cursor.cursor, limit);
    return {
      events: page.values,
      next_cursor: page.next_cursor
    };
  }
}
