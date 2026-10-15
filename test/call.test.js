import assert from "node:assert/strict";
import test from "node:test";

import { CallModel } from "../server/domain/call.js";

const value_of = (row) => CallModel.fromRow(row).toValue();

test("CallModel 同时给出早期协议别名与规范字段名", () => {
  const value = value_of({
    id: "call-1",
    method: "get_feed",
    credit_cost: 1,
    publisher_device_id: "dev-a",
    target_device_id: "dev-b",
    idempotency_key: "key-1",
    args_json: '{"url":"https://example.com"}',
    status: "completed",
    assigned_device_id: "dev-b",
    lease_expires_at: null,
    attempt_count: 1,
    result_json: '{"ok":true}',
    error_message: null,
    created_at: 1,
    updated_at: 2,
    completed_at: 2,
  });
  assert.equal(value.kind, "get_feed");
  assert.deepEqual(value.args, { url: "https://example.com" });
  assert.deepEqual(value.payload, value.args);
  assert.equal(value.publisher_id, value.publisher_device_id);
  assert.equal(value.target_client_id, value.target_device_id);
  assert.equal(value.assigned_client_id, value.assigned_device_id);
  assert.deepEqual(value.result, { ok: true });
  assert.equal(value.error, null);
});

test("CallModel 在 result_json 为 null 时给 null，args_json 仍照常解析", () => {
  const value = value_of({
    id: "call-2",
    method: "ping",
    credit_cost: 0,
    publisher_device_id: "dev-a",
    target_device_id: "dev-b",
    idempotency_key: "",
    args_json: "{}",
    status: "queued",
    assigned_device_id: null,
    lease_expires_at: null,
    attempt_count: 0,
    result_json: null,
    error_message: null,
    created_at: 1,
    updated_at: 1,
    completed_at: null,
  });
  assert.equal(value.result, null);
  assert.deepEqual(value.args, {});
});

test("CallModel 的租约、重试与错误截断", () => {
  const row = { args_json: "{}", result_json: null, lease_expires_at: 1000, attempt_count: 2 };
  assert.equal(CallModel.lease_deadline(500), 500 + CallModel.LEASE_MS);
  assert.equal(CallModel.fromRow(row).is_expired(1000), true);
  assert.equal(CallModel.fromRow(row).is_expired(999), false);
  assert.equal(CallModel.fromRow(row).attempts_exhausted(), false);
  assert.equal(
    CallModel.fromRow({ args_json: "{}", result_json: null, attempt_count: CallModel.MAX_ATTEMPTS })
      .attempts_exhausted(),
    true,
  );
  // 只有显式 retryable 且还有次数才重排
  assert.equal(CallModel.is_retryable({ retryable: true }, row), true);
  assert.equal(CallModel.is_retryable({ retryable: false }, row), false);
  assert.equal(CallModel.is_retryable({ retryable: true }, { attempt_count: CallModel.MAX_ATTEMPTS }), false);
  assert.equal(CallModel.truncate_error(null), "task failed");
  assert.equal(CallModel.truncate_error("boom"), "boom");
  assert.equal(CallModel.truncate_error("x".repeat(CallModel.ERROR_MAX_LENGTH + 10)).length, CallModel.ERROR_MAX_LENGTH);
});

test("CallModel.owned_by 只认租约匹配的 assigned/running 行", () => {
  const row = { status: "running", assigned_device_id: "dev-a", lease_token: "L1" };
  assert.equal(CallModel.owned_by(row, "dev-a", "L1"), true);
  assert.equal(CallModel.owned_by(row, "dev-b", "L1"), false);
  assert.equal(CallModel.owned_by(row, "dev-a", "L2"), false);
  assert.equal(CallModel.owned_by({ ...row, status: "completed" }, "dev-a", "L1"), false);
  assert.equal(CallModel.owned_by(null, "dev-a", "L1"), false);
});
