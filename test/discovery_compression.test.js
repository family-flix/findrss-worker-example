import assert from "node:assert/strict";
import test from "node:test";
import { gunzipSync } from "node:zlib";
import { create_memory_bucket } from "@findrss/object-store";
import { accepts_gzip, gzip_html, stored_html } from "../server/infra/discovery_compression.js";

test("gzip 无损保留空白、hydration 注释、JSON、内嵌样式和图片", async () => {
  const html = '<!doctype html><style>p { white-space: pre; }</style><!--[--><p>  空 格\n换行 </p><!--]-->' +
    '<script type="application/json">{"title":"a  b","avatar":"data:image/png;base64,YQ=="}</script>'.repeat(100);
  const bytes = await gzip_html(html);
  assert.equal(gunzipSync(bytes).toString("utf8"), html);
  assert.ok(bytes.length < Buffer.byteLength(html) / 2);
  const bucket = create_memory_bucket();
  await bucket.put("gzip", bytes, { httpMetadata: { contentEncoding: "gzip" } });
  await bucket.put("legacy", html);
  assert.equal(await stored_html(await bucket.get("gzip")), html);
  assert.equal(await stored_html(await bucket.get("legacy")), html);
  assert.equal(await stored_html(null), "");
  await bucket.put("broken", "bad gzip", { httpMetadata: { contentEncoding: "gzip" } });
  await assert.rejects(stored_html(await bucket.get("broken")));
});

test("按 Accept-Encoding 选择 gzip，尊重 q=0 和显式禁用", () => {
  for (const header of ["gzip", "br, gzip, deflate", "GZip; q=0.5", "*;q=1", "gzip;q=1, *;q=0"]) assert.equal(accepts_gzip(header), true, header);
  for (const header of [null, "", "identity", "br", "gzip;q=0", "gzip;q=0, *;q=1", "*;q=0", "gzip;q=bogus"]) assert.equal(accepts_gzip(header), false, header);
});
