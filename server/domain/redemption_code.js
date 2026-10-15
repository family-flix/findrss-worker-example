// 兑换码域：归一化校验、掩码提示、自定义批次解析、自动生成与落库哈希。
//
// 三个模型：
//   - `RedemptionCodeModel` 单张码（明文 / 归一码 / 归属积分 / 哈希）
//   - `RedemptionCardBatchModel` 一批码（parse 校验 → seal 补哈希；generate 一步到位）
//   - `RedemptionCampaignModel` 兑换活动（status / available_count 是派生值）
//
// 自动生成码固定为 FR + 16 位去混淆字母数字；管理员自定义码放宽为
// 8–32 位字母数字（忽略大小写，空格与连字符仅作分组符），并可按卡
// 指定积分（缺省继承活动默认积分）。
//
// 纯模块，不依赖 lib/http（校验失败只回数据，不回 Response）。

import { sha256_hex } from "../lib/crypto.js";
import { MAX_CREDIT_ADJUSTMENT, MAX_CREDIT_BALANCE, MAX_REDEMPTION_CARDS_PER_CAMPAIGN } from "../lib/constants.js";

const GENERATED_CODE_PATTERN = /^FR[A-HJ-NP-Z2-9]{16}$/;
const CUSTOM_CODE_PATTERN = /^[A-Z0-9]{8,32}$/;
/** 自动码的字母表（去掉易混淆的 I/O/0/1）。 */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** @param {string} normalized_code @returns {string} */
function code_hint_of(normalized_code) {
  if (GENERATED_CODE_PATTERN.test(normalized_code)) {
    return "FR-••••-••••-••••-" + normalized_code.slice(-4);
  }
  return "自定义 ••••" + normalized_code.slice(-4);
}

/** @param {unknown} value @returns {string} */
function describe_code_value(value) {
  if (typeof value !== "string") return typeof value;
  return value.length > 48 ? value.slice(0, 48) + "…" : value;
}

/**
 * 单张兑换卡：明文码、归一码、归属积分（`null` = 继承活动默认）与落库哈希。
 * `code_hash` 为空表示尚未封签（`parse` 只校验，`seal()` 才补哈希）。
 * @param {{ code?: unknown, normalized_code?: unknown, credits?: unknown, code_hash?: unknown }} [state]
 */
export function RedemptionCodeModel(state) {
  const source = state ?? {};
  const code = String(source.code ?? "");
  const normalized_code = source.normalized_code === undefined
    ? RedemptionCodeModel.normalize(code) ?? ""
    : String(source.normalized_code);
  const credits = source.credits === null || source.credits === undefined
    ? null
    : Number(source.credits);
  const state_ = Object.freeze({
    code,
    normalized_code,
    credits,
    code_hash: String(source.code_hash ?? ""),
  });
  return Object.freeze({
    ...state_,
    /** 是否是 FR- 自动码（掩码样式与自定义码不同）。 */
    is_generated: () => GENERATED_CODE_PATTERN.test(state_.normalized_code),
    /** 掩码提示，展示给管理员。 */
    hint: () => code_hint_of(state_.normalized_code),
    /** 对外响应字段（明文码 + 归属积分 + 掩码，从不吐哈希）。 */
    toValue: () => ({
      code: state_.code,
      credits: state_.credits,
      code_hint: code_hint_of(state_.normalized_code),
    }),
  });
}

RedemptionCodeModel.of = RedemptionCodeModel;
RedemptionCodeModel.GENERATED_PATTERN = GENERATED_CODE_PATTERN;
/**
 * 归一化：去掉空白与连字符并转大写，只有自动码或自定义码格式之一才有效。
 * @param {unknown} value
 * @returns {string | null}
 */
RedemptionCodeModel.normalize = (value) => {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/[\s-]/g, "").toUpperCase();
  if (GENERATED_CODE_PATTERN.test(normalized)) return normalized;
  return CUSTOM_CODE_PATTERN.test(normalized) ? normalized : null;
};
/**
 * 自动生成一枚带连字符的明文码（尚未归一化）。
 * @returns {string}
 */
RedemptionCodeModel.generate = () => {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const raw = [...bytes].map((byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join("");
  return "FR-" + raw.match(/.{1,4}/g).join("-");
};

/**
 * 一批待落库的兑换卡。`parse` 只做校验与归一（无哈希），`seal()` 补哈希，
 * `generate(count)` 一步到位。
 * @param {Array<{ code?: unknown, normalized_code?: unknown, credits?: unknown, code_hash?: unknown }>} [cards]
 */
export function RedemptionCardBatchModel(cards) {
  const values = Object.freeze(
    (Array.isArray(cards) ? cards : []).map((card) => RedemptionCodeModel(card)),
  );
  return Object.freeze({
    cards: values,
    count: () => values.length,
    /** 批次的落库哈希列表（未封签时全为空串）。 */
    hashes: () => values.map((card) => card.code_hash),
    /**
     * 在已存在的哈希集合里挑出第一张冲突卡的明文码（仅用于自定义码的友好报错）。
     * @param {Iterable<unknown>} existing_hashes
     * @returns {string | null}
     */
    first_duplicate: (existing_hashes) => {
      const existing = existing_hashes instanceof Set
        ? existing_hashes
        : new Set(existing_hashes ?? []);
      const hit = values.find((card) => existing.has(card.code_hash));
      return hit === undefined ? null : hit.code;
    },
    /** 计算落库哈希，返回新的已封签批次（自身不变）。 */
    seal: async () => RedemptionCardBatchModel(await Promise.all(values.map(async (card) => ({
      code: card.code,
      normalized_code: card.normalized_code,
      credits: card.credits,
      code_hash: await sha256_hex(card.normalized_code),
    })))),
    toValue: () => values.map((card) => card.toValue()),
  });
}

RedemptionCardBatchModel.of = RedemptionCardBatchModel;
/**
 * 自动生成 `count` 张 FR- 码，返回已封签（带哈希）的批次。
 * @param {number} count
 */
RedemptionCardBatchModel.generate = async (count) => {
  const cards = [];
  for (let index = 0; index < count; index += 1) {
    const code = RedemptionCodeModel.generate();
    const normalized_code = RedemptionCodeModel.normalize(code);
    if (normalized_code === null) throw new Error("failed to generate redemption code");
    cards.push({
      code,
      normalized_code,
      credits: null,
      code_hash: await sha256_hex(normalized_code),
    });
  }
  return RedemptionCardBatchModel(cards);
};
/**
 * 解析请求里的自定义兑换卡列表；value 缺省表示沿用自动生成（model 为 null）。
 * 条目为字符串（继承活动默认积分）或 {code, credits}（credits 缺省同样继承）。
 * 错误文案保持逐字不变（测试锁死）。
 * @param {unknown} value
 * @param {number} max_count
 * @param {number} max_credits
 * @returns {{ ok: true, model: ReturnType<typeof RedemptionCardBatchModel> | null }
 *   | { ok: false, error: { status: number, message: string } }}
 */
RedemptionCardBatchModel.parse = (value, max_count, max_credits) => {
  if (value === undefined || value === null || value === "") return { ok: true, model: null };
  const invalid = (message) => ({ ok: false, error: { status: 400, message } });
  if (!Array.isArray(value)) {
    return invalid("codes must be an array of redemption codes or cards");
  }
  if (value.length < 1) {
    return invalid("codes must contain at least one redemption code");
  }
  if (value.length > max_count) {
    return invalid("codes must contain at most " + max_count + " redemption codes");
  }
  /** @param {unknown} credits @returns {number | null | "invalid"} */
  const parse_credits = (credits) => {
    if (credits === undefined || credits === null || credits === "") return null;
    const value_credits = Number(credits);
    if (!Number.isInteger(value_credits) || value_credits < 1 || value_credits > max_credits) {
      return "invalid";
    }
    return value_credits;
  };
  const cards = [];
  const seen = new Set();
  for (const entry of value) {
    const code_value = typeof entry === "string" ? entry : entry?.code;
    const normalized = RedemptionCodeModel.normalize(code_value);
    if (normalized === null) {
      return invalid("invalid redemption code: " + describe_code_value(code_value));
    }
    if (seen.has(normalized)) {
      return invalid("duplicate redemption code: " + normalized);
    }
    let credits = null;
    if (typeof entry === "object" && entry !== null) {
      const parsed_credits = parse_credits(entry.credits);
      if (parsed_credits === "invalid") {
        return invalid("credits must be an integer between 1 and " + max_credits + ": " + normalized);
      }
      credits = parsed_credits;
    }
    seen.add(normalized);
    cards.push({ code: normalized, normalized_code: normalized, credits });
  }
  return { ok: true, model: RedemptionCardBatchModel(cards) };
};

/**
 * 兑换活动实体。`status` 与 `available_count` 是派生值而非存储列：
 * paused 优先于一切，其次是到期、未开始、发完。
 * @param {Record<string, unknown>} [row]
 */
export function RedemptionCampaignModel(row) {
  const source = row ?? {};
  const state = Object.freeze({
    id: String(source.id),
    name: String(source.name),
    credits: Number(source.credits),
    active: Number(source.active) === 1,
    starts_at: source.starts_at === null ? null : Number(source.starts_at),
    expires_at: source.expires_at === null ? null : Number(source.expires_at),
    created_at: Number(source.created_at),
    card_count: Number(source.card_count || 0),
    redeemed_count: Number(source.redeemed_count || 0),
    revoked_count: Number(source.revoked_count || 0),
  });
  const available_count = Math.max(0, state.card_count - state.redeemed_count - state.revoked_count);
  /** @param {number} [now] @returns {string} */
  const status_of = (now = Date.now()) => {
    if (!state.active) return "paused";
    if (state.expires_at !== null && state.expires_at <= now) return "expired";
    if (state.starts_at !== null && state.starts_at > now) return "scheduled";
    if (available_count <= 0) return "exhausted";
    return "active";
  };
  return Object.freeze({
    ...state,
    available_count,
    status: status_of,
    toValue: (now = Date.now()) => ({
      id: state.id,
      name: state.name,
      credits: state.credits,
      active: state.active,
      starts_at: state.starts_at,
      expires_at: state.expires_at,
      created_at: state.created_at,
      card_count: state.card_count,
      redeemed_count: state.redeemed_count,
      revoked_count: state.revoked_count,
      available_count,
      status: status_of(now),
    }),
  });
}

RedemptionCampaignModel.of = RedemptionCampaignModel;
/** 从 SQLite 行构造。 */
RedemptionCampaignModel.fromRow = (row) => RedemptionCampaignModel(row);
/** 单个活动最多卡数。 */
RedemptionCampaignModel.MAX_CARDS = MAX_REDEMPTION_CARDS_PER_CAMPAIGN;
/** 单卡面值上限（与积分调整上限同源）。 */
RedemptionCampaignModel.MAX_BALANCE = MAX_CREDIT_BALANCE;
/**
 * 校验活动的卡数与单卡积分。错误文案逐字不变（管理页与测试都依赖）。
 * 注意顺序：先积分后卡数，与既有 400 文案一一对应。
 * @param {unknown} card_count
 * @param {unknown} credits
 * @returns {{ ok: true } | { ok: false, error: { status: number, message: string } }}
 */
RedemptionCampaignModel.validate_cards = (card_count, credits) => {
  if (!Number.isInteger(credits) || Number(credits) < 1 || Number(credits) > MAX_CREDIT_ADJUSTMENT) {
    return { ok: false, error: { status: 400, message: "credits must be an integer between 1 and 10000000" } };
  }
  if (
    !Number.isInteger(card_count) ||
    Number(card_count) < 1 ||
    Number(card_count) > MAX_REDEMPTION_CARDS_PER_CAMPAIGN
  ) {
    return { ok: false, error: { status: 400, message: "card_count must be an integer between 1 and 1000" } };
  }
  return { ok: true };
};
/**
 * 校验活动的时间窗：starts_at 可为空，expires_at 必须在未来且晚于 starts_at。
 * 错误文案逐字不变（管理页与测试都依赖）。
 * @param {{ starts_at?: number | null, expires_at?: number | null, now?: number }} [window]
 * @returns {{ ok: true } | { ok: false, error: { status: number, message: string } }}
 */
RedemptionCampaignModel.validate_window = (window) => {
  const { starts_at = null, expires_at = null, now = Date.now() } = window ?? {};
  if (starts_at !== null && (!Number.isSafeInteger(starts_at) || starts_at < 0)) {
    return { ok: false, error: { status: 400, message: "starts_at must be a valid Unix timestamp in milliseconds" } };
  }
  if (expires_at !== null && (!Number.isSafeInteger(expires_at) || expires_at <= now)) {
    return { ok: false, error: { status: 400, message: "expires_at must be in the future" } };
  }
  if (starts_at !== null && expires_at !== null && expires_at <= starts_at) {
    return { ok: false, error: { status: 400, message: "expires_at must be after starts_at" } };
  }
  return { ok: true };
};
/**
 * 兑换失败原因 → HTTP 状态与文案。未知原因返回 null（当作成功）。
 * 文案逐字不变（客户端与测试都依赖）。
 * @param {unknown} reason
 * @returns {{ status: number, message: string } | null}
 */
RedemptionCampaignModel.reject_reason = (reason) => {
  const map = {
    authentication_required: { status: 401, message: "authentication required" },
    invalid_code: { status: 404, message: "兑换码不存在" },
    already_redeemed: { status: 409, message: "这张兑换卡已使用" },
    code_used: { status: 409, message: "这张兑换卡已被使用" },
    card_revoked: { status: 409, message: "这张兑换卡已停用" },
    campaign_inactive: { status: 409, message: "该兑换活动已停用" },
    not_started: { status: 409, message: "该兑换活动尚未开始" },
    campaign_expired: { status: 410, message: "该兑换活动已过期" },
    campaign_already_redeemed: {
      status: 409,
      message: "你已兑换过此活动，不能重复使用同一批次的其他兑换卡",
    },
    balance_limit: { status: 409, message: "积分余额超过上限，暂时无法兑换" },
  };
  return map[String(reason)] ?? null;
};
