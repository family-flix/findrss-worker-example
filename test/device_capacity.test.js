import assert from "node:assert/strict";
import test from "node:test";

import { DeviceModel, DevicePoolModel } from "../server/domain/device_capacity.js";

test("设备并发度兼容旧客户端并限制异常值", () => {
  assert.equal(DeviceModel.normalize_concurrency(undefined), 1);
  assert.equal(DeviceModel.normalize_concurrency("8"), 8);
  assert.equal(DeviceModel.normalize_concurrency(0), 1);
  assert.equal(DeviceModel.normalize_concurrency(999), DeviceModel.MAX_CONCURRENCY);
});

test("调度选择负载率最低且仍有空槽的设备", () => {
  const devices = [
    { device_id: "a", max_concurrency: 2 },
    { device_id: "b", max_concurrency: 8 },
    { device_id: "c", max_concurrency: 4 },
  ];
  const active_counts = new Map([
    ["a", 2],
    ["b", 3],
    ["c", 2],
  ]);
  assert.equal(DevicePoolModel(devices, active_counts).pick()?.device_id, "b");
  active_counts.set("b", 8);
  assert.equal(DevicePoolModel(devices, active_counts).pick()?.device_id, "c");
  active_counts.set("c", 4);
  assert.equal(DevicePoolModel(devices, active_counts).pick(), null);
});

test("DeviceModel 保留 socket/attachment 供调度方解构，toValue 只出身份字段", () => {
  const socket = { id: "ws" };
  const attachment = { device_id: "dev-a", connection_id: "c1", methods: ["get_feed"] };
  const model = DeviceModel({ socket, attachment, device_id: "dev-a", max_concurrency: 4 });
  assert.equal(model.load(2), 0.5);
  assert.deepEqual(model.toValue(), { device_id: "dev-a", max_concurrency: 4 });

  const picked = DevicePoolModel(
    [{ socket, attachment, device_id: "dev-a", max_concurrency: "4" }],
    new Map(),
  ).pick();
  assert.equal(picked.socket, socket);
  assert.equal(picked.attachment, attachment);
  assert.equal(picked.max_concurrency, 4);
});

test("DeviceModel.parse_methods 只留字符串项，坏 JSON 与非数组回空数组", () => {
  assert.deepEqual(DeviceModel.parse_methods('["a","b"]'), ["a", "b"]);
  assert.deepEqual(DeviceModel.parse_methods('["a",1,null,{"b":1},"c"]'), ["a", "c"]);
  assert.deepEqual(DeviceModel.parse_methods("[]"), []);
  assert.deepEqual(DeviceModel.parse_methods('{"a":1}'), []);
  assert.deepEqual(DeviceModel.parse_methods("not json"), []);
  assert.deepEqual(DeviceModel.parse_methods(""), []);
});

test("DeviceModel.supports 同时吃 JSON 串与已解析数组", () => {
  assert.equal(DeviceModel.supports('["get_feed","ping"]', "ping"), true);
  assert.equal(DeviceModel.supports('["get_feed"]', "ping"), false);
  assert.equal(DeviceModel.supports(["get_feed"], "get_feed"), true);
  assert.equal(DeviceModel.supports([], "get_feed"), false);
  assert.equal(DeviceModel.supports("not json", "get_feed"), false);
});

test("DeviceModel.is_disabled 只认 1，truncate_name 去空白、截断并兜底", () => {
  assert.equal(DeviceModel.is_disabled({ disabled: 1 }), true);
  assert.equal(DeviceModel.is_disabled({ disabled: 0 }), false);
  assert.equal(DeviceModel.is_disabled(null), false);
  assert.equal(DeviceModel.truncate_name("  dev-a  ", "fb"), "dev-a");
  assert.equal(DeviceModel.truncate_name("", "fb"), "fb");
  assert.equal(
    DeviceModel.truncate_name("x".repeat(DeviceModel.NAME_MAX_LENGTH + 5), "fb").length,
    DeviceModel.NAME_MAX_LENGTH,
  );
});

test("DevicePoolModel.available_slots 汇总每台设备的余量，负余量按 0", () => {
  const attachments = [
    { device_id: "a", max_concurrency: 4 },
    { device_id: "b", max_concurrency: 2 },
  ];
  const active_counts = new Map([["a", 1], ["b", 5]]);
  assert.equal(DevicePoolModel.available_slots(attachments, active_counts), 3);
  assert.equal(DevicePoolModel.available_slots([], active_counts), 0);
  assert.equal(DevicePoolModel.available_slots(null, new Map()), 0);
});
