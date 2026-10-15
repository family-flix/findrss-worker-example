// BucketStore：类 S3 的薄封装，桶永远由调用方注入。
//
// **这个模块绝不 import `cloudflare:workers`，也不读任何环境变量**——桶是构造参数。
// 这是它能在两个 worker、`node --test`、以及别的项目里都跑起来的前提。
//
// 绑定缺席时构造出一个「空 store」：所有方法都给出与「什么都没存」一致的降级形状，
// 调用方永远不用判空。唯一的例外是 `store_rows` 那类写路径——**它们必须显式判
// `store.available`**，因为「R2 不可用却写了 SQL 指针行」会留下指向不存在对象的行。

import { ObjectStoreError, key_prefix, normalize_key } from "./keys.js";

export class BucketStore {
  /**
   * @param {{ bucket?: unknown, prefix?: string }} [options]
   */
  constructor({ bucket, prefix = "" } = {}) {
    this.prefix = key_prefix(prefix);
    this.available = Boolean(bucket);
    if (this.available) {
      for (const method of ["get", "put", "delete", "list"]) {
        if (typeof (/** @type {any} */ (bucket)[method]) !== "function") {
          throw new ObjectStoreError("invalid_bucket", `bucket is missing ${method}()`);
        }
      }
    }
    /** @type {any} */
    this.bucket = bucket ?? null;
  }

  /**
   * @param {string} key
   * @returns {string}
   */
  full_key(key) {
    return this.prefix + normalize_key(key);
  }

  /**
   * 相对 key → 绝对前缀（list/usage 用；子前缀允许为空串）。
   * @param {unknown} prefix
   * @returns {string}
   */
  full_prefix(prefix) {
    return this.prefix + key_prefix(prefix);
  }

  /**
   * 取一个对象（不存在返回 `null`，绝不为 miss 抛错）。
   * @param {string} key
   * @returns {Promise<any>}
   */
  async get(key) {
    if (!this.available) return null;
    return this.bucket.get(this.full_key(key));
  }

  /**
   * 只取元数据。桶没实现 `head()` 时退回 `get()`（真实 R2 两者都有）。
   * @param {string} key
   * @returns {Promise<any>}
   */
  async head(key) {
    if (!this.available) return null;
    const full = this.full_key(key);
    if (typeof this.bucket.head === "function") return this.bucket.head(full);
    return this.bucket.get(full);
  }

  /**
   * 取文本；miss 返回 `""`。读取错误**不吞**——由调用方决定降级方式。
   * @param {string} key
   * @returns {Promise<string>}
   */
  async get_text(key) {
    const object = await this.get(key);
    if (object === null || object === undefined) return "";
    return object.text();
  }

  /**
   * @param {string} key
   * @returns {Promise<boolean>}
   */
  async exists(key) {
    return (await this.head(key)) !== null;
  }

  /**
   * 写入。**不强制 buffer**：string / Uint8Array / ArrayBuffer / Blob / ReadableStream
   * 原样透传给桶，SDK 里不出现 `arrayBuffer()` 兜底。
   * @param {string} key
   * @param {unknown} value
   * @param {Record<string, unknown>} [options]
   * @returns {Promise<any>}
   */
  async put(key, value, options = {}) {
    if (!this.available) return 0;
    return this.bucket.put(this.full_key(key), value, options);
  }

  /**
   * @param {string} key
   * @param {unknown} text
   * @param {Record<string, unknown>} [options]
   * @returns {Promise<any>}
   */
  async put_text(key, text, options = {}) {
    return this.put(key, String(text ?? ""), options);
  }

  /**
   * 删单个 key；`""` 与空 store 都是 no-op。
   * @param {string} key
   * @returns {Promise<number>}
   */
  async delete(key) {
    if (!this.available || key === "") return 0;
    await this.bucket.delete([this.full_key(key)]);
    return 1;
  }

  /**
   * 分批删除。**R2 的坑全在这里**：空串必须过滤、**永不发出空批次**（R2 对
   * `delete([])` 报 10027）、单批上限 1000。
   *
   * `best_effort: true` 时把每批错误吞成 `console.warn` 并继续，返回「尝试过的条数」；
   * `false` 时首个失败即 reject（调用方拿它当「删除没删干净」的信号）。
   * @param {unknown[]} keys
   * @param {{ batchSize?: number, best_effort?: boolean }} [options]
   * @returns {Promise<number>}
   */
  async delete_many(keys, { batchSize = 1000, best_effort = false } = {}) {
    const cleaned = (Array.isArray(keys) ? keys : [])
      .map((key) => String(key ?? ""))
      .filter((key) => key !== "");
    if (!this.available || cleaned.length === 0) return 0;
    const limit = Number.isFinite(batchSize) && batchSize > 0 ? Math.floor(batchSize) : 1000;
    let attempted = 0;
    for (let index = 0; index < cleaned.length; index += limit) {
      const batch = cleaned.slice(index, index + limit).map((key) => this.full_key(key));
      if (batch.length === 0) continue;
      try {
        await this.bucket.delete(batch);
      } catch (error) {
        if (!best_effort) throw error;
        console.warn("object store delete failed", error);
      }
      attempted += batch.length;
    }
    return attempted;
  }

  /**
   * 翻一页。返回 `{ objects, truncated, cursor }`，`cursor` 在未截断时为 `null`。
   * @param {{ prefix?: string, cursor?: string | null, limit?: number }} [options]
   * @returns {Promise<{ objects: any[], truncated: boolean, cursor: string | null }>}
   */
  async list({ prefix = "", cursor = null, limit = 1000 } = {}) {
    if (!this.available) return { objects: [], truncated: false, cursor: null };
    const options = { prefix: this.full_prefix(prefix), limit };
    // 真实 R2 会校验 `ListOptions` 的字段类型：`cursor` 只接受 string，**没有游标时
    // 必须整个字段省略**，传 `null` 直接抛 `Incorrect type for the 'cursor' field`。
    // 内存桶容忍 `null`，所以只有打真桶（miniflare / 线上）才会暴露。
    if (typeof cursor === "string" && cursor !== "") options.cursor = cursor;
    const page = await this.bucket.list(options);
    const truncated = page?.truncated === true;
    return {
      objects: Array.isArray(page?.objects) ? page.objects : [],
      truncated,
      cursor: truncated ? (page?.cursor ?? null) : null,
    };
  }

  /**
   * 翻完所有页，在 `maxPages`/`maxObjects` 处停下。
   * @param {{ prefix?: string, maxPages?: number, maxObjects?: number }} [options]
   * @returns {Promise<{ objects: any[], truncated: boolean, pages: number }>}
   */
  async list_all({ prefix = "", maxPages = 50, maxObjects = 100000 } = {}) {
    if (!this.available) return { objects: [], truncated: false, pages: 0 };
    /** @type {any[]} */
    const objects = [];
    let cursor = null;
    let pages = 0;
    let truncated = false;
    for (;;) {
      const page = await this.list({ prefix, cursor, limit: 1000 });
      pages += 1;
      for (const object of page.objects) objects.push(object);
      const more = page.truncated === true && typeof page.cursor === "string" && page.cursor !== "";
      if (!more) break;
      cursor = page.cursor;
      if (pages >= maxPages || objects.length >= maxObjects) {
        truncated = true;
        break;
      }
    }
    // 单页就超过 maxObjects 时上面的分支不会触发，但结果确实被裁过。
    if (objects.length > maxObjects) truncated = true;
    return { objects: objects.slice(0, maxObjects), truncated, pages };
  }

  /**
   * 用量读数：cursor 循环翻 `list`、累加 `object.size`。
   * `truncated: true` 的语义是「**至少**这么多」，UI 必须照实渲染（前缀 `≥`）。
   * @param {string} [prefix]
   * @param {{ maxObjects?: number, maxPages?: number }} [options]
   * @returns {Promise<{ bytes: number, objects: number, truncated: boolean, pages: number, available?: boolean }>}
   */
  async usage(prefix = "", { maxObjects = 100000, maxPages = 50 } = {}) {
    if (!this.available) {
      return { bytes: 0, objects: 0, truncated: false, pages: 0, available: false };
    }
    let bytes = 0;
    let objects = 0;
    let pages = 0;
    let cursor = null;
    let truncated = false;
    for (;;) {
      const page = await this.list({ prefix, cursor, limit: 1000 });
      pages += 1;
      for (const object of page.objects) {
        bytes += Number(object?.size) || 0;
        objects += 1;
      }
      const more = page.truncated === true && typeof page.cursor === "string" && page.cursor !== "";
      if (!more) break;
      cursor = page.cursor;
      if (pages >= maxPages || objects >= maxObjects) {
        truncated = true;
        break;
      }
    }
    return { bytes, objects, truncated, pages };
  }
}
