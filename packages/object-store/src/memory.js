// 内存桶：测试替身，但要忠实到能跑通 SDK 的分页与错误路径。
//
// 与真实 R2 刻意对齐的几处「坑」——它们正是 SDK 里承重的分支：
//   - `delete([])` 抛错（R2 空批次报 10027）；
//   - `delete(>1000 键)` 抛错（SDK 必须自己分批）；
//   - `list` 按 key 字典序返回，游标是**上一页最后一个 key**（下一页取严格大于它的）。

import { byte_length, value_to_bytes, value_to_text } from "./bytes.js";

/** R2 单批删除的上限。 */
const MAX_DELETE_KEYS = 1000;

/** 一次性的 `fail_next()` 可注入的失败点。 */
const FAILABLE_OPS = new Set(["get", "put", "delete", "list", "head"]);

/**
 * 造一个内存桶。形状与 `R2Bucket` 的 get/put/delete/list/head 对齐，
 * 额外的 `calls` 计数与 `fail_next()` 只服务测试。
 * @returns {Record<string, any>}
 */
export function create_memory_bucket() {
  /** @type {Map<string, { value: unknown, size: number, etag: string, uploaded: Date, httpMetadata: Record<string, unknown>, customMetadata: Record<string, unknown> }>} */
  const objects = new Map();
  let revision = 0;
  /** @type {Record<string, number>} */
  const calls = {
    get: 0,
    put: 0,
    delete: 0,
    list: 0,
    head: 0
  };
  /** @type {Set<string>} */
  const failures = new Set();

  /** 消费掉一次注入的失败（一次性）。 */
  const maybe_fail = op => {
    if (!failures.has(op)) return;
    failures.delete(op);
    const error = new Error(`memory bucket ${op} failed`);
    /** @type {any} */
    error.code = "injected_failure";
    throw error;
  };

  /**
   * 把一个存储记录包装成 R2 对象的读接口。
   * @param {string} key
   */
  const view = key => {
    const record = objects.get(key);
    if (record === undefined) return null;
    return {
      key,
      size: record.size,
      etag: record.etag,
      uploaded: record.uploaded,
      httpMetadata: record.httpMetadata,
      customMetadata: record.customMetadata,
      body: record.value,
      text: () => value_to_text(record.value),
      arrayBuffer: async () => {
        const bytes = await value_to_bytes(record.value);
        return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      }
    };
  };
  return {
    objects,
    calls,
    async head(key) {
      calls.head += 1;
      maybe_fail("head");
      const record = objects.get(String(key));
      if (record === undefined) return null;
      const {
        body: _body,
        text: _text,
        arrayBuffer: _arrayBuffer,
        ...meta
      } = view(String(key));
      return meta;
    },
    async get(key) {
      calls.get += 1;
      maybe_fail("get");
      return view(String(key));
    },
    async put(key, value, options = {}) {
      calls.put += 1;
      maybe_fail("put");
      const name = String(key);
      if (options.onlyIf?.etagDoesNotMatch === "*" && objects.has(name)) return null;
      if (options.onlyIf?.etagMatches && objects.get(name)?.etag !== options.onlyIf.etagMatches) return null;
      const size = byte_length(value);
      objects.set(name, {
        value,
        size: size === null ? 0 : size,
        etag: `etag-${++revision}-${size === null ? "stream" : size}-${name.length}`,
        uploaded: new Date(),
        httpMetadata: {
          ...(options?.httpMetadata ?? {})
        },
        customMetadata: {
          ...(options?.customMetadata ?? {})
        }
      });
      return {
        key: name,
        size
      };
    },
    async delete(keys) {
      calls.delete += 1;
      maybe_fail("delete");
      const list = Array.isArray(keys) ? keys : [keys];
      // 两条与 R2 一致的硬约束，SDK 的 delete_many 正是为此而生。
      if (list.length === 0) throw new Error("delete requires at least one key");
      if (list.length > MAX_DELETE_KEYS) throw new Error(`delete accepts at most ${MAX_DELETE_KEYS} keys`);
      for (const key of list) objects.delete(String(key));
    },
    async list({
      prefix = "",
      cursor = null,
      limit = 1000,
      delimiter
    } = {}) {
      calls.list += 1;
      maybe_fail("list");
      const prefixes = new Set();
      const entries = [...objects.keys()].filter(key => key.startsWith(String(prefix ?? ""))).map(key => {
        const index = delimiter ? key.indexOf(delimiter, prefix.length) : -1;
        if (index < 0) return key;
        const directory = key.slice(0, index + delimiter.length);
        prefixes.add(directory);
        return directory;
      });
      const filtered = [...new Set(entries)].sort();
      const effective = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 1000;
      let start = 0;
      if (cursor !== null && cursor !== undefined && String(cursor) !== "") {
        const index = filtered.findIndex(key => key > String(cursor));
        start = index === -1 ? filtered.length : index;
      }
      const slice = filtered.slice(start, start + effective);
      const truncated = start + slice.length < filtered.length;
      return {
        objects: slice.filter(key => !prefixes.has(key)).map(key => view(key)),
        truncated,
        cursor: truncated ? slice[slice.length - 1] : null,
        ...(delimiter ? {
          delimitedPrefixes: slice.filter(key => prefixes.has(key))
        } : {})
      };
    },
    /**
     * 布一次性的失败：下一次该操作抛错。`op ∈ {get, put, delete, list, head}`。
     * @param {{ op: string }} input
     * @returns {void}
     */
    fail_next({
      op
    } = {
      op: ""
    }) {
      if (!FAILABLE_OPS.has(op)) throw new Error(`unknown failable op: ${op}`);
      failures.add(op);
    }
  };
}
