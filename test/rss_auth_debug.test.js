import assert from "node:assert/strict";
import test from "node:test";
import { public_rss_route } from "../server/service/worker/rss.js";

test("Worker 诊断记录三种凭证来源和校验状态，原凭证不转发给脚本", async () => {
  for (const [query, headers, source, expected, verified] of [
    ["", {}, "", "missing", false],
    ["?token=short", {}, "query", "invalid_format", false],
    ["?token=api_fixture_credential", {}, "query", "rejected", false],
    ["", { Authorization: "Bearer api_fixture_credential" }, "bearer", "accepted", true],
    ["", { "X-FindRSS-Token": "api_fixture_credential" }, "header", "accepted", true],
  ]) {
    let forwarded;
    const env = { API: { getByName: () => ({ fetch: async input => {
      if (typeof input === "string") return Response.json({ access_token: { id: "account-1" } }, { status: verified ? 200 : 401 });
      forwarded = input;
      return Response.json({});
    } }) } };
    const request = new Request("https://api.example/rss/weibo/123" + query, { headers: {
      ...headers, Cookie: "private-session=browser-secret", "X-RSS-Credential-Status": "accepted",
    } });
    await public_rss_route(env, request, "/weibo/123", "rss");
    assert.equal(forwarded.headers.get("X-RSS-Credential-Sources"), source);
    assert.equal(forwarded.headers.get("X-RSS-Credential-Status"), expected);
    assert.equal(forwarded.headers.get("X-RSS-Browser-Credentials"), "present");
    assert.equal(forwarded.headers.get("Cookie"), null);
    assert.equal(forwarded.headers.get("Authorization"), null);
    assert.doesNotMatch(forwarded.url + JSON.stringify([...forwarded.headers]), /api_fixture_credential|browser-secret/);
  }
});
