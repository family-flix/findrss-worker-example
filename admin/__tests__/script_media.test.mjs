import assert from "node:assert/strict";
import test from "node:test";
import { ScriptDebugPreviewModel } from "../domain/script_preview.js";

test("剪藏预览只使用成功 Debug 的 HTML，失败结果不保留旧内容", () => {
  const output = JSON.stringify({ kind: "clip", html: "<div>快照</div>" });
  assert.equal(ScriptDebugPreviewModel({ phase: "ok", output }).html, "<div>快照</div>");
  assert.equal(ScriptDebugPreviewModel({ phase: "runtime", output }).html, "");
});

test("代码返回的 kind 优先于脚本分类和路由推断，未声明 kind 的旧图片仍兼容", () => {
  for (const kind of ["rss", "img", "video", "audio"]) {
    const result = ScriptDebugPreviewModel({ phase: "ok", output: JSON.stringify({ kind, url: "https://cdn.example/media" }) }, "rss");
    assert.equal(result.kind, kind);
    assert.equal(result.error, "");
    assert.equal(result.src, kind === "rss" ? "" : "https://cdn.example/media");
  }
  assert.equal(ScriptDebugPreviewModel({ output: '{"kind":"hot_rank"}' }, "rss").kind, "hot_rank");
  assert.equal(ScriptDebugPreviewModel({ phase: "ok", output: '{"url":"https://cdn.example/a.png"}' }, "rss").kind, "img");
});

test("媒体优先使用本次 Debug 的受保护快照，危险地址和失败结果不生成播放器地址", () => {
  const endpoint = "/admin/api/scripts/preview-assets/11111111-1111-4111-8111-111111111111";
  const debug = { phase: "ok", output: '{"kind":"video","url":"https://cdn.example/a.mp4"}',
    preview_assets: { endpoint, media_url: endpoint + "?media=1" } };
  assert.equal(ScriptDebugPreviewModel(debug).src, endpoint + "?media=1");
  for (const url of ["javascript:alert(1)", "data:image/svg+xml,bad", "https://user:secret@cdn.example/a", "file:///a"]) {
    const result = ScriptDebugPreviewModel({ ...debug, output: JSON.stringify({ kind: "img", url }) });
    assert.equal(result.src, "");
    assert.ok(result.error);
  }
  assert.equal(ScriptDebugPreviewModel({ ...debug, phase: "runtime" }).src, "");
  assert.equal(ScriptDebugPreviewModel({ phase: "ok", output: '{"kind":"audio"}' }).src, "");
});
