// redemption_campaigns / redemption_cards / redemption_uses 三张表的读写。
//
// 纯 SQL 层：只回原始行 / 数字 / void，不 import service、不造 Response。
// 卡片状态的派生（redeemed > revoked > available）与字段归一由调用方完成。

export class RepositoryRedemption {
  /** @param {{ sql: D1Store }} deps */
  constructor({
    sql
  }) {
    this.sql = sql;
  }

  /** @returns {number} */
  async count_campaigns() {
    return Number((await this.sql.exec("SELECT COUNT(*) AS count FROM redemption_campaigns")).toArray()[0]?.count ?? 0);
  }

  /**
   * 活动一页（含卡片数 / 已兑换数 / 已撤销数）。
   * @param {number} limit @param {number} offset
   * @returns {Record<string, unknown>[]}
   */
  async list_campaigns(limit, offset) {
    return (await this.sql.exec(`SELECT campaigns.*,
                COUNT(cards.id) AS card_count,
                SUM(CASE WHEN uses.id IS NOT NULL THEN 1 ELSE 0 END) AS redeemed_count,
                SUM(CASE WHEN cards.revoked_at IS NOT NULL THEN 1 ELSE 0 END) AS revoked_count
         FROM redemption_campaigns AS campaigns
         LEFT JOIN redemption_cards AS cards ON cards.campaign_id = campaigns.id
         LEFT JOIN redemption_uses AS uses ON uses.card_id = cards.id
         GROUP BY campaigns.id
         ORDER BY campaigns.created_at DESC
         LIMIT ? OFFSET ?`, limit, offset)).toArray();
  }

  /** @param {string} code_hash @returns {boolean} 某明文码哈希是否已落库。 */
  async card_exists_by_hash(code_hash) {
    return (await this.sql.exec("SELECT id FROM redemption_cards WHERE code_hash = ? LIMIT 1", code_hash)).toArray().length > 0;
  }

  /**
   * 兑换码对应的卡片 + 活动（含 `COALESCE(cards.credits, campaigns.credits)`）。
   * @param {string} code_hash
   * @returns {Record<string, unknown> | undefined}
   */
  async find_card_by_hash(code_hash) {
    return (await this.sql.exec(`SELECT cards.id AS card_id, cards.campaign_id, cards.revoked_at,
                campaigns.name, COALESCE(cards.credits, campaigns.credits) AS credits,
                campaigns.active, campaigns.starts_at, campaigns.expires_at
         FROM redemption_cards AS cards
         JOIN redemption_campaigns AS campaigns ON campaigns.id = cards.campaign_id
         WHERE cards.code_hash = ? LIMIT 1`, code_hash)).toArray()[0];
  }

  /** @param {string} card_id @returns {Record<string, unknown> | undefined} */
  async find_use_by_card(card_id) {
    return (await this.sql.exec("SELECT user_id FROM redemption_uses WHERE card_id = ? LIMIT 1", card_id)).toArray()[0];
  }

  /** @param {string} campaign_id @param {string} user_id @returns {boolean} */
  async has_use_by_campaign_user(campaign_id, user_id) {
    return (await this.sql.exec("SELECT id FROM redemption_uses WHERE campaign_id = ? AND user_id = ? LIMIT 1", campaign_id, user_id)).toArray().length > 0;
  }

  /**
   * @param {{
   *   id: string, campaign_id: string, card_id: string, user_id: string,
   *   access_token_id: string, created_at: number,
   * }} fields
   * @returns {void}
   */
  async insert_use(fields) {
    await this.sql.exec(`INSERT INTO redemption_uses (
        id, campaign_id, card_id, user_id, access_token_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)`, fields.id, fields.campaign_id, fields.card_id, fields.user_id, fields.access_token_id, fields.created_at);
  }

  /**
   * 新建活动后回读（redeemed/revoked 恒为 0）。
   * @param {string} campaign_id
   * @returns {Record<string, unknown> | undefined}
   */
  async find_campaign_fresh(campaign_id) {
    return (await this.sql.exec(`SELECT campaigns.*, COUNT(cards.id) AS card_count,
                0 AS redeemed_count, 0 AS revoked_count
         FROM redemption_campaigns AS campaigns
         LEFT JOIN redemption_cards AS cards ON cards.campaign_id = campaigns.id
         WHERE campaigns.id = ? GROUP BY campaigns.id`, campaign_id)).toArray()[0];
  }

  /**
   * 活动名 / 活动积分 / 现有卡片数（追加卡片前的额度校验）。
   * @param {string} campaign_id
   * @returns {Record<string, unknown> | undefined}
   */
  async find_campaign_card_count(campaign_id) {
    return (await this.sql.exec(`SELECT campaigns.name, campaigns.credits, COUNT(cards.id) AS card_count
         FROM redemption_campaigns AS campaigns
         LEFT JOIN redemption_cards AS cards ON cards.campaign_id = campaigns.id
         WHERE campaigns.id = ? GROUP BY campaigns.id`, campaign_id)).toArray()[0];
  }

  /**
   * 单个活动的详情（含统计列）。
   * @param {string} campaign_id
   * @returns {Record<string, unknown> | undefined}
   */
  async find_campaign_detail(campaign_id) {
    return (await this.sql.exec(`SELECT campaigns.*,
                COUNT(cards.id) AS card_count,
                SUM(CASE WHEN uses.id IS NOT NULL THEN 1 ELSE 0 END) AS redeemed_count,
                SUM(CASE WHEN cards.revoked_at IS NOT NULL THEN 1 ELSE 0 END) AS revoked_count
         FROM redemption_campaigns AS campaigns
         LEFT JOIN redemption_cards AS cards ON cards.campaign_id = campaigns.id
         LEFT JOIN redemption_uses AS uses ON uses.card_id = cards.id
         WHERE campaigns.id = ? GROUP BY campaigns.id`, campaign_id)).toArray()[0];
  }

  /** @param {string} campaign_id @returns {boolean} */
  async campaign_exists(campaign_id) {
    return (await this.sql.exec("SELECT id FROM redemption_campaigns WHERE id = ? LIMIT 1", campaign_id)).toArray().length > 0;
  }

  /**
   * 活动下卡片一页（含兑换人信息）。
   * @param {string} campaign_id @param {number} limit @param {number} offset
   * @returns {Record<string, unknown>[]}
   */
  async list_cards(campaign_id, limit, offset) {
    return (await this.sql.exec(`SELECT cards.id, cards.code_hint,
                COALESCE(cards.credits, campaigns.credits) AS credits,
                cards.revoked_at, cards.created_at,
                uses.created_at AS redeemed_at, users.name AS redeemer_name,
                user_credentials.email AS redeemer_email
         FROM redemption_cards AS cards
         JOIN redemption_campaigns AS campaigns ON campaigns.id = cards.campaign_id
         LEFT JOIN redemption_uses AS uses ON uses.card_id = cards.id
         LEFT JOIN users ON users.id = uses.user_id
         LEFT JOIN user_credentials ON user_credentials.user_id = uses.user_id
         WHERE cards.campaign_id = ? ORDER BY cards.created_at, cards.id
         LIMIT ? OFFSET ?`, campaign_id, limit, offset)).toArray();
  }

  /** @param {string} campaign_id @param {number} active @returns {void} */
  async set_campaign_active(campaign_id, active) {
    await this.sql.exec("UPDATE redemption_campaigns SET active = ? WHERE id = ?", active, campaign_id);
  }

  /**
   * 撤销卡片前取状态。
   * @param {string} card_id @param {string} campaign_id
   * @returns {Record<string, unknown> | undefined}
   */
  async find_card_for_revoke(card_id, campaign_id) {
    return (await this.sql.exec(`SELECT cards.revoked_at, uses.id AS redemption_id
         FROM redemption_cards AS cards
         LEFT JOIN redemption_uses AS uses ON uses.card_id = cards.id
         WHERE cards.id = ? AND cards.campaign_id = ? LIMIT 1`, card_id, campaign_id)).toArray()[0];
  }

  /** @param {string} card_id @param {number} now @returns {void} */
  async revoke_card(card_id, now) {
    await this.sql.exec("UPDATE redemption_cards SET revoked_at = ? WHERE id = ?", now, card_id);
  }

  /**
   * 用户已兑换的活动（读者积分总览，最多 100 条）。
   * @param {string} user_id
   * @returns {Record<string, unknown>[]}
   */
  async list_redeemed_campaigns(user_id) {
    return (await this.sql.exec(`SELECT campaigns.id, campaigns.name, uses.created_at AS redeemed_at
         FROM redemption_uses AS uses
         JOIN redemption_campaigns AS campaigns ON campaigns.id = uses.campaign_id
         WHERE uses.user_id = ? ORDER BY uses.created_at DESC LIMIT 100`, user_id)).toArray();
  }

  /**
   * @param {{
   *   id: string, name: string, credits: number, starts_at: number | null,
   *   expires_at: number | null, created_at: number,
   * }} fields
   * @returns {void}
   */
  async insert_campaign(fields) {
    await this.sql.exec(`INSERT INTO redemption_campaigns (
        id, name, credits, active, starts_at, expires_at, created_at
      ) VALUES (?, ?, ?, 1, ?, ?, ?)`, fields.id, fields.name, fields.credits, fields.starts_at, fields.expires_at, fields.created_at);
  }

  /**
   * @param {{
   *   id: string, campaign_id: string, code_hash: string, code_hint: string,
   *   credits: number, created_at: number,
   * }} fields
   * @returns {void}
   */
  async insert_card(fields) {
    await this.sql.exec(`INSERT INTO redemption_cards (
        id, campaign_id, code_hash, code_hint, credits, revoked_at, created_at
      ) VALUES (?, ?, ?, ?, ?, NULL, ?)`, fields.id, fields.campaign_id, fields.code_hash, fields.code_hint, fields.credits, fields.created_at);
  }
}
