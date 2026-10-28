import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { render_script_sources } from "../scripts/sync_hot_scripts.js";
import { script_sources } from "../server/infra/builtin_script_sources.js";

test("脚本快照可重复生成，保留全部原文且 Hot 版本只随 Hot 源码改变", async () => {
  const entries = [["rss/apple.js", "苹果\n\"引号\""], ["clip/website.js", "剪藏"], ["hot/b.js", "第二"], ["hot/a.js", "第一"]];
  const source = render_script_sources(entries);
  assert.equal(render_script_sources([...entries].reverse()), source);
  const result = await import("data:text/javascript;base64," + Buffer.from(source).toString("base64"));
  assert.deepEqual({ ...result.script_sources }, Object.fromEntries(entries));
  assert.equal(result.apple_script, entries[0][1]);
  assert.equal(result.clip_script_source, entries[1][1]);
  assert.deepEqual(result.hot_scripts, [{ id: "a", source: "第一" }, { id: "b", source: "第二" }]);
  const version = createHash("sha256").update("a.js第一\nb.js第二").digest("hex").slice(0, 16);
  assert.equal(result.HOT_SCRIPTS_VERSION, version);
  assert.ok(render_script_sources(entries.map(([path, value]) => [path, path === "rss/apple.js" ? "更新" : value])).includes(`HOT_SCRIPTS_VERSION = "${version}"`));
  assert.ok(!render_script_sources(entries.map(([path, value]) => [path, path === "hot/a.js" ? "更新" : value])).includes(`HOT_SCRIPTS_VERSION = "${version}"`));
});

test("缺少默认脚本时拒绝生成，已提交快照能从全部脚本原文完整重建", () => {
  assert.throws(() => render_script_sources([]), /rss\/apple.js/);
  assert.throws(() => render_script_sources([["rss/apple.js", ""]]), /clip\/website.js/);
  const expected = render_script_sources(Object.entries(script_sources));
  assert.equal(readFileSync(new URL("../server/infra/builtin_script_sources.js", import.meta.url), "utf8"), expected);
  assert.equal(Object.keys(script_sources).length, 106);
});
