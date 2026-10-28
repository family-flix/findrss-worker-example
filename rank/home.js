import { create_api_object_store } from "../server/infra/object_store.js";
import { gzip_html, stored_html } from "../server/infra/discovery_compression.js";
import { render_rank_home, rank_style_hash } from "../server/infra/rank_home.js";
import { read_rank_snapshots } from "./snapshot.js";

export const RANK_HOME_KEY = "rank/index.html";
export const RANK_HOME_ORIGIN = "https://findrss-rank.invalid";

export async function publish_rank_home(catalog, env, signal) {
  signal?.throwIfAborted();
  const store = create_api_object_store(env);
  if (!store) throw new Error("排行榜页面存储未配置");
  const snapshots = await read_rank_snapshots(catalog.boards, env);
  if (snapshots.available !== catalog.boards.length) throw new Error("脚本 JSON 快照尚未全部就绪，保留旧排行榜页面");
  signal?.throwIfAborted();
  const html = render_rank_home({ ...catalog, boards: snapshots.boards }, RANK_HOME_ORIGIN);
  const body = await gzip_html(html);
  const style_hash = await rank_style_hash();
  signal?.throwIfAborted();
  // HTML 和版本一次发布，失败时继续保留上一版完整页面。
  await store.put(RANK_HOME_KEY, body, {
    httpMetadata: { contentType: "text/html; charset=utf-8", contentEncoding: "gzip" },
    customMetadata: { version: crypto.randomUUID(), style_hash },
  });
}

export async function read_rank_home(env) {
  const object = await create_api_object_store(env)?.get(RANK_HOME_KEY);
  if (!object?.customMetadata?.version || !object.customMetadata.style_hash) return null;
  return { html: await stored_html(object), version: object.customMetadata.version, style_hash: object.customMetadata.style_hash };
}
