# @findrss/object-store

零依赖的类 S3 对象存储 SDK。**桶永远由调用方注入**——这个包不 import
`cloudflare:workers`、不读环境变量、不假设自己跑在哪个 runtime，所以同一份代码能在
`xiaoxunrss-worker`、`api`、`node --test`（内存桶）以及别的项目里跑。

## 用法

```js
import { BucketStore } from "@findrss/object-store";

// 一个 store 实例 = 一个命名空间（prefix 可选，尾部由 SDK 补齐）。
const store = new BucketStore({ bucket: env.READER_BODIES, prefix: "bodies/local/" });

await store.put("abc.html", html, { httpMetadata: { contentType: "text/html; charset=utf-8" } });
const text = await store.get_text("abc.html");     // miss → ""
const object = await store.get("abc.html");        // miss → null
await store.delete_many(keys, { best_effort: true });

const usage = await store.usage();                 // { bytes, objects, truncated, pages }
```

### 承重行为

- **`put` 不强制 buffer**：`string` / `Uint8Array` / `ArrayBuffer` / `Blob` /
  `ReadableStream` 原样透传给桶。
- **前缀由 store 施加**：调用方只给相对 key，key 的结构性校验（无前导/尾随 `/`、
  无 `//`、无 `.`/`..` 段、无反斜杠、无控制字符、≤ 1024 UTF-8 字节）保证它无法
  逃出自己的前缀。
- **`delete_many` 独占 R2 的坑**：过滤空串、**永不发出空批次**（R2 对 `delete([])`
  报 10027）、按 1000 分批。`best_effort: true` 吞掉每批错误，反之首个失败即 reject。
- **`usage()` 是配额读数**：游标循环翻 `list` 累加 `object.size`，在
  `maxObjects`/`maxPages` 处停下并置 `truncated: true`——语义是「至少这么多」，
  UI 必须照实渲染。
- **目录读取**：`list({ prefix, delimiter: "/", cursor })` 只返回直接子文件，
  子目录在 `delimited_prefixes` 中返回，与对象 key 一样保留桶内完整前缀。
- **空 store 模式**（桶缺席）：`get/head → null`、`get_text → ""`、`exists → false`、
  `put/delete/delete_many → 0`、`list/list_all → 空且未截断`、
  `usage → { ..., available: false }`。

## R2 桶契约

SDK 只依赖这四个方法（`head` 可选，缺了会退回 `get`）：

```ts
interface Bucket {
  get(key: string): Promise<ObjectBody | null>;
  put(key: string, value: unknown, options?: object): Promise<unknown>;
  delete(keys: string[]): Promise<unknown>;   // 空数组抛错、>1000 键抛错
  list(options: { prefix: string; cursor?: string; limit: number; delimiter?: string }):
    Promise<{ objects: { key: string; size: number }[]; truncated: boolean; cursor: string | null; delimitedPrefixes?: string[] }>;
}
```

`create_memory_bucket()` 提供了忠实的测试替身（分页、错误路径、`calls` 计数、
`fail_next({ op })`）。

## 在生产环境里绑定可能缺席

`api` Worker 的 R2 绑定（`API_STORAGE`）由 `findrss-worker/wrangler.jsonc` 配置，
Wrangler 与启动脚本均读取它。订阅源头像使用该桶持久化图片。
没有绑定的环境中，头像沿用 SQLite；已有 R2 头像则需要恢复绑定才能读取。
`findrss-worker/server/infra/object_store.js` 的工厂返回 `null` 就是这个契约，
**绝不能在模块顶层解引用 env**。
