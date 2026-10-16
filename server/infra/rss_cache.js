/**
 * 路由结果：普通脚本采用两级 TTL 缓存；后台生成的 XML 持久保存，不设过期时间。
 * 共用缓存键归一化、single-flight 去重与渲染结果记忆化。
 *
 * 纯模块，不依赖 Cloudflare API，也不 import repository——layering 规则不许
 * `infra/` 依赖 `repository/`（见 `test/layering.test.js` 的 `ALLOWED.infra`）。
 * 持久化因此走**注入的 store**，由组合根 `server/durable_object.js` 把
 * `RepositoryRssRouteCache` 传进来；store 为 null 时退化为纯内存缓存。
 */

/** L1 与 L2 共用的条目上限（条数）。真正的内存天花板由 `max_bytes` 兜底。 */
const DEFAULT_MAX_ENTRIES = 1024;
/** L1 的内存预算（近似值，按 JS 字符串 length 累加），防止大 feed 把 DO 撑爆。 */
const DEFAULT_MAX_BYTES = 32 * 1024 * 1024;
/** 单条目落 L2 的大小上限：`SCRIPT_OUTPUT_BYTES` 允许 2MB 的产出，整条进 SQLite 不合适。 */
const DEFAULT_PERSIST_MAX_BYTES = 256 * 1024;

function is_xml_key(key) {
  return key.startsWith("public-snapshot:") || key.startsWith("private-snapshot:");
}

/**
 * @typedef {object} RouteCacheStore L2：同步接口，便于 `run` 在任何 await 之前完成查找。
 * @property {(key: string) => { output_json: string, invoked: number, expires_at: number } | null} read
 * @property {(entry: { key: string, output_json: string, invoked: number, expires_at: number, created_at: number }) => void} write
 * @property {(now: number) => void} delete_expired
 * @property {() => void} clear
 * @property {() => number} count
 * @property {(keep: number) => void} delete_oldest
 */

/**
 * 由 path + 排序归一化后的 query 生成缓存键。
 * params 必须已剔除 token 等凭证参数；同名不同值按值排序，保证乱序 query 归一为同键。
 * @param {string} pathname
 * @param {URLSearchParams | Iterable<[string, string]>} params
 * @returns {string}
 */
export function rss_route_cache_key(pathname, params) {
  /** @type {[string, string][]} */
  const pairs = [];
  for (const [name, value] of params) pairs.push([name, value]);
  pairs.sort((left, right) => {
    if (left[0] !== right[0]) return left[0] < right[0] ? -1 : 1;
    if (left[1] !== right[1]) return left[1] < right[1] ? -1 : 1;
    return 0;
  });
  let query = "";
  for (const [name, value] of pairs) {
    query += (query === "" ? "?" : "&") + encodeURIComponent(name) + "=" + encodeURIComponent(value);
  }
  // 隔离旧版自动注入 Cookie 产生的持久化结果。
  return "cookie-explicit:" + pathname + query;
}

/**
 * @typedef {object} RouteCacheEntry
 * @property {string} output 脚本产出的 feed JSON
 * @property {boolean} invoked 这次产出是否真的下发了设备调用（决定 Cache-Control）
 * @property {number} expires_at 普通缓存的绝对时间戳；持久 XML 为 0
 * @property {number} saved_at 最后成功生成的时间
 * @property {number} bytes 近似内存占用（output + 已渲染的正文）
 * @property {Map<string, string>} rendered `format + "\n" + self_url` → 渲染后的正文
 * @property {boolean} snapshot 是否持久化两种 XML
 */

/**
 * 命中直接返回；未命中按 key single-flight 去重执行，失败不缓存。
 * L1 按内存预算淘汰；L2 只对普通缓存执行过期及容量清理。
 */
export class RssRouteCache {
  /**
   * @param {number} ttl_ms
   * @param {number} max_entries
   * @param {{
   *   store?: RouteCacheStore | null,
   *   max_bytes?: number,
   *   persist_max_bytes?: number,
   * }} [options]
   */
  constructor(
    ttl_ms = 600_000,
    max_entries = DEFAULT_MAX_ENTRIES,
    { store = null, max_bytes = DEFAULT_MAX_BYTES, persist_max_bytes = DEFAULT_PERSIST_MAX_BYTES, clock = Date.now } = {},
  ) {
    this.ttl_ms = ttl_ms;
    this.max_entries = max_entries;
    this.store = store;
    this.max_bytes = max_bytes;
    this.persist_max_bytes = persist_max_bytes;
    this.clock = clock;
    /** @type {Map<string, RouteCacheEntry>} */
    this.entries = new Map();
    /** @type {Map<string, Promise<{ output: string, invoked: boolean }>>} */
    this.inflight = new Map();
    this.generation = 0;
    this.bytes = 0;
    this.l1_hits = 0;
    this.l2_hits = 0;
    this.misses = 0;
    // miss 是「这个请求没查到缓存」（同 key 的 N 个并发请求会各记一次），executions 是
    // 「真的跑了一次 produce」。压测要回答的是后者：设备被调用了多少次。
    this.executions = 0;
  }

  /**
   * 只查 L1（同步）。L2 走 `resolve`。
   * @param {string} key
   * @param {number} now
   * @returns {{ output: string, invoked: boolean } | null}
   */
  lookup(key, now) {
    const entry = this.entries.get(key);
    if (entry === undefined) return null;
    if (entry.expires_at !== 0 && entry.expires_at <= now) {
      this.drop(key);
      return null;
    }
    this.l1_hits += 1;
    return { output: entry.output, invoked: entry.invoked, ...(entry.snapshot ? { rendered: entry.rendered } : {}) };
  }

  /**
   * L1 → L2。L2 命中时把条目回填 L1（**沿用 L2 的 `expires_at`**，不续期）。
   * @param {string} key
   * @param {number} now
   * @returns {{ output: string, invoked: boolean } | null}
   */
  resolve(key, now) {
    const hit = this.lookup(key, now);
    if (hit !== null) return hit;
    const stored = this.store === null ? null : this.store.read(key);
    if (stored === null || stored === undefined) return null;
    const xml = is_xml_key(key);
    if (!xml && Number(stored.expires_at) <= now) return null;
    this.l2_hits += 1;
    this.put(key, {
      output: stored.output_json,
      invoked: Number(stored.invoked) !== 0,
      expires_at: xml ? 0 : Number(stored.expires_at),
      saved_at: stored.saved_at ?? Number(stored.expires_at) - this.ttl_ms,
      rendered: stored.rendered,
    }, now);
    return { output: stored.output_json, invoked: Number(stored.invoked) !== 0,
      ...(stored.rendered ? { rendered: new Map(stored.rendered) } : {}) };
  }

  /**
   * 先查缓存；未命中则按 key 去重执行 produce，成功后写缓存。
   * 同 key 并发请求（含失败）共享同一次执行。
   * @param {string} key
   * @param {number} now
   * @param {() => Promise<{ output: string, invoked: boolean }>} produce
   * @returns {Promise<{ output: string, invoked: boolean, cached: boolean }>}
   */
  async run(key, now, produce, { force = false } = {}) {
    const hit = force ? null : this.resolve(key, now);
    if (hit !== null) return { ...hit, cached: true };
    this.misses += 1;
    let pending = this.inflight.get(key);
    if (pending === undefined) {
      this.executions += 1;
      pending = Promise.resolve()
        .then(produce)
        .then((result) => {
          // 失效发生在执行期间时（如脚本刚被更新）不回填，避免旧内容重新进入缓存。
          if (this.inflight.get(key) === pending) {
            const completed_at = this.clock();
            const value = { ...result, saved_at: completed_at, expires_at: is_xml_key(key) ? 0 : completed_at + this.ttl_ms };
            // 先持久化再替换内存；刷新失败时仍可读取旧快照。
            this.persist(key, value);
            this.put(key, value, completed_at);
          }
          return result;
        })
        .finally(() => {
          if (this.inflight.get(key) === pending) this.inflight.delete(key);
        });
      this.inflight.set(key, pending);
    }
    const result = await pending;
    return { output: result.output, invoked: result.invoked, cached: false,
      ...(result.rendered ? { rendered: new Map(result.rendered) } : {}) };
  }

  /**
   * 渲染结果的记忆化，键是 `(cache_key, format, self_url)`——渲染依赖 self_url
   * （`X-Feed-Public-URL`），不能只按 format 缓存。条目不在 L1 时只渲染不记忆。
   * @param {string} key
   * @param {string} format
   * @param {string} self_url
   * @param {() => string} build
   * @returns {string}
   */
  render(key, format, self_url, build) {
    const entry = this.entries.get(key);
    if (entry === undefined) return build();
    const render_key = format + "\n" + self_url;
    const cached = entry.rendered.get(render_key);
    if (cached !== undefined) return cached;
    const body = build();
    entry.rendered.set(render_key, body);
    entry.bytes += body.length;
    this.bytes += body.length;
    this.evict();
    return body;
  }

  /** 配置变更只使普通缓存失效，保留已生成和正在生成的 XML。 */
  invalidate_all() {
    this.generation += 1;
    for (const key of this.entries.keys()) if (!is_xml_key(key)) this.drop(key);
    for (const key of this.inflight.keys()) if (!is_xml_key(key)) this.inflight.delete(key);
    if (this.store !== null) this.store.clear();
  }

  /** 观测用：命中分布与积压。 */
  stats() {
    return {
      entries: this.entries.size,
      bytes: this.bytes,
      inflight: this.inflight.size,
      l1_hits: this.l1_hits,
      l2_hits: this.l2_hits,
      misses: this.misses,
      executions: this.executions,
    };
  }

  /** 管理端只读状态；XML 无过期时间，不计命中，也不返回正文。 */
  inspect(key, now = Date.now()) {
    const memory = this.entries.get(key);
    const stored = this.store?.read(key);
    const expires_at = Number(memory?.expires_at ?? stored?.expires_at ?? 0);
    const exists = Boolean(memory || stored);
    const xml = is_xml_key(key);
    return {
      status: !exists ? "empty" : xml || expires_at > now ? "fresh" : "expired",
      saved_at: exists ? memory?.saved_at ?? stored?.saved_at ?? expires_at - this.ttl_ms : 0,
      ...(!xml ? { expires_at } : {}),
      bytes: memory?.bytes ?? (stored ? stored.output_json.length + (stored.rendered || []).reduce((total, [, body]) => total + body.length, 0) : 0),
      persistent: Boolean(stored && (xml || Number(stored.expires_at) === expires_at)),
      refreshing: this.inflight.has(key),
    };
  }

  /**
   * 写入 L1 并维护容量。缓存未命中时由 `run`/`resolve` 调用。
   * @param {string} key
   * @param {{ output: string, invoked: boolean, expires_at: number }} value
   * @param {number} now
   * @returns {void}
   */
  put(key, value, now) {
    this.drop(key);
    const rendered = new Map(value.rendered || []);
    const bytes = value.output.length + [...rendered.values()].reduce((total, body) => total + body.length, 0);
    this.entries.set(key, {
      output: value.output,
      invoked: value.invoked,
      expires_at: value.expires_at,
      saved_at: value.saved_at,
      bytes,
      rendered,
      snapshot: Boolean(value.rendered),
    });
    this.bytes += bytes;
    this.evict(now);
  }

  /**
   * XML 快照全部落 L2（仓储分块）；普通脚本结果仍按 persist_max_bytes 限制。
   * @param {string} key
   * @param {{ output: string, invoked: boolean, expires_at: number, rendered?: Map<string, string> }} result
   * @returns {void}
   */
  persist(key, result) {
    if (this.store === null) return;
    if (!result.rendered && result.output.length > this.persist_max_bytes) return;
    this.store.write({
      key,
      output_json: result.output,
      invoked: result.invoked ? 1 : 0,
      expires_at: result.expires_at,
      saved_at: result.saved_at,
      created_at: result.saved_at,
      ...(result.rendered ? { rendered: [...result.rendered] } : {}),
    });
    const total = this.store.count();
    if (total > this.max_entries) this.store.delete_oldest(this.max_entries);
  }

  /**
   * @param {string} key
   * @returns {void}
   */
  drop(key) {
    const entry = this.entries.get(key);
    if (entry === undefined) return;
    this.entries.delete(key);
    this.bytes -= entry.bytes;
  }

  /**
   * 先按 TTL 清理，再按写入序淘汰，直到条数与字节数都回到预算内。
   * @param {number} [now]
   * @returns {void}
   */
  evict(now) {
    if (now !== undefined) {
      for (const [key, entry] of this.entries) {
        if (entry.expires_at !== 0 && entry.expires_at <= now) this.drop(key);
      }
    }
    while (this.entries.size > this.max_entries || this.bytes > this.max_bytes) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.drop(oldest.value);
    }
  }
}
