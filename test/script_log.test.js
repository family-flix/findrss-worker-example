import assert from "node:assert/strict";
import test from "node:test";

import { ScriptLogModel, ScriptLogQueryModel } from "../server/domain/script_log.js";

/** @param {string} search */
function normalize(search) {
  return ScriptLogQueryModel.fromQuery(
    new URL("https://internal/_admin/scripts/logs" + search),
  );
}

/** 取成功结果的 model，失败时抛错（测试里只想要值）。 */
function normalized(search) {
  const result = normalize(search);
  assert.equal(result.ok, true, "期望归一化成功");
  return result.model;
}

test("ScriptLogQueryModel.fromQuery 要求 route 非空且不过长", () => {
  assert.deepEqual(normalize("").error, { status: 400, message: "route 不能为空" });
  assert.deepEqual(normalize("?route=").error, { status: 400, message: "route 不能为空" });
  assert.deepEqual(normalize("?route=%20%20").error, { status: 400, message: "route 不能为空" });
  assert.deepEqual(
    normalize("?route=" + "a".repeat(129)).error,
    { status: 400, message: "route 过长" },
  );
  const ok = normalized("?route=" + "a".repeat(128));
  assert.equal(ok.route, "a".repeat(128));
  assert.ok(Object.isFrozen(ok), "model 必须是冻结对象");
});

test("ScriptLogQueryModel.fromQuery 夹紧 limit 并在非法时回退默认值", () => {
  assert.equal(normalized("?route=r").limit, ScriptLogQueryModel.DEFAULT_LIMIT);
  assert.equal(normalized("?route=r&limit=10").limit, 10);
  assert.equal(normalized("?route=r&limit=0").limit, 1);
  assert.equal(normalized("?route=r&limit=-5").limit, 1);
  assert.equal(normalized("?route=r&limit=99999").limit, ScriptLogQueryModel.MAX_LIMIT);
  assert.equal(normalized("?route=r&limit=12.9").limit, 12);
  assert.equal(normalized("?route=r&limit=abc").limit, ScriptLogQueryModel.DEFAULT_LIMIT);
  assert.equal(ScriptLogQueryModel.DEFAULT_LIMIT, 50);
  assert.equal(ScriptLogQueryModel.MAX_LIMIT, 200);
});

test("ScriptLogQueryModel.fromQuery 只接受正整数 before_id", () => {
  assert.equal(normalized("?route=r").before_id, null);
  assert.equal(normalized("?route=r&before_id=").before_id, null);
  assert.equal(normalized("?route=r&before_id=12").before_id, 12);
  assert.deepEqual(
    normalize("?route=r&before_id=0").error,
    { status: 400, message: "invalid before_id" },
  );
  assert.deepEqual(
    normalize("?route=r&before_id=-1").error,
    { status: 400, message: "invalid before_id" },
  );
  assert.deepEqual(
    normalize("?route=r&before_id=abc").error,
    { status: 400, message: "invalid before_id" },
  );
  assert.deepEqual(
    normalize("?route=r&before_id=1.5").error,
    { status: 400, message: "invalid before_id" },
  );
});

test("ScriptLogQueryModel 的 toValue 与状态字段一致且不带方法", () => {
  const model = ScriptLogQueryModel({ route: "r", limit: 10, before_id: 3 });
  assert.deepEqual(model.toValue(), { route: "r", limit: 10, before_id: 3 });
  assert.equal("toValue" in model.toValue(), false);
});

test("ScriptLogModel.fromRow 反序列化并归一化各字段", () => {
  assert.deepEqual(
    ScriptLogModel.fromRow({
      id: 7,
      route: "route-1",
      path: "/wxmp/:account?",
      source: "request",
      method: "GET",
      pathname: "/rss/wxmp/wow36kr",
      params_json: '{"account":"wow36kr"}',
      query_json: '{"offset":"next"}',
      status: "error",
      phase: "runtime",
      level: "error",
      message: "脚本执行失败：boom",
      error_text: "脚本执行失败：boom\n at handler (script.js:8:3)",
      lines_json: '[{"level":"info","text":"params"}]',
      elapsed_ms: 42,
      invoked: 1,
      device_id: null,
      created_at: 1700000000000,
    }).toValue(),
    {
      id: 7,
      route: "route-1",
      path: "/wxmp/:account?",
      source: "request",
      method: "GET",
      pathname: "/rss/wxmp/wow36kr",
      params: { account: "wow36kr" },
      query: { offset: "next" },
      status: "error",
      phase: "runtime",
      level: "error",
      message: "脚本执行失败：boom",
      error_text: "脚本执行失败：boom\n at handler (script.js:8:3)",
      lines: [{ level: "info", text: "params" }],
      elapsed_ms: 42,
      invoked: true,
      device_id: null,
      created_at: 1700000000000,
    },
  );
});

test("ScriptLogModel.fromRow 对坏 JSON 与缺失字段降级但不抛错", () => {
  const value = ScriptLogModel.fromRow({
    id: "3",
    params_json: "{不是 JSON",
    query_json: '["数组不是对象"]',
    lines_json: '{"对象不是数组":true}',
  }).toValue();
  assert.deepEqual(value.params, {});
  assert.deepEqual(value.query, {});
  assert.deepEqual(value.lines, []);
  assert.equal(value.id, 3);
  assert.equal(value.route, "");
  assert.equal(value.path, "");
  assert.equal(value.source, "");
  assert.equal(value.error_text, "");
  assert.equal(value.elapsed_ms, 0);
  assert.equal(value.invoked, false);
  assert.equal(value.device_id, null);

  const missing = ScriptLogModel.fromRow({}).toValue();
  assert.equal(missing.status, "");
  assert.equal(missing.created_at, 0);
  assert.deepEqual(missing.params, {});
});

test("ScriptLogModel.fromRow 的 device_id 保留字符串", () => {
  assert.equal(
    ScriptLogModel.fromRow({ device_id: "device-1" }).toValue().device_id,
    "device-1",
  );
});

test("ScriptLogModel 归一来源与相位，不认识的回落默认值", () => {
  assert.equal(ScriptLogModel.normalize_source("test"), "test");
  assert.equal(ScriptLogModel.normalize_source("save"), "save");
  assert.equal(ScriptLogModel.normalize_source("request"), "request");
  assert.equal(ScriptLogModel.normalize_source("nope"), "request");
  assert.equal(ScriptLogModel.normalize_source(undefined), "request");
  assert.equal(ScriptLogModel.normalize_phase("invoke"), "invoke");
  assert.equal(ScriptLogModel.normalize_phase("output"), "output");
  assert.equal(ScriptLogModel.normalize_phase("nope"), "runtime");
  assert.equal(ScriptLogModel.normalize_phase(undefined), "runtime");
});

test("ScriptLogModel 的错误与消息截断到各自列宽", () => {
  assert.equal(
    ScriptLogModel.truncate_error("x".repeat(20_000)).length,
    8 * 1024,
  );
  assert.equal(ScriptLogModel.truncate_error(null), "");
  assert.equal(
    ScriptLogModel.truncate_message("x".repeat(20_000)).length,
    2000,
  );
  assert.equal(ScriptLogModel.truncate_message(undefined), "");
});
