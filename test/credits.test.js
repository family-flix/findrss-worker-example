import assert from "node:assert/strict";
import test from "node:test";

import { CreditModel, CreditTransactionModel } from "../server/domain/credits.js";

test("CreditModel 计价走默认成本，响应头只在有余额时出现", () => {
  assert.equal(CreditModel.cost_for("get_feed"), CreditModel.DEFAULT_COST);
  assert.equal(CreditModel.cost_for("ping"), CreditModel.DEFAULT_COST);
  assert.deepEqual(CreditModel.headers(null), {});
  assert.deepEqual(CreditModel.headers(5), { "X-Api-Credit-Balance": "5" });
  // 实例方法只是同一份行为的具名入口。
  const model = CreditModel();
  assert.equal(model.cost_for("get_feed"), CreditModel.DEFAULT_COST);
  assert.deepEqual(model.headers(0), { "X-Api-Credit-Balance": "0" });
});

test("CreditTransactionModel 透传 subject 并把数值 Number 化", () => {
  const value = CreditTransactionModel.fromRow({
    id: "t1",
    access_token_id: "tok",
    task_id: null,
    type: "charge",
    amount: "-1",
    balance_after: "9",
    method: "wxmp.fetch",
    subject: "刷新「示例」",
    note: "API call",
    created_at: "1700000000000",
  }).toValue();
  assert.equal(value.subject, "刷新「示例」");
  assert.equal(value.amount, -1);
  assert.equal(value.balance_after, 9);
  assert.equal(value.created_at, 1700000000000);
  // 老行没有 subject 列时兜底为空串，UI 会退回 note/method。
  assert.equal(
    CreditTransactionModel.fromRow({ id: "t2", amount: 1, balance_after: 1, created_at: 1 })
      .toValue().subject,
    "",
  );
});

test("CreditModel.free_for/can_spend/over_balance_limit 的口径", () => {
  // 匿名（空串 / 缺省）不计费
  assert.equal(CreditModel.free_for(""), true);
  assert.equal(CreditModel.free_for(undefined), true);
  assert.equal(CreditModel.free_for("tok"), false);
  // null 余额 = 匿名，永远够
  assert.equal(CreditModel.can_spend(null, 1), true);
  assert.equal(CreditModel.can_spend(1, 1), true);
  assert.equal(CreditModel.can_spend(0, 1), false);
  assert.equal(CreditModel.over_balance_limit(CreditModel.MAX_BALANCE), false);
  assert.equal(CreditModel.over_balance_limit(CreditModel.MAX_BALANCE + 1), true);
});

test("CreditModel.validate_adjustment 只收非零整数且 |amount| 有上限", () => {
  assert.deepEqual(CreditModel.validate_adjustment(100), { ok: true, amount: 100 });
  assert.deepEqual(CreditModel.validate_adjustment(-100), { ok: true, amount: -100 });
  assert.deepEqual(CreditModel.validate_adjustment("7"), { ok: true, amount: 7 });
  assert.equal(CreditModel.validate_adjustment(0).ok, false);
  assert.equal(CreditModel.validate_adjustment(1.5).ok, false);
  assert.equal(CreditModel.validate_adjustment(CreditModel.MAX_ADJUSTMENT + 1).ok, false);
  assert.equal(
    CreditModel.validate_adjustment(0).error.message,
    "amount must be a non-zero integer between -10000000 and 10000000",
  );
});
