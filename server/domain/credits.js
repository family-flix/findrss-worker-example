// 积分域：调用计价（CreditModel）与账本行（CreditTransactionModel）。
//
// 计价集中在 `CreditModel.cost_for` 一处，便于将来按 method 定价而不动账本与任务表。
// 金额只存在账本一处（单一事实来源），user_events 只记非金额事件。
//
// 纯模块，可在 node --test 下直接覆盖。

import {
  DEFAULT_CALL_CREDIT_COST,
  MAX_CREDIT_ADJUSTMENT,
  MAX_CREDIT_BALANCE,
} from "../lib/constants.js";

/**
 * 计价与余额响应头。无状态：`cost_for`/`headers` 挂在工厂上，实例方法只是同一份行为的
 * 具名入口。
 */
export function CreditModel() {
  const state = Object.freeze({ default_cost: CreditModel.DEFAULT_COST });
  return Object.freeze({
    ...state,
    cost_for: CreditModel.cost_for,
    headers: CreditModel.headers,
    toValue: () => ({ default_cost: state.default_cost }),
  });
}

CreditModel.DEFAULT_COST = DEFAULT_CALL_CREDIT_COST;
/**
 * Keep pricing in one place so method-specific costs can be introduced without
 * changing the accounting or task schema.
 * @param {string} method
 * @returns {number}
 */
CreditModel.cost_for = (method) => {
  void method;
  return CreditModel.DEFAULT_COST;
};
/**
 * @param {number | null} balance
 * @returns {Record<string, string>}
 */
CreditModel.headers = (balance) => (balance === null
  ? {}
  : { "X-Api-Credit-Balance": String(balance) });
/** 余额上限。 */
CreditModel.MAX_BALANCE = MAX_CREDIT_BALANCE;
/** 单次调整幅度上限。 */
CreditModel.MAX_ADJUSTMENT = MAX_CREDIT_ADJUSTMENT;
CreditModel.of = CreditModel;
/**
 * 匿名调用（没有 access_token）不计费。空串即匿名。
 * @param {unknown} access_token_id
 * @returns {boolean}
 */
CreditModel.free_for = (access_token_id) => String(access_token_id ?? "") === "";
/**
 * 余额是否够付这次调用。`null` 余额表示匿名调用，永远够。
 * @param {number | null} balance
 * @param {number} cost
 * @returns {boolean}
 */
CreditModel.can_spend = (balance, cost) => balance === null || Number(balance) >= Number(cost);
/**
 * 余额是否越过上限。
 * @param {unknown} balance
 * @returns {boolean}
 */
CreditModel.over_balance_limit = (balance) => Number(balance) > MAX_CREDIT_BALANCE;
/**
 * 校验管理端调整额度：非零整数且绝对值不超过上限。错误文案逐字不变。
 * @param {unknown} value
 * @returns {{ ok: true, amount: number }
 *   | { ok: false, error: { status: number, message: string } }}
 */
CreditModel.validate_adjustment = (value) => {
  const amount = Number(value);
  if (
    !Number.isInteger(amount) ||
    amount === 0 ||
    Math.abs(amount) > MAX_CREDIT_ADJUSTMENT
  ) {
    return {
      ok: false,
      error: {
        status: 400,
        message: "amount must be a non-zero integer between -10000000 and 10000000",
      },
    };
  }
  return { ok: true, amount };
};

/**
 * 账本行的对外形状：`subject` 是行为标签，缺失时前端按 `method`/`note` 兜底。
 * @param {Record<string, unknown>} [row]
 */
export function CreditTransactionModel(row) {
  const source = row ?? {};
  const state = Object.freeze({
    id: source.id,
    access_token_id: source.access_token_id,
    task_id: source.task_id,
    type: source.type,
    amount: Number(source.amount),
    balance_after: Number(source.balance_after),
    method: source.method,
    subject: String(source.subject ?? ""),
    note: source.note,
    created_at: Number(source.created_at),
  });
  return Object.freeze({
    ...state,
    toValue: () => ({
      id: state.id,
      access_token_id: state.access_token_id,
      task_id: state.task_id,
      type: state.type,
      amount: state.amount,
      balance_after: state.balance_after,
      method: state.method,
      subject: state.subject,
      note: state.note,
      created_at: state.created_at,
    }),
  });
}

CreditTransactionModel.of = CreditTransactionModel;
/** 从 SQLite 行构造。 */
CreditTransactionModel.fromRow = (row) => CreditTransactionModel(row);
