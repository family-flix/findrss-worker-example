import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";
import { compare_detect_snapshots, normalize_detect_snapshot, normalize_detect_result, normalize_detect_previous } from "../server/lib/detect.js";

const content = value => ({ body: { type: "content", value } });
const list = (ids, extra = {}) => ({ posts: { type: "list", coverage: "complete", ordered: true,
  items: ids.map(id => ({ id, data: { title: id } })), ...extra } });
const result = (snapshot, previous = null) => ({ kind: "detect", schema_version: 1, title: "检测", link: "https://example.com/", snapshot, ...compare_detect_snapshots(previous, snapshot) });

test("首次检测只建基线，键序和无序列表顺序不造成变化，正文空字符串是真实内容", () => {
  assert.equal(compare_detect_snapshots(null, content("正文")).status, "initialized");
  assert.equal(compare_detect_snapshots(content("正文"), content("正文")).status, "unchanged");
  const compared = compare_detect_snapshots(content("正文"), content(""));
  assert.deepEqual(compared.changes, [{ type: "content.updated", target: "body", before: "正文", after: "" }]);
  assert.equal(compare_detect_snapshots(list(["a", "b"], { ordered: false }), list(["b", "a"], { ordered: false })).status, "unchanged");
  assert.equal(compare_detect_snapshots({ fields: { type: "record", value: { a: 1, b: null } } }, { fields: { type: "record", value: { b: null, a: 1 } } }).status, "unchanged");
});

test("字段区分缺失与 null，递归对象并转义 JSON Pointer，数组按整体值比较", () => {
  const before = { record: { type: "record", value: { removed: null, updated: { "a/b~c": 1 }, array: [1, 2] } } };
  const after = { record: { type: "record", value: { added: null, updated: { "a/b~c": 2 }, array: [2, 1] } } };
  const changes = compare_detect_snapshots(before, after).changes;
  assert.deepEqual(changes.map(change => [change.type, change.path]), [
    ["field.added", "/added"], ["field.updated", "/array"], ["field.removed", "/removed"], ["field.updated", "/updated/a~1b~0c"],
  ]);
  assert.equal(Object.hasOwn(changes[0], "before"), false);
  assert.equal(changes[0].after, null);
});

test("列表按稳定 ID 匹配新增、删除和更新，插入及删除造成的下标偏移不算移动", () => {
  const before = list(["a", "b", "c"]), after = list(["x", "a", "c"]);
  after.posts.items[2].data.title = "修订";
  const changes = compare_detect_snapshots(before, after).changes;
  assert.deepEqual(changes.map(change => [change.type, change.item_id]), [["list.item_removed", "b"], ["list.item_added", "x"], ["list.item_updated", "c"]]);
  assert.deepEqual(changes[2].fields, [{ op: "replace", path: "/title", before: "c", after: "修订" }]);
  const reordered = compare_detect_snapshots(list(["a", "b", "c"]), list(["c", "a", "b"]));
  assert.deepEqual(reordered.changes, [{ type: "list.item_moved", target: "posts", item_id: "c", from: 2, to: 0, before_previous_id: "b", after_previous_id: null }]);
  const relative = compare_detect_snapshots(list(["a", "b", "c", "d"]), list(["d", "b", "a", "c"])).changes;
  const same_index = relative.find(change => change.from === change.to);
  assert.ok(same_index && same_index.before_previous_id !== same_index.after_previous_id);
});

test("窗口列表只报告进入和离开；部分采集、范围或结构变化不能推断删除", () => {
  const window = ids => list(ids, { coverage: "window", scope: "latest-20" });
  assert.deepEqual(compare_detect_snapshots(window(["a", "b"]), window(["x", "a"])).changes.map(change => change.type), ["list.item_left", "list.item_entered"]);
  for (const current of [list([], { coverage: "partial" }), list([], { ordered: false }), { other: { type: "content", value: "x" } }]) {
    const value = compare_detect_snapshots(list(["a"]), current);
    assert.equal(value.status, "inconclusive"); assert.deepEqual(value.changes, []); assert.ok(value.issues.length);
  }
  assert.throws(() => normalize_detect_previous(list([], { coverage: "partial" })), /完整/);
  const uncertain = compare_detect_snapshots(content("正文"), { body: { type: "content", present: false, incomplete: true, reason: "没有完整读取页面" } });
  assert.equal(uncertain.status, "inconclusive"); assert.deepEqual(uncertain.changes, []);
  assert.throws(() => normalize_detect_snapshot({ posts: { type: "list", present: false, coverage: "partial" } }), /不能确认为不存在/);
});

test("业务对象显式出现和消失；缺少对象不等同于消失", () => {
  const absent = { body: { type: "content", present: false } };
  assert.equal(compare_detect_snapshots(content("正文"), absent).changes[0].type, "target.disappeared");
  assert.equal(compare_detect_snapshots(absent, content("正文")).changes[0].type, "target.appeared");
  assert.throws(() => normalize_detect_snapshot({}));
});

test("快照拒绝重复 ID、不完整类型、过大/过深数据与不安全数字", () => {
  for (const invalid of [list(["a", "a"]), list(["a"], { coverage: "window" }), { body: { type: "content", value: "x".repeat(1024 * 1024) } },
    { r: { type: "record", value: { number: Number.MAX_SAFE_INTEGER + 1 } } }, { r: { type: "record", value: JSON.parse('{"__proto__":1}') } }]) assert.throws(() => normalize_detect_snapshot(invalid));
  let value = {}; for (let i = 0; i < 24; i++) value = { value };
  assert.throws(() => normalize_detect_snapshot({ r: { type: "record", value } }), /嵌套/);
});

test("宿主允许筛选标准事件、核对前后值与规则引用，并阻止伪造变化", () => {
  const before = content("旧"), current = content("新"), value = result(current, before);
  assert.equal(normalize_detect_result(value, before).status, "changed");
  assert.equal(normalize_detect_result({ ...value, status: "unchanged", changes: [] }, before).status, "unchanged");
  assert.throws(() => normalize_detect_result({ ...value, changes: [{ ...value.changes[0], before: "伪造" }] }, before), /快照不符/);
  assert.throws(() => normalize_detect_result({ ...value, status: "unchanged" }, before), /状态/);
  assert.throws(() => normalize_detect_result({ ...value, matches: [{ id: "rule", label: "命中", change_indexes: [99] }] }, before), /不存在/);
  assert.throws(() => normalize_detect_result({ ...value, link: "https://user:password@example.com/" }, before), /无凭据/);
  const uncertain = normalize_detect_result({ ...value, status: "inconclusive", changes: [], issues: [{ target: "body", reason: "业务规则暂时无法判定" }] }, before);
  assert.equal(uncertain.status, "inconclusive"); assert.equal(uncertain.issues[0].reason, "业务规则暂时无法判定");
  assert.throws(() => normalize_detect_result({ ...value, status: "inconclusive", issues: [{ reason: "不确定" }] }, before), /不能返回变化/);
  assert.throws(() => normalize_detect_previous(uncertain), /成功可靠/);
});

register("./support/quickjs_wasm_hook.js", import.meta.url);
const { compile_script_module, execute_script } = await import("../server/infra/script_sandbox.js");
const script = `export const kind='detect'; export const version='1.0.0'; export const platform={name:'测试'};
class Test extends DetectScript {
  async fetch(ctx) { return Result.Ok(ctx.query.text); }
  async normalize(data,ctx) { return Result.Ok({title:'正文检测',link:'https://example.com/',snapshot:{body:{type:'content',value:data}}}); }
}
const script=new Test(); export const route={path:'/detect-test',name:'检测',example:'/detect-test',handler:ctx=>script.run(ctx)};`;

test("生产 QuickJS 中脚本完成抓取、归一化和比较，注入的旧快照不可修改", async () => {
  const compiled = await compile_script_module(script); assert.equal(compiled.error, "");
  const run = async previous => JSON.parse((await execute_script(script, compiled.metadata, null,
    { method: "GET", pathname: "/detect-test", params: {}, query: { text: "新" }, previous })).output);
  assert.equal((await run(null)).status, "initialized");
  const changed = await run({ id: "baseline", snapshot: content("旧") });
  assert.equal(changed.status, "changed"); assert.equal(changed.previous_id, "baseline"); assert.equal(changed.changes[0].before, "旧");
  const malicious = script.replace("return Result.Ok(ctx.query.text);", "ctx.previous.snapshot.body.value='篡改'; return Result.Ok(ctx.query.text);");
  await assert.rejects(execute_script(malicious, compiled.metadata, null, { method: "GET", pathname: "/detect-test", params: {}, query: { text: "新" }, previous: { snapshot: content("旧") } }), /read.only|只读|readonly|not writable/i);
  const invalid = script.replace("type:'content',value:data", "type:'record',value:{number:NaN}");
  await assert.rejects(execute_script(invalid, compiled.metadata, null, { method: "GET", pathname: "/detect-test", params: {}, query: { text: "新" } }), /数值必须有限/);
});
