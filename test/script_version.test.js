import assert from "node:assert/strict";
import test from "node:test";
import { ScriptVersionModel } from "../server/domain/script_version.js";

test("版本号只接受无前导零的三段数字，正式发布必填，比较按数字而非字典序", () => {
  assert.equal(ScriptVersionModel.parse(undefined).ok, true);
  assert.equal(ScriptVersionModel.parse("", { required: true }).ok, false);
  for (const value of [null, 1, [], "1", "1.0", "1.0.0.0", "v1.0.0", "01.0.0", "1.00.0", "1.0.0-beta", "1.0.0+build", "-1.0.0", "1.0.0\n2.0.0"]) {
    assert.equal(ScriptVersionModel.parse(value).ok, false, JSON.stringify(value));
  }
  for (const [current, previous, result] of [
    ["1.0.0", "", true], ["1.0.0", "1.0.0", false], ["1.0.1", "1.0.0", true],
    ["1.10.0", "1.9.99", true], ["2.0.0", "1.99.99", true], ["0.9.9", "1.0.0", false],
    ["9007199254740993.0.0", "9007199254740992.9.9", true],
  ]) assert.equal(ScriptVersionModel.parse(current).model.is_after(previous), result);
});
