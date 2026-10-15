// @findrss/object-store —— 类 S3 的对象存储 SDK（零依赖、纯 ESM）。
//
// 桶由调用方注入：`new BucketStore({ bucket: env.MY_BUCKET, prefix: "scope/" })`。
// 桶缺席时得到「空 store」模式，所有方法照常可用、只是什么都不存。

export { MAX_KEY_LENGTH, ObjectStoreError, is_valid_key, normalize_key, join_key, key_prefix } from "./keys.js";
export { BucketStore } from "./store.js";
export { create_memory_bucket } from "./memory.js";
export { byte_length, utf8_bytes, utf8_length, value_to_bytes, value_to_text } from "./bytes.js";
