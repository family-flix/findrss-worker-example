import test from "node:test";
import assert from "node:assert/strict";

import {
  RedemptionCampaignModel,
  RedemptionCardBatchModel,
  RedemptionCodeModel,
} from "../server/domain/redemption_code.js";

/** @param {unknown} value @returns {string | null} */
const normalize = (value) => RedemptionCodeModel.normalize(value);

/** `parse` 的 model 投影成 {code, credits} 便于断言。 */
function parsed_cards(value, max_count, max_credits) {
  const result = RedemptionCardBatchModel.parse(value, max_count, max_credits);
  assert.equal(result.ok, true, "期望解析成功");
  if (result.model === null) return null;
  return result.model.cards.map((card) => ({ code: card.code, credits: card.credits }));
}

/** `parse` 的错误串。 */
function parse_error(value, max_count, max_credits) {
  const result = RedemptionCardBatchModel.parse(value, max_count, max_credits);
  assert.equal(result.ok, false, "期望解析失败");
  return result.error;
}

test("RedemptionCodeModel.normalize accepts generated format", () => {
  assert.equal(normalize("FR-ABCD-EFGH-JKLM-NPQR"), "FRABCDEFGHJKLMNPQR");
  assert.equal(normalize("fr abcd efgh jklm npqr"), "FRABCDEFGHJKLMNPQR");
  assert.equal(normalize("frabcdefghjklmnpqr"), "FRABCDEFGHJKLMNPQR");
});

test("RedemptionCodeModel.normalize accepts custom alphanumeric codes", () => {
  assert.equal(normalize("GIFT-2026-READER"), "GIFT2026READER");
  assert.equal(normalize(" findrss team "), "FINDRSSTEAM");
  assert.equal(normalize("a".repeat(32)), "A".repeat(32));
});

test("RedemptionCodeModel.normalize rejects invalid values", () => {
  assert.equal(normalize("SHORT7"), null);
  assert.equal(normalize("A".repeat(33)), null);
  assert.equal(normalize(""), null);
  assert.equal(normalize("GIFT-2026!"), null);
  assert.equal(normalize("新年快乐2026"), null);
  assert.equal(normalize("ＡＢＣＤＥＦＧＨ"), null);
  assert.equal(normalize(12345678), null);
  assert.equal(normalize(null), null);
});

test("RedemptionCodeModel.hint masks generated and custom codes differently", () => {
  assert.equal(RedemptionCodeModel({ code: "FRABCDEFGHJKLMNPQR" }).hint(), "FR-••••-••••-••••-NPQR");
  assert.equal(RedemptionCodeModel({ code: "GIFT2026READER" }).hint(), "自定义 ••••ADER");
  assert.equal(RedemptionCodeModel({ code: "FRABCDEFGHJKLMNPQR" }).is_generated(), true);
  assert.equal(RedemptionCodeModel({ code: "GIFT2026READER" }).is_generated(), false);
});

test("RedemptionCodeModel.toValue 只吐明文码 / 积分 / 掩码，不吐哈希", () => {
  const value = RedemptionCodeModel({
    code: "FR-ABCD-EFGH-JKLM-NPQR",
    normalized_code: "FRABCDEFGHJKLMNPQR",
    credits: 5,
    code_hash: "deadbeef",
  }).toValue();
  assert.deepEqual(value, { code: "FR-ABCD-EFGH-JKLM-NPQR", credits: 5, code_hint: "FR-••••-••••-••••-NPQR" });
  assert.equal("code_hash" in value, false);
});

test("RedemptionCardBatchModel.parse treats missing value as auto mode", () => {
  for (const value of [undefined, null, ""]) {
    const result = RedemptionCardBatchModel.parse(value, 1000, 10_000_000);
    assert.deepEqual(result, { ok: true, model: null });
  }
});

test("RedemptionCardBatchModel.parse normalizes string entries with inherited credits", () => {
  assert.deepEqual(
    parsed_cards(["GIFT-2026-READER", " findrss team ", "AUTUMN2026"], 1000, 10_000_000),
    [
      { code: "GIFT2026READER", credits: null },
      { code: "FINDRSSTEAM", credits: null },
      { code: "AUTUMN2026", credits: null },
    ],
  );
});

test("RedemptionCardBatchModel.parse accepts per-card credits", () => {
  assert.deepEqual(
    parsed_cards(
      [
        { code: "GIFT-2026-READER", credits: 5 },
        { code: "findrss team", credits: 250 },
        { code: "AUTUMN2026" },
        { code: "WINTER2026X", credits: null },
      ],
      1000,
      10_000_000,
    ),
    [
      { code: "GIFT2026READER", credits: 5 },
      { code: "FINDRSSTEAM", credits: 250 },
      { code: "AUTUMN2026", credits: null },
      { code: "WINTER2026X", credits: null },
    ],
  );
});

test("RedemptionCardBatchModel.parse rejects same code written twice", () => {
  const error = parse_error(["GIFT-2026", "gift 2026"], 1000, 10_000_000);
  assert.equal(error.status, 400);
  assert.match(error.message, /duplicate redemption code: GIFT2026/);
});

test("RedemptionCardBatchModel.parse rejects bad payloads", () => {
  assert.equal(RedemptionCardBatchModel.parse("GIFT2026", 1000, 10_000_000).ok, false);
  assert.equal(RedemptionCardBatchModel.parse([], 1000, 10_000_000).ok, false);
  assert.equal(RedemptionCardBatchModel.parse(["GIFT2026", "GIFT-2026"], 1000, 10_000_000).ok, false);
  assert.equal(RedemptionCardBatchModel.parse(["SHORT1"], 1000, 10_000_000).ok, false);
  assert.equal(RedemptionCardBatchModel.parse([12345678], 1000, 10_000_000).ok, false);
  assert.equal(RedemptionCardBatchModel.parse([{}], 1000, 10_000_000).ok, false);
  const overflow = Array.from({ length: 3 }, (_, index) => "GIFT2026READER" + index);
  assert.equal(
    parse_error(overflow, 2, 10_000_000).message,
    "codes must contain at most 2 redemption codes",
  );
});

test("RedemptionCardBatchModel.parse rejects invalid per-card credits", () => {
  const max = 10_000_000;
  assert.equal(RedemptionCardBatchModel.parse([{ code: "GIFT2026", credits: 0 }], 1000, max).ok, false);
  assert.equal(RedemptionCardBatchModel.parse([{ code: "GIFT2026", credits: 1.5 }], 1000, max).ok, false);
  assert.equal(RedemptionCardBatchModel.parse([{ code: "GIFT2026", credits: "abc" }], 1000, max).ok, false);
  assert.equal(
    RedemptionCardBatchModel.parse([{ code: "GIFT2026", credits: max + 1 }], 1000, max).ok,
    false,
  );
  const error = parse_error([{ code: "GIFT2026", credits: 0 }], 1000, max);
  assert.match(error.message, /credits must be an integer between 1 and 10000000: GIFT2026/);
});

test("RedemptionCardBatchModel.parse reports the offending entry", () => {
  const error = parse_error(["GIFT2026", "BAD!"], 1000, 10_000_000);
  assert.match(error.message, /invalid redemption code: BAD!/);
});

test("RedemptionCardBatchModel.generate 出 FR 码、带哈希与掩码", async () => {
  const batch = await RedemptionCardBatchModel.generate(3);
  assert.equal(batch.count(), 3);
  assert.equal(batch.cards[0].code_hash.length, 64);
  assert.equal(batch.cards[0].is_generated(), true);
  assert.match(batch.cards[0].hint(), /^FR-••••-••••-••••-[A-Z2-9]{4}$/);
  assert.equal(batch.cards[0].credits, null);
  assert.equal(batch.toValue().length, 3);
});

test("RedemptionCardBatchModel.parse 的批次 seal 后补哈希，自身不变", async () => {
  const parsed = RedemptionCardBatchModel.parse(["GIFT2026READER"], 1000, 10_000_000);
  assert.equal(parsed.ok, true);
  const draft = parsed.model;
  assert.equal(draft.cards[0].code_hash, "");
  const sealed = await draft.seal();
  assert.equal(sealed.cards[0].code_hash.length, 64);
  assert.equal(sealed.cards[0].credits, null);
  assert.equal(sealed.cards[0].normalized_code, "GIFT2026READER");
  assert.equal(draft.cards[0].code_hash, "", "seal 不改自身");
});

test("RedemptionCampaignModel 的 status 派生按 paused → expired → scheduled → exhausted → active 排序", () => {
  const base = {
    id: 1,
    name: "批次",
    credits: 100,
    active: 1,
    starts_at: null,
    expires_at: null,
    created_at: 10,
    card_count: 10,
    redeemed_count: 2,
    revoked_count: 1,
  };
  assert.equal(RedemptionCampaignModel.fromRow(base).toValue(1000).status, "active");

  // 暂停优先于一切，即使同时已过期
  assert.equal(
    RedemptionCampaignModel.fromRow({ ...base, active: 0, expires_at: 1 }).toValue(1000).status,
    "paused",
  );
  // 到期判定用 <=，边界即过期
  assert.equal(
    RedemptionCampaignModel.fromRow({ ...base, expires_at: 1000 }).toValue(1000).status,
    "expired",
  );
  assert.equal(
    RedemptionCampaignModel.fromRow({ ...base, expires_at: 1001 }).toValue(1000).status,
    "active",
  );
  // 未开始用 >，边界即已开始
  assert.equal(
    RedemptionCampaignModel.fromRow({ ...base, starts_at: 1001 }).toValue(1000).status,
    "scheduled",
  );
  assert.equal(
    RedemptionCampaignModel.fromRow({ ...base, starts_at: 1000 }).toValue(1000).status,
    "active",
  );
  // 发完：卡数减已兑换减已撤销
  assert.equal(
    RedemptionCampaignModel.fromRow({ ...base, redeemed_count: 9, revoked_count: 1 })
      .toValue(1000).status,
    "exhausted",
  );
});

test("RedemptionCampaignModel 的 available_count 不会为负，null 时间保持 null", () => {
  const value = RedemptionCampaignModel.fromRow({
    id: 2,
    name: "超额",
    credits: 1,
    active: 1,
    starts_at: null,
    expires_at: null,
    created_at: 0,
    card_count: 1,
    redeemed_count: 5,
    revoked_count: 5,
  }).toValue(1000);
  assert.equal(value.available_count, 0);
  assert.equal(value.starts_at, null);
  assert.equal(value.expires_at, null);
  assert.equal(value.id, "2");
});

test("RedemptionCampaignModel.validate_cards 先校验积分后校验卡数", () => {
  assert.deepEqual(RedemptionCampaignModel.validate_cards(10, 1), { ok: true });
  assert.equal(
    RedemptionCampaignModel.validate_cards(10, 0).error.message,
    "credits must be an integer between 1 and 10000000",
  );
  assert.equal(
    RedemptionCampaignModel.validate_cards(0, 1).error.message,
    "card_count must be an integer between 1 and 1000",
  );
  assert.equal(
    RedemptionCampaignModel.validate_cards(RedemptionCampaignModel.MAX_CARDS + 1, 1).error.message,
    "card_count must be an integer between 1 and 1000",
  );
});

test("RedemptionCampaignModel.validate_window 的三段错误", () => {
  assert.deepEqual(RedemptionCampaignModel.validate_window({ starts_at: null, expires_at: null }), { ok: true });
  assert.deepEqual(RedemptionCampaignModel.validate_window({ starts_at: 5, expires_at: 10, now: 1 }), { ok: true });
  assert.equal(
    RedemptionCampaignModel.validate_window({ starts_at: -1 }).error.message,
    "starts_at must be a valid Unix timestamp in milliseconds",
  );
  assert.equal(
    RedemptionCampaignModel.validate_window({ expires_at: 100, now: 100 }).error.message,
    "expires_at must be in the future",
  );
  assert.equal(
    RedemptionCampaignModel.validate_window({ starts_at: 100, expires_at: 100, now: 0 }).error.message,
    "expires_at must be after starts_at",
  );
});

test("RedemptionCampaignModel.reject_reason 覆盖整棵失败树", () => {
  assert.deepEqual(RedemptionCampaignModel.reject_reason("campaign_expired"), {
    status: 410,
    message: "该兑换活动已过期",
  });
  assert.deepEqual(RedemptionCampaignModel.reject_reason("balance_limit"), {
    status: 409,
    message: "积分余额超过上限，暂时无法兑换",
  });
  for (const reason of [
    "authentication_required",
    "invalid_code",
    "already_redeemed",
    "code_used",
    "card_revoked",
    "campaign_inactive",
    "not_started",
    "campaign_already_redeemed",
  ]) {
    assert.notEqual(RedemptionCampaignModel.reject_reason(reason), null, reason);
  }
  assert.equal(RedemptionCampaignModel.reject_reason("something_else"), null);
});

test("RedemptionCardBatchModel 的 hashes 与 first_duplicate", async () => {
  const batch = await RedemptionCardBatchModel.generate(2);
  assert.equal(batch.hashes().length, 2);
  assert.equal(batch.hashes().every((hash) => hash.length > 0), true);
  // 无冲突
  assert.equal(batch.first_duplicate(new Set(["deadbeef"])), null);
  // 命中第一张的哈希即回第一张的明文码
  assert.equal(batch.first_duplicate(new Set([batch.hashes()[0]])), batch.cards[0].code);
  // 也接受数组
  assert.equal(batch.first_duplicate([batch.hashes()[1]]), batch.cards[1].code);
});
