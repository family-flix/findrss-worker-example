// 用户操作日志域：事件实体（user_events）、keyset 游标、分页、订阅全量替换差集。
//
// 金额只存在账本一处（单一事实来源，见 `credits.js` 的 CreditTransactionModel），
// user_events 只记非金额事件。`ActivityPageModel` 通过 `value_of` 回调渲染行，
// 因此既能分页事件、也能分页积分流水而不引入对 credits 的依赖。
//
// 纯模块，可在 node --test 下直接覆盖。

/** 记录在案的用户主动操作。后台轮询刻意不记（量太大）。 */
const ACTIVITY_EVENT_TYPES = Object.freeze([
  "login",
  "register",
  "verify_email",
  "subscription_add",
  "subscription_remove",
  "refresh",
  "redeem",
]);

/**
 * 阅读端可以直接上报的类型（`POST /reader/events`）。
 * `login`/`register`/`verify_email`/`redeem` 只有 api 在真实业务里才知道，
 * 客户端伪造这些会污染事件流，因此入口收窄到这三种。
 */
const READER_EVENT_TYPES = Object.freeze([
  "subscription_add",
  "subscription_remove",
  "refresh",
]);

/** 事件保留时长，与阅读端 `xiaoxunrss-worker/src/domain/limits.js` 的已读保留同口径（180 天）。 */
const ACTIVITY_EVENT_RETENTION_MS = 180 * 24 * 60 * 60 * 1000;
/** 单用户事件条数上限，超出从最旧删起。 */
const ACTIVITY_MAX_EVENTS_PER_USER = 5000;
/** 清理最多每小时跑一次，避免每个 5 分钟 tick 都扫表。 */
const ACTIVITY_PRUNE_INTERVAL_MS = 60 * 60 * 1000;

/** subject 长度上限。SQLite 不校验长度，写入时必须自己兜住。 */
const ACTIVITY_SUBJECT_MAX_LENGTH = 120;
/** metadata_json 字节上限。 */
const ACTIVITY_METADATA_MAX_BYTES = 1024;

/** 分页默认与上限。 */
const ACTIVITY_DEFAULT_LIMIT = 50;
const ACTIVITY_MAX_LIMIT = 100;

/**
 * user_events 行实体：`metadata` 返回解析后的对象，不吐 `metadata_json` 原文。
 * 相关归一（类型白名单、subject 截断、metadata 序列化）作为工厂上的静态方法，
 * 因为它们是「事件如何入库」的规则，与行实体同生共死。
 * @param {Record<string, unknown>} [row]
 */
export function ActivityEventModel(row) {
  const source = row ?? {};
  /** @type {Record<string, unknown>} */
  let metadata = {};
  try {
    const parsed = JSON.parse(String(source.metadata_json ?? "{}"));
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      metadata = parsed;
    }
  } catch {
    metadata = {};
  }
  const state = Object.freeze({
    id: String(source.id),
    type: String(source.type),
    subject: String(source.subject ?? ""),
    metadata,
    created_at: Number(source.created_at),
  });
  return Object.freeze({
    ...state,
    toValue: () => ({
      id: state.id,
      type: state.type,
      subject: state.subject,
      metadata: state.metadata,
      created_at: state.created_at,
    }),
  });
}

ActivityEventModel.TYPES = ACTIVITY_EVENT_TYPES;
ActivityEventModel.READER_TYPES = READER_EVENT_TYPES;
ActivityEventModel.RETENTION_MS = ACTIVITY_EVENT_RETENTION_MS;
ActivityEventModel.MAX_EVENTS_PER_USER = ACTIVITY_MAX_EVENTS_PER_USER;
ActivityEventModel.PRUNE_INTERVAL_MS = ACTIVITY_PRUNE_INTERVAL_MS;
ActivityEventModel.SUBJECT_MAX_LENGTH = ACTIVITY_SUBJECT_MAX_LENGTH;
ActivityEventModel.METADATA_MAX_BYTES = ACTIVITY_METADATA_MAX_BYTES;
ActivityEventModel.of = ActivityEventModel;
/** 从 SQLite 行构造。 */
ActivityEventModel.fromRow = (row) => ActivityEventModel(row);
/**
 * 保留期截止时刻：`created_at` 早于此的 user_events 视为过期。
 * @param {unknown} now
 * @returns {number}
 */
ActivityEventModel.retention_cutoff = (now) => Number(now) - ACTIVITY_EVENT_RETENTION_MS;
/**
 * 距上次清理是否已够一个清理间隔（限流，避免每个 tick 都扫表）。
 * @param {unknown} now
 * @param {unknown} last_pruned_at
 * @returns {boolean}
 */
ActivityEventModel.should_prune = (now, last_pruned_at) =>
  Number(now) - Number(last_pruned_at) >= ACTIVITY_PRUNE_INTERVAL_MS;
/**
 * 只认已知的事件类型，其余归一为 `""`（调用方据此跳过写入）。
 * @param {unknown} value
 * @returns {string}
 */
ActivityEventModel.normalize_type = (value) => {
  const text = typeof value === "string" ? value : "";
  return ACTIVITY_EVENT_TYPES.includes(text) ? text : "";
};
/**
 * 归一「阅读端上报」的事件类型：必须是 ACTIVITY_EVENT_TYPES 的子集，
 * 且落在 READER_EVENT_TYPES 内，其余归一为 `""`。
 * @param {unknown} value
 * @returns {string}
 */
ActivityEventModel.normalize_reader_type = (value) => {
  const type = ActivityEventModel.normalize_type(value);
  return READER_EVENT_TYPES.includes(type) ? type : "";
};
/**
 * 可读文案的归一：去换行与控制字符、trim、按字符截断（不劈开代理对）。
 * 非字符串按空串处理；数字/布尔等标量先转字符串。
 * @param {unknown} text
 * @param {number} [max]
 * @returns {string}
 */
ActivityEventModel.subject = (text, max = ACTIVITY_SUBJECT_MAX_LENGTH) => {
  const value = typeof text === "string"
    ? text
    : text === null || text === undefined
      ? ""
      : String(text);
  const cleaned = value.replace(/[\u0000-\u001F\u007F]+/g, " ").trim();
  const limit = Number.isFinite(Number(max)) ? Math.max(0, Math.floor(Number(max))) : 0;
  if (limit === 0) return "";
  return [...cleaned].slice(0, limit).join("");
};
/**
 * metadata 序列化，按插入顺序逐个键累加，超出字节上限即停。
 * 非对象、循环引用等一律退回 `{}`。
 * @param {unknown} metadata
 * @returns {string}
 */
ActivityEventModel.metadata_json = (metadata) => {
  if (metadata === null || typeof metadata !== "object" || Array.isArray(metadata)) return "{}";
  /** @type {Record<string, unknown>} */
  const limited = {};
  for (const [key, value] of Object.entries(metadata)) {
    const candidate = { ...limited, [key]: value };
    let json;
    try {
      json = JSON.stringify(candidate);
    } catch {
      break;
    }
    if (typeof json !== "string") break;
    if (new TextEncoder().encode(json).byteLength > ACTIVITY_METADATA_MAX_BYTES) break;
    limited[key] = value;
  }
  return JSON.stringify(limited);
};

/**
 * keyset 游标实体：`${created_at}_${id}` 的解析与拼接，以及对应的 SQL WHERE 片段。
 * 游标只走参数绑定，不做字符串拼接；`(created_at, id)` 严格小于游标，
 * 保证倒序翻页不重复、不漏行。
 * @param {{ created_at: number, id: string }} cursor
 */
export function ActivityCursorModel(cursor) {
  const state = Object.freeze({
    created_at: Number(cursor.created_at),
    id: String(cursor.id),
  });
  return Object.freeze({
    ...state,
    /** 序列化回 query 用的键集游标。 */
    key: () => String(state.created_at) + "_" + state.id,
    toValue: () => ({ created_at: state.created_at, id: state.id }),
  });
}

ActivityCursorModel.of = ActivityCursorModel;
/**
 * 从一行记录构造游标；行不完整时返回 null。
 * @param {{ created_at?: unknown, id?: unknown }} row
 * @returns {ReturnType<typeof ActivityCursorModel> | null}
 */
ActivityCursorModel.fromRow = (row) => {
  if (row === null || typeof row !== "object") return null;
  const id = String(row.id ?? "");
  const created_at = Number(row.created_at);
  if (id === "" || !Number.isFinite(created_at)) return null;
  return ActivityCursorModel({ created_at, id });
};
/**
 * 解析键集游标。非法输入返回 null（调用方回 400），绝不做无界扫描。
 * @param {unknown} text
 * @returns {ReturnType<typeof ActivityCursorModel> | null}
 */
ActivityCursorModel.parse = (text) => {
  if (typeof text !== "string") return null;
  const trimmed = text.trim();
  if (trimmed === "") return null;
  const separator = trimmed.indexOf("_");
  if (separator <= 0 || separator === trimmed.length - 1) return null;
  const created_at = Number(trimmed.slice(0, separator));
  if (!Number.isFinite(created_at)) return null;
  const id = trimmed.slice(separator + 1);
  if (id.length > 128) return null;
  return ActivityCursorModel({ created_at, id });
};
/**
 * 从分页 query 解析游标：缺省/空串是首页（`{ cursor: null }`），
 * 非法输入返回 `false`（调用方回 400，绝不做无界扫描）。
 * @param {URL} url
 * @returns {{ cursor: ReturnType<typeof ActivityCursorModel> | null } | false}
 */
ActivityCursorModel.fromQuery = (url) => {
  const raw = url.searchParams.get("cursor");
  if (raw === null || raw.trim() === "") return { cursor: null };
  const cursor = ActivityCursorModel.parse(raw);
  if (cursor === null) return false;
  return { cursor };
};
/**
 * keyset 分页的 WHERE 片段与参数。null/undefined 游标返回空片段（首页）。
 * @param {ReturnType<typeof ActivityCursorModel> | { created_at: number, id: string } | null} [cursor]
 * @returns {{ clause: string, params: unknown[] }}
 */
ActivityCursorModel.where = (cursor) => {
  if (cursor === null || cursor === undefined) return { clause: "", params: [] };
  return {
    clause: "(created_at < ? OR (created_at = ? AND id < ?))",
    params: [cursor.created_at, cursor.created_at, cursor.id],
  };
};

/**
 * 一页活动（事件或积分流水）。把「多取一条」的 keyset 结果切成当前页 + 下一页游标，
 * 只有确实还有下一页时才回游标，避免前端空翻一页。
 * @param {Record<string, unknown>[]} rows
 * @param {number} limit
 * @param {(row: Record<string, unknown>) => Record<string, unknown>} value_of
 */
export function ActivityPageModel(rows, limit, value_of) {
  const source = Array.isArray(rows) ? rows : [];
  const page_rows = source.length > limit ? source.slice(0, limit) : source;
  const last = page_rows[page_rows.length - 1];
  const next_cursor = source.length > limit && last !== undefined
    ? ActivityCursorModel.fromRow(last)?.key() ?? null
    : null;
  const values = Object.freeze(page_rows.map((row) => value_of(row)));
  const state = Object.freeze({ values, next_cursor, limit: Number(limit) });
  return Object.freeze({
    ...state,
    toValue: () => ({ values: [...state.values], next_cursor: state.next_cursor }),
  });
}

ActivityPageModel.DEFAULT_LIMIT = ACTIVITY_DEFAULT_LIMIT;
ActivityPageModel.MAX_LIMIT = ACTIVITY_MAX_LIMIT;
ActivityPageModel.of = ActivityPageModel;
/**
 * 每页条数：非法/缺省取默认，其余夹到 [1, 100]。
 * @param {unknown} value
 * @returns {number}
 */
ActivityPageModel.clamp_limit = (value) => {
  if (value === null || value === undefined || value === "") return ACTIVITY_DEFAULT_LIMIT;
  const number = Number(value);
  if (!Number.isFinite(number)) return ACTIVITY_DEFAULT_LIMIT;
  return Math.max(1, Math.min(ACTIVITY_MAX_LIMIT, Math.floor(number)));
};

/**
 * 订阅全量替换的差集。仅按 URL 判定增删：改名/换分类/重排序都不产生事件。
 * `added` 取归一化后的新订阅（带 title），`removed` 取旧行（删除路径只查得到 URL）。
 * @param {Array<Record<string, unknown>>} existing_rows
 * @param {Array<{ url?: unknown, title?: unknown }>} next_subscriptions
 */
export function SubscriptionDiffModel(existing_rows, next_subscriptions) {
  /** @type {Map<string, string>} */
  const existing_titles = new Map();
  for (const row of Array.isArray(existing_rows) ? existing_rows : []) {
    const url = String(row?.feed_url ?? "");
    if (url === "") continue;
    existing_titles.set(url, String(row?.title ?? ""));
  }
  /** @type {Set<string>} */
  const next_urls = new Set();
  /** @type {Array<{ url: string, title: string }>} */
  const added = [];
  for (const subscription of Array.isArray(next_subscriptions) ? next_subscriptions : []) {
    const url = String(subscription?.url ?? "");
    if (url === "" || next_urls.has(url)) continue;
    next_urls.add(url);
    if (existing_titles.has(url)) continue;
    added.push({ url, title: String(subscription?.title ?? "") || url });
  }
  /** @type {Array<{ url: string, title: string }>} */
  const removed = [];
  for (const [url, title] of existing_titles) {
    if (!next_urls.has(url)) removed.push({ url, title });
  }
  const state = Object.freeze({ added: Object.freeze(added), removed: Object.freeze(removed) });
  return Object.freeze({
    ...state,
    toValue: () => ({ added: [...state.added], removed: [...state.removed] }),
  });
}

SubscriptionDiffModel.of = SubscriptionDiffModel;
