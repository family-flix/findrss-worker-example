// 兑换活动 / 兑换卡 / 兑换动作（写路径）。
//
// 只回数据或抛 DurableObjectError，绝不造 Response（router 是唯一翻译点）。
import { ActivityEventModel } from "../../domain/activity_log.js";
import { CreditModel } from "../../domain/credits.js";
import { RedemptionCampaignModel, RedemptionCardBatchModel, RedemptionCodeModel } from "../../domain/redemption_code.js";
import { DEFAULT_REDEMPTION_PAGE_SIZE } from "../../lib/constants.js";
import { sha256_hex } from "../../lib/crypto.js";
import { valid_identifier } from "../../lib/identifiers.js";
import { do_error, do_result } from "./error.js";
export class ServiceRedemption {
  /**
   * @param {{ repo: Record<string, any>, storage: D1Store, app: Record<string, any> }} deps
   */
  constructor({
    repo,
    storage,
    app
  }) {
    this.repo = repo;
    this.storage = storage;
    /** 兄弟服务注册表（activity 的 record_user_event）。 */
    this.app = app;
  }

  /** @param {URL} url @returns {Record<string, unknown>} */
  async list_redemption_campaigns(url) {
    const limit_value = Number(url.searchParams.get("limit") ?? DEFAULT_REDEMPTION_PAGE_SIZE);
    const offset_value = Number(url.searchParams.get("offset") ?? "0");
    const limit = Number.isFinite(limit_value) ? Math.max(1, Math.min(DEFAULT_REDEMPTION_PAGE_SIZE, Math.floor(limit_value))) : DEFAULT_REDEMPTION_PAGE_SIZE;
    const offset = Number.isFinite(offset_value) ? Math.max(0, Math.min(1_000_000, Math.floor(offset_value))) : 0;
    const total_count = await this.repo.redemption.count_campaigns();
    const rows = await this.repo.redemption.list_campaigns(limit, offset);
    return {
      campaigns: rows.map(row => RedemptionCampaignModel.fromRow(row).toValue()),
      total_count,
      limit,
      offset
    };
  }

  /**
   * 在已落库的兑换卡里查找冲突的哈希，返回冲突的明文码（仅用于自定义码的友好报错）。
   * @param {ReturnType<typeof RedemptionCardBatchModel>} batch
   * @returns {string | null}
   */
  async find_existing_redemption_code(batch) {
    const existing = new Set();
    for (const card of batch.cards) {
      if (await this.repo.redemption.card_exists_by_hash(card.code_hash)) {
        existing.add(card.code_hash);
      }
    }
    return batch.first_duplicate(existing);
  }

  /** @param {Request} request @returns {Promise<Record<string, unknown>>} */
  async create_redemption_campaign(request) {
    const content_length = Number(request.headers.get("Content-Length") ?? "0");
    if (content_length > 32 * 1024) throw do_error("request body is too large", 413);
    /** @type {{name?: unknown, credits?: unknown, card_count?: unknown, codes?: unknown, starts_at?: unknown, expires_at?: unknown}} */
    let body;
    try {
      body = await request.json();
    } catch {
      throw do_error("invalid JSON", 400);
    }
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      throw do_error("invalid JSON body", 400);
    }
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const credits = Number(body.credits);
    const parsed_cards = RedemptionCardBatchModel.parse(body.codes, RedemptionCampaignModel.MAX_CARDS, CreditModel.MAX_ADJUSTMENT);
    if (!parsed_cards.ok) throw do_error(parsed_cards.error.message, parsed_cards.error.status);
    const custom_cards = parsed_cards.model;
    if (custom_cards !== null && body.card_count !== undefined && Number(body.card_count) !== custom_cards.count()) {
      throw do_error("card_count must match the number of custom codes", 400);
    }
    const card_count = custom_cards === null ? Number(body.card_count) : custom_cards.count();
    const starts_at = body.starts_at === null || body.starts_at === undefined || body.starts_at === "" ? null : Number(body.starts_at);
    const expires_at = body.expires_at === null || body.expires_at === undefined || body.expires_at === "" ? null : Number(body.expires_at);
    if (name.length < 1 || name.length > 80 || /[\u0000-\u001f\u007f]/.test(name)) {
      throw do_error("name must be 1 to 80 characters", 400);
    }
    const cards_result = RedemptionCampaignModel.validate_cards(card_count, credits);
    if (!cards_result.ok) throw do_error(cards_result.error.message, cards_result.error.status);
    const window_result = RedemptionCampaignModel.validate_window({
      starts_at,
      expires_at
    });
    if (!window_result.ok) {
      throw do_error(window_result.error.message, window_result.error.status);
    }
    const now = Date.now();
    const campaign_id = crypto.randomUUID();
    const batch = custom_cards === null ? await RedemptionCardBatchModel.generate(card_count) : await custom_cards.seal();
    if (custom_cards !== null) {
      const existing_code = await this.find_existing_redemption_code(batch);
      if (existing_code !== null) {
        throw do_error("redemption code already exists: " + existing_code, 409);
      }
    }
    await this.storage.transaction(async () => {
      await this.repo.redemption.insert_campaign({
        id: campaign_id,
        name,
        credits,
        starts_at,
        expires_at,
        created_at: now
      });
      for (const card of batch.cards) {
        await this.repo.redemption.insert_card({
          id: crypto.randomUUID(),
          campaign_id,
          code_hash: card.code_hash,
          code_hint: card.hint(),
          credits: card.credits,
          created_at: now
        });
      }
    });
    const campaign = await this.repo.redemption.find_campaign_fresh(campaign_id);
    return do_result({
      campaign: RedemptionCampaignModel.fromRow(campaign).toValue(now),
      codes: batch.toValue()
    }, 201);
  }

  /** @param {Request} request @param {string} campaign_id @returns {Promise<Record<string, unknown>>} */
  async create_redemption_cards(request, campaign_id) {
    let body;
    try {
      body = await request.json();
    } catch {
      throw do_error("invalid JSON", 400);
    }
    const parsed_cards = RedemptionCardBatchModel.parse(body?.codes, RedemptionCampaignModel.MAX_CARDS, CreditModel.MAX_ADJUSTMENT);
    if (!parsed_cards.ok) throw do_error(parsed_cards.error.message, parsed_cards.error.status);
    const custom_cards = parsed_cards.model;
    if (custom_cards !== null && body?.card_count !== undefined && Number(body.card_count) !== custom_cards.count()) {
      throw do_error("card_count must match the number of custom codes", 400);
    }
    const card_count = custom_cards === null ? Number(body?.card_count) : custom_cards.count();
    if (!Number.isInteger(card_count) || card_count < 1 || card_count > RedemptionCampaignModel.MAX_CARDS) {
      throw do_error("card_count must be an integer between 1 and 1000", 400);
    }
    const campaign = await this.repo.redemption.find_campaign_card_count(campaign_id);
    if (campaign === undefined) throw do_error("redemption campaign not found", 404);
    if (Number(campaign.card_count) + card_count > RedemptionCampaignModel.MAX_CARDS) {
      throw do_error("a redemption campaign can contain at most 1000 cards", 400);
    }
    const now = Date.now();
    const batch = custom_cards === null ? await RedemptionCardBatchModel.generate(card_count) : await custom_cards.seal();
    if (custom_cards !== null) {
      const existing_code = await this.find_existing_redemption_code(batch);
      if (existing_code !== null) {
        throw do_error("redemption code already exists: " + existing_code, 409);
      }
    }
    await this.storage.transaction(async () => {
      for (const card of batch.cards) {
        await this.repo.redemption.insert_card({
          id: crypto.randomUUID(),
          campaign_id,
          code_hash: card.code_hash,
          code_hint: card.hint(),
          credits: card.credits,
          created_at: now
        });
      }
    });
    return do_result({
      campaign: {
        id: campaign_id,
        name: String(campaign.name),
        credits: Number(campaign.credits)
      },
      codes: batch.toValue()
    }, 201);
  }

  /** @param {string} campaign_id @param {number} limit @param {number} offset @returns {Record<string, unknown>} */
  async get_redemption_campaign(campaign_id, limit = DEFAULT_REDEMPTION_PAGE_SIZE, offset = 0) {
    const campaign_row = await this.repo.redemption.find_campaign_detail(campaign_id);
    if (campaign_row === undefined) throw do_error("redemption campaign not found", 404);
    const cards = (await this.repo.redemption.list_cards(campaign_id, limit, offset)).map(row => ({
      id: String(row.id),
      code_hint: String(row.code_hint),
      credits: Number(row.credits),
      status: row.redeemed_at !== null ? "redeemed" : row.revoked_at !== null ? "revoked" : "available",
      created_at: Number(row.created_at),
      revoked_at: row.revoked_at === null ? null : Number(row.revoked_at),
      redeemed_at: row.redeemed_at === null ? null : Number(row.redeemed_at),
      redeemer_name: row.redeemer_name ?? null,
      redeemer_email: row.redeemer_email ?? null
    }));
    return {
      campaign: RedemptionCampaignModel.fromRow(campaign_row).toValue(),
      cards,
      total_card_count: Number(campaign_row.card_count),
      limit,
      offset
    };
  }

  /** @param {Request} request @param {string} campaign_id @returns {Promise<Record<string, unknown>>} */
  async update_redemption_campaign(request, campaign_id) {
    let body;
    try {
      body = await request.json();
    } catch {
      throw do_error("invalid JSON", 400);
    }
    if (body === null || typeof body !== "object" || Array.isArray(body) || typeof body.active !== "boolean") {
      throw do_error("active must be a boolean", 400);
    }
    if (!(await this.repo.redemption.campaign_exists(campaign_id))) {
      throw do_error("redemption campaign not found", 404);
    }
    await this.repo.redemption.set_campaign_active(campaign_id, body.active ? 1 : 0);
    return await this.get_redemption_campaign(campaign_id);
  }

  /** @param {string} campaign_id @param {string} card_id @returns {Record<string, unknown>} */
  async revoke_redemption_card(campaign_id, card_id) {
    const card = await this.repo.redemption.find_card_for_revoke(card_id, campaign_id);
    if (card === undefined) throw do_error("redemption card not found", 404);
    if (card.redemption_id !== null) throw do_error("redeemed cards cannot be revoked", 409);
    if (card.revoked_at === null) {
      await this.repo.redemption.revoke_card(card_id, Date.now());
    }
    return {
      revoked: true
    };
  }

  /** @param {Request} request @returns {Promise<Record<string, unknown>>} */
  async redeem_credit_card(request) {
    const user_id = (request.headers.get("X-Api-User-ID") ?? "").trim();
    const access_token_id = (request.headers.get("X-Api-Access-Token-ID") ?? "").trim();
    if (!valid_identifier(user_id) || !valid_identifier(access_token_id)) {
      throw do_error("authentication required", 401);
    }
    const content_length = Number(request.headers.get("Content-Length") ?? "0");
    if (content_length > 4096) throw do_error("request body is too large", 413);
    let body;
    try {
      body = await request.json();
    } catch {
      throw do_error("invalid JSON", 400);
    }
    const normalized_code = RedemptionCodeModel.normalize(body?.code);
    if (normalized_code === null) throw do_error("兑换码格式无效", 400);
    const code_hash = await sha256_hex(normalized_code);
    const now = Date.now();
    const result = await this.storage.transaction(async () => {
      const token = await this.repo.access_tokens.find_active_for_user(access_token_id, user_id, now);
      if (token === undefined) return {
        error: "authentication_required"
      };
      const card = await this.repo.redemption.find_card_by_hash(code_hash);
      if (card === undefined) return {
        error: "invalid_code"
      };
      const existing_card_use = await this.repo.redemption.find_use_by_card(card.card_id);
      if (existing_card_use !== undefined) {
        return {
          error: existing_card_use.user_id === user_id ? "already_redeemed" : "code_used"
        };
      }
      if (card.revoked_at !== null) return {
        error: "card_revoked"
      };
      if (Number(card.active) !== 1) return {
        error: "campaign_inactive"
      };
      if (card.starts_at !== null && Number(card.starts_at) > now) return {
        error: "not_started"
      };
      if (card.expires_at !== null && Number(card.expires_at) <= now) return {
        error: "campaign_expired"
      };
      if (await this.repo.redemption.has_use_by_campaign_user(card.campaign_id, user_id)) {
        return {
          error: "campaign_already_redeemed"
        };
      }
      const credits = Number(card.credits);
      const balance = Number(token.credit_balance) + credits;
      if (CreditModel.over_balance_limit(balance)) return {
        error: "balance_limit"
      };
      await this.repo.redemption.insert_use({
        id: crypto.randomUUID(),
        campaign_id: card.campaign_id,
        card_id: card.card_id,
        user_id,
        access_token_id,
        created_at: now
      });
      await this.repo.access_tokens.set_balance_granted(access_token_id, balance, credits);
      await this.repo.credit.insert({
        id: crypto.randomUUID(),
        access_token_id,
        task_id: null,
        type: "redemption",
        amount: credits,
        balance_after: balance,
        method: null,
        subject: ActivityEventModel.subject(card.name),
        note: "兑换活动：" + String(card.name),
        created_at: now
      });
      await this.app.activity.record_user_event({
        user_id,
        access_token_id,
        type: "redeem",
        subject: ActivityEventModel.subject(card.name),
        metadata: {
          campaign_id: String(card.campaign_id),
          credits
        }
      });
      return {
        campaign: {
          id: String(card.campaign_id),
          name: String(card.name)
        },
        credits,
        credit_balance: balance
      };
    });
    const rejection = RedemptionCampaignModel.reject_reason(result.error);
    if (rejection !== null) throw do_error(rejection.message, rejection.status);
    return result;
  }
}
