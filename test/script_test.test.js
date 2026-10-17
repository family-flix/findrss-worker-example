import assert from "node:assert/strict";
import test from "node:test";

import { ScriptTestRequestModel } from "../server/domain/script_test.js";

/** @param {unknown} body */
function error_of(body) {
  const result = ScriptTestRequestModel.fromBody(body);
  assert.equal(result.ok, false, "期望归一化失败");
  return result.error;
}

/** @param {unknown} body */
function value_of(body) {
  const result = ScriptTestRequestModel.fromBody(body);
  assert.equal(result.ok, true, "期望归一化成功");
  return result.model.toValue();
}

test("ScriptTestRequestModel.fromBody 拒绝非法请求体", () => {
  assert.deepEqual(error_of(null), { status: 400, message: "请求体必须是 JSON 对象" });
  assert.deepEqual(error_of([]), { status: 400, message: "请求体必须是 JSON 对象" });
  assert.deepEqual(error_of("nope"), { status: 400, message: "请求体必须是 JSON 对象" });
  assert.deepEqual(error_of({}), { status: 400, message: "script 必须是字符串" });
  assert.deepEqual(error_of({ script: 42 }), { status: 400, message: "script 必须是字符串" });
  assert.deepEqual(error_of({ script: "   " }), { status: 400, message: "script 不能为空" });
  assert.deepEqual(
    error_of({ script: "a".repeat(10 * 1024 * 1024 + 1) }),
    { status: 400, message: "script 超过 10MB 限制" },
  );
  assert.deepEqual(
    error_of({ script: "x", mock_ctx: 1 }),
    { status: 400, message: "mock_ctx 必须是字符串" },
  );
  assert.deepEqual(
    error_of({ script: "x", mock_ctx: "a".repeat(ScriptTestRequestModel.MOCK_MAX_BYTES + 1) }),
    { status: 400, message: "mock_ctx 超过 64KB 限制" },
  );
});

test("ScriptTestRequestModel.fromBody 接受合法请求体", () => {
  assert.deepEqual(value_of({ script: "export const route = {}" }), {
    script: "export const route = {}",
    mock_ctx: "",
    route: "",
  });
  assert.deepEqual(value_of({ script: "x", mock_ctx: "({})" }), {
    script: "x",
    mock_ctx: "({})",
    route: "",
  });
});

test("调试接受 10MB 边界源码，按 UTF-8 字节拒绝超限内容", () => {
  const script = "x".repeat(10 * 1024 * 1024);
  assert.equal(value_of({ script }).script, script);
  assert.deepEqual(error_of({ script: "中".repeat(Math.ceil(script.length / 3)) }),
    { status: 400, message: "script 超过 10MB 限制" });
});

test("ScriptTestRequestModel.fromBody 的 route 可选但必须是短字符串", () => {
  assert.equal(value_of({ script: "x", route: " 3f0c-1 " }).route, "3f0c-1");
  assert.deepEqual(
    error_of({ script: "x", route: 7 }),
    { status: 400, message: "route 必须是字符串" },
  );
  assert.deepEqual(
    error_of({ script: "x", route: "a".repeat(129) }),
    { status: 400, message: "route 过长" },
  );
});

test("ScriptTestRequestModel 的常量与冻结形状", () => {
  assert.equal(ScriptTestRequestModel.MAX_SCRIPT_BYTES, 10 * 1024 * 1024);
  assert.equal(ScriptTestRequestModel.MOCK_MAX_BYTES, 64 * 1024);
  const model = ScriptTestRequestModel({ script: "x" });
  assert.ok(Object.isFrozen(model));
  assert.equal("toValue" in model.toValue(), false);
});
