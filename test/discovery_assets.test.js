import assert from "node:assert/strict";
import test from "node:test";
import { lazy_catalog_avatars } from "../server/infra/discovery_assets.js";
import { safe_avatar_url } from "../server/lib/discovery_sources.js";

test("头像目录保留轻量 URL，API 绝对地址和旧内嵌头像归一为同源接口", () => {
  const catalog = { sources: [
    { id: "a", avatar_url: "http://127.0.0.1:1234/api/avatar/a?v=1" },
    { id: "b", avatar_url: "/api/avatar/b?v=2" },
    { id: "c", avatar_url: "data:image/png;base64,YQ==", updated_at: 3 },
    { id: "d", avatar_url: "https://api.example/discovery/avatars/d?v=4" },
    { id: "e", avatar_url: "https://images.example/avatar.png" },
  ], tags: ["文章"] };
  const result = lazy_catalog_avatars(catalog);
  assert.deepEqual(result.sources.map(source => source.avatar_url), [
    "/api/avatar/a?v=1", "/api/avatar/b?v=2", "/api/avatar/c?v=3", "/api/avatar/d?v=4", "https://images.example/avatar.png",
  ]);
  assert.match(catalog.sources[0].avatar_url, /^http:/);
  assert.match(catalog.sources[2].avatar_url, /^data:/);
  assert.deepEqual(result.tags, catalog.tags);
  assert.deepEqual(lazy_catalog_avatars(result), result);
});

test("拒绝 data URL、非 HTTPS 外链和危险地址，空头像保留首字占位", () => {
  for (const value of ["data:image/png;base64,YQ==", "data:text/html;base64,YQ==", "http://images.example/a.png", "javascript:alert(1)", "//evil.test/a", "/\\evil.test/a", "https://user:pass@example.com/a", ""]) {
    assert.equal(safe_avatar_url(value), "", value);
  }
  assert.equal(lazy_catalog_avatars({ sources: [{ avatar_url: "data:image/png;base64,YQ==" }] }).sources[0].avatar_url, "");
});
