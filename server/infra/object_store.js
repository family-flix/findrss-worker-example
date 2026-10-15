// 绑定缺席时返回 null，让无需对象存储的环境继续工作。
import { BucketStore } from "@findrss/object-store";

/** 桶的默认前缀。api 侧的对象与阅读端的正文/图标分属不同桶，前缀留空即可按 key 组织。 */
const API_STORAGE_PREFIX = "";

/**
 * 从 env 造一个 API 侧的对象存储。绑定缺席返回 `null`（不是「空 store」——api 侧
 * 订阅源头像在没有绑定的环境沿用 SQLite 存储）。
 * @param {{ API_STORAGE?: unknown }} [env]
 * @returns {BucketStore | null}
 */
export function create_api_object_store(env) {
  const bucket = env?.API_STORAGE;
  if (!bucket) return null;
  return new BucketStore({ bucket, prefix: API_STORAGE_PREFIX });
}
