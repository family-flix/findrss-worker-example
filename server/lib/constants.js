// API Worker 的模块级常量：上限、超时、白名单与缓存 TTL。
//
// 纯模块，可在 node --test 下直接覆盖。

export const MAX_BODY_BYTES = 1024 * 1024;
export const MAX_ATTEMPTS = 10;
export const LEASE_MILLISECONDS = 120_000;
export const RETENTION_MILLISECONDS = 7 * 24 * 60 * 60 * 1000;
export const MAINTENANCE_MILLISECONDS = 24 * 60 * 60 * 1000;
export const MAX_QUEUED_CALLS = 10_000;
export const API_OBJECT_NAME = "api";
export const MAX_ACCESS_TOKENS = 500;
export const READER_VERIFICATION_TTL_MS = 15 * 60 * 1000;
export const READER_VERIFICATION_RESEND_COOLDOWN_MS = 60 * 1000;
export const READER_VERIFICATION_MAX_ATTEMPTS = 5;
/** 阅读端注入口（积分/事件读写）的请求体上限。 */
export const READER_SYNC_MAX_BODY = 256 * 1024;
export const READER_SIGNUP_IP_WINDOW_MS = 60 * 60 * 1000;
export const READER_SIGNUP_IP_MAX_SENDS = 10;
export const MAX_ACCESS_TOKEN_LIFETIME_SECONDS = 366 * 24 * 60 * 60;
export const INVOKE_TIMEOUT_MILLISECONDS = 10_000;
export const DEFAULT_CALL_CREDIT_COST = 1;
export const MAX_CREDIT_BALANCE = 1_000_000_000;
export const MAX_CREDIT_ADJUSTMENT = 10_000_000;
export const MAX_REDEMPTION_CARDS_PER_CAMPAIGN = 1000;
export const DEFAULT_REDEMPTION_PAGE_SIZE = 50;
export const DEFAULT_DEVICE_LOG_LIMIT = 100;
export const MAX_DEVICE_LOG_LIMIT = 500;
export const MAX_DEVICE_LOG_MESSAGE_LENGTH = 2000;
export const DISCOVERY_PLATFORM_LABELS = {
  douyin: "抖音",
  wxchannels: "视频号",
  wxmp: "公众号",
  zhihu: "知乎",
  x: "X",
  xiaohongshu: "小红书",
  bilibili: "哔哩哔哩",
  weibo: "微博",
  kuaishou: "快手",
  youtube: "YouTube",
  instagram: "Instagram",
  telegram: "Telegram",
  website: "网页",
};
// 旧分类只用于兼容：读取为标签，新增源不再需要分类。
export const DISCOVERY_CATEGORY_TAGS = {
  technology: "科技",
  development: "开发",
  business: "商业",
  science: "科学",
  design: "设计",
  life: "生活",
};
export const DISCOVERY_CATEGORIES = new Set([
  "recommended",
  "technology",
  "development",
  "business",
  "science",
  "design",
  "life",
]);
export const MAX_DISCOVERY_SOURCES = 1000;
/** 详情页 `/s/<id>` 的「同类订阅源」条数。是内部链接网，不是内容列表，不需要更多。 */
export const DISCOVERY_RELATED_LIMIT = 12;
export const MAX_SCRIPTS = 200;
export const MAX_SCRIPT_BYTES = 128 * 1024;
export const MAX_RSS_ROUTE_PATH_BYTES = 512;
export const SCRIPT_MODULE_ROUTE_EXPORT = /\bexport\s+const\s+routes?\s*=/;
export const SCRIPT_FETCH_TIMEOUT_MS = 10000;
export const SCRIPT_FETCH_BYTES = 2 * 1024 * 1024;
export const SCRIPT_OUTPUT_BYTES = 2 * 1024 * 1024;
export const SCRIPT_RUN_TIMEOUT_MS = 8000;
/**
 * 沙箱脚本里一次设备调用的预算。**计时从建任务之前开始，所以它包含排队时间**，
 * 不只是设备干活的时间。设备本身是并行的（`MMStartTask` 1 ms 返回，一次调用是一次
 * ~2 s 的异步往返），但整栈吞吐长期恒定在 ~3.4 次/秒 —— 那是探针取证通道在 Frida
 * 单线程 JS 上按字节 hex 每个 inflate 结果的固定开销，见 mp-go/CONCURRENCY.md
 * 「吞吐天花板」。441 个源整刷时最后入队的那些仍要排队一百多秒，预算比排队时间短
 * 就全都 504，与设备快慢无关。
 * 取与 `READER_DEVICE_FEED_TIMEOUT_MS`（阅读端抓取预算）同值，两层一起放宽。
 * 吞吐抬上去之后这个数要跟着往下收；收得太紧又会把排队变成 504，所以按实测拐点定。
 */
export const SCRIPT_INVOKE_TIMEOUT_MS = 180_000;
/**
 * 同一路由 + 同一相位 + 同一 query 的失败日志，在这个窗口内只记一行。
 * 没这道闸门时，冷缓存下的 1000 个并发同键请求超时会写 1000 行重复日志。
 */
export const SCRIPT_FAILURE_LOG_WINDOW_MS = 30_000;
/** 失败日志闸门同时跟踪的键数上限（超过就丢最久没记过的键）。 */
export const SCRIPT_FAILURE_LOG_MAX_KEYS = 2048;
export const MAX_SCRIPT_INVOKES = 20;
/**
 * QuickJS 沙箱的并发泳道上限。每次执行都是一个全新的 wasm 实例（asyncify 状态不能复用），
 * 所以泳道数 = 同时在飞的 wasm 实例数，闸的是内存（DO 上限 128MB），不是并发能力。
 * 泳道按需创建、不预建：并发执行少时（含同 key 合并生效的场景）只会用到一两条。
 */
export const MAX_SANDBOX_LANES = 16;
export const RSS_ROUTE_CACHE_TTL_MS = 10 * 60 * 1000;
/** L1 与 L2 共用的条目数上限。 */
export const RSS_ROUTE_CACHE_MAX_ENTRIES = 4096;
/**
 * L1 的内存预算（近似值）。DO 的内存上限是 128MB，条目本体最大可达
 * `SCRIPT_OUTPUT_BYTES` = 2MB，只按条数限容会撑爆，所以字节数也要设闸。
 */
export const RSS_ROUTE_CACHE_MAX_BYTES = 32 * 1024 * 1024;
/** 单条目允许落 L2 的大小上限：超过就只留 L1，不往 SQLite 塞大块 JSON。 */
export const RSS_ROUTE_CACHE_PERSIST_MAX_BYTES = 256 * 1024;
export const DEVICE_LOG_CATEGORIES = new Set([
  "connection",
  "heartbeat",
  "call",
  "response",
  "system",
]);
export const DEVICE_LOG_LEVELS = new Set(["info", "warn", "error"]);
export const DEVICE_LOG_DIRECTIONS = new Set(["inbound", "outbound", "internal"]);
/** 脚本执行日志来源：真实请求 / 后台测试运行 / 保存时校验失败。 */
export const SCRIPT_LOG_SOURCES = new Set(["request", "test", "save"]);
/** 失败相位，用于区分错误发生在脚本生命周期的哪一段。 */
export const SCRIPT_LOG_PHASES = new Set([
  "ok",
  "mock",
  "metadata",
  "module",
  "runtime",
  "invoke",
  "output",
]);
export const MAX_SCRIPT_LOG_ERROR_LENGTH = 8 * 1024;

/**
 * 扣费归因头：脚本调用链逐跳透传的「行为」标签，只在写账本的那一跳归一。
 * 永不参与鉴权与路由，内部调用方最多只能错标自己那一行。
 */
export const CREDIT_SUBJECT_HEADER = "X-Api-Credit-Subject";

/**
 * 合并头：带上它，同一次「请求级操作」（RSS 路径传的是路由缓存键）派生出的同参调用
 * 若已有在飞的 `calls` 行，就不再新建一条，而是挂到那条上等结果。
 *
 * 这是**可选**的：不带这个头，`/invoke` 与 `/call` 的语义完全不变（两次调用就是两次）。
 * 键与调用方绑定（查询里带 `publisher_device_id`），所以它只能合并调用方自己的在飞调用，
 * 不能用来搭别人的付费调用。
 */
export const COALESCE_KEY_HEADER = "X-Api-Coalesce-Key";
/** 合并键的长度上限：路由 pathname + query，超过就退回「不合并」而不是截断（截断会误并）。 */
export const MAX_COALESCE_KEY_LENGTH = 1024;
