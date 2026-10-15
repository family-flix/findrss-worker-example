import assert from "node:assert/strict";
import test from "node:test";

import { DeviceLogModel } from "../server/domain/device_log.js";

const base = {
  id: 7,
  device_id: "dev-a",
  connection_id: "conn-1",
  category: "call",
  event_type: "invoke",
  direction: "inbound",
  level: "info",
  task_id: "call-1",
  method: "get_feed",
  message: "msg",
  created_at: 100,
};

test("DeviceLogModel 坏 metadata_json 降级成可解释的错误对象", () => {
  assert.deepEqual(
    DeviceLogModel.fromRow({ ...base, metadata_json: '{"a":1}' }).toValue(),
    { ...base, metadata: { a: 1 } },
  );
  assert.deepEqual(
    DeviceLogModel.fromRow({ ...base, metadata_json: "broken" }).toValue().metadata,
    { serialization_error: "invalid stored metadata" },
  );
  // id 一律走 Number，SQLite 的 INTEGER 可能以字符串形态取回
  assert.equal(DeviceLogModel.fromRow({ ...base, id: "7", metadata_json: "{}" }).toValue().id, 7);
});

test("DeviceLogModel.normalize 把不认识的取值回落到 system/internal/info", () => {
  assert.deepEqual(DeviceLogModel.normalize({ category: "call", direction: "inbound", level: "warn" }), {
    category: "call",
    direction: "inbound",
    level: "warn",
  });
  assert.deepEqual(DeviceLogModel.normalize({ category: "nope", direction: "", level: "huge" }), {
    category: "system",
    direction: "internal",
    level: "info",
  });
  assert.deepEqual(DeviceLogModel.normalize(), { category: "system", direction: "internal", level: "info" });
});

test("DeviceLogModel 的截断与每页条数归一", () => {
  assert.equal(DeviceLogModel.truncate_message("", "invoke"), "invoke");
  assert.equal(DeviceLogModel.truncate_message(null, null), "设备事件");
  assert.equal(
    DeviceLogModel.truncate_message("x".repeat(DeviceLogModel.MESSAGE_MAX_LENGTH + 5), "e").length,
    DeviceLogModel.MESSAGE_MAX_LENGTH,
  );
  assert.equal(DeviceLogModel.truncate_event_type(""), "system.event");
  assert.equal(DeviceLogModel.clamp_limit(undefined), DeviceLogModel.DEFAULT_LIMIT);
  assert.equal(DeviceLogModel.clamp_limit(10), 10);
  assert.equal(DeviceLogModel.clamp_limit(0), 1);
  assert.equal(DeviceLogModel.clamp_limit(99999), DeviceLogModel.MAX_LIMIT);
  assert.equal(DeviceLogModel.clamp_limit("abc"), DeviceLogModel.DEFAULT_LIMIT);
});
