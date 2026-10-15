// 叶子模块：调试开关/日志、ref 解包、时间格式化。
// 不 import 任何东西（连 constants.js 都不需要）——biz/、components/、pages/ 都从这里取。
// domain/ 刻意不依赖它：领域层不该碰 ref 解包或时间格式化这类平台/展示关注点。
//
// 这里**不认识 window / navigator**：业务层要能在多个宿主里跑，所以调试开关与在线状态
// 都由宿主 provider 探测（见 platform/browser.js 的 browser_host_environment），组装根在启动时
// 用 `configure_debug_logging(host.is_debug())` 灌进来；离线判断则由调用方把
// `host.is_offline()` 的结果当参数传进 `startup_error_message`。

/**
 * 阅读端诊断开关：URL 带 `?debug=1`、localStorage 置 `findrss-reader:debug=1`，
 * 或本地开发（localhost / 127.0.0.1）时打开。用于追踪
 * 点击条目 → 解析 → 是否有视频 → 挂载 Webview → 播放 这条链。
 *
 * 用 `let` 而不是 `const`：ESM 的导入是**活绑定**，组装根调用 configure 之后，
 * 已经 import 了 `debug_logging` 的模块看到的就是新值。
 */
let debug_logging = false;

/** 由组装根（store.js）按宿主探测结果调用。 @param {unknown} enabled */
function configure_debug_logging(enabled) {
  debug_logging = enabled === true;
}

/** @param {string} stage @param {unknown} [detail] */
function debug_log(stage, detail) {
  if (!debug_logging) return;
  if (detail === undefined) console.info(`[findrss:reader] ${stage}`);
  else console.info(`[findrss:reader] ${stage}`, detail);
}

/** @param {unknown} raw */
function source_value(value) {
  return value && value.__is_ref ? value.value : value;
}

/**
 * refobj 的嵌套值在后续读取时可能被包装为响应式对象，
 * 读取订阅源状态前必须解包。
 * @param {unknown} raw
 */
function unwrap_feed(raw) {
  if (!raw) return raw;
  return raw.__is_ref ? raw.value : raw;
}

/**
 * 「最近同步」用的时刻：今天只给 `HH:MM`，昨天与更早带上月日。
 * 不用 `format_time` 的相对时间是因为这个标签**一直挂在侧栏上**，没有定时器的话
 * 「刚刚」会一直停在「刚刚」，越看越假。
 * @param {number} timestamp
 */
function format_clock(timestamp) {
  const value = Number(timestamp) || 0;
  if (value === 0) return "";
  const date = new Date(value);
  const now = new Date();
  const clock = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  if (date.toDateString() === now.toDateString()) return clock;
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return `昨天 ${clock}`;
  return `${date.getMonth() + 1}月${date.getDate()}日 ${clock}`;
}

/** @param {number} timestamp */
function format_time(timestamp) {
  if (!timestamp) return "";
  const elapsed = Date.now() - timestamp;
  if (elapsed < 60_000) return "刚刚";
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)} 分钟前`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)} 小时前`;
  if (elapsed < 7 * 86_400_000) return `${Math.floor(elapsed / 86_400_000)} 天前`;
  return new Date(timestamp).toLocaleDateString("zh-CN");
}

/**
 * 字节数 → 人类可读（B/KB/MB，只保留一位小数）。
 * 服务端的配额常量与用量都是字节，展示层才换算——数字一旦在这里被四舍五入，
 * 「用了 1.2 MB / 8 MB」这类比较仍然成立，因为两边走的是同一个函数。
 * @param {unknown} bytes
 */
function format_bytes(bytes) {
  const value = Math.max(0, Number(bytes) || 0);
  if (value < 1024) return `${value} B`;
  const kb = value / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  const mb = kb / 1024;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

/**
 * 启动阶段（`bootstrap`）失败时给用户看的那句话。
 *
 * 只有在**浏览器自己都认为断网**时才改写文案：那时 fetch 抛的是 TypeError，浏览器自带的
 * 文案是英文的（Chrome「Failed to fetch」/Safari「Load failed」），直接写进页面很难看。
 * 在线时一律保留原始 message——渲染期的 TypeError 是真 bug，说成「网络问题」更坏；
 * 而后端返回非 2xx 时 message 本来就是中文人话（如「登录状态检查失败：HTTP 500」）。
 *
 * 离线时说的是「界面已缓存」而不是「数据已缓存」：Service Worker 只预缓存外壳，
 * 订阅与正文仍然必须联网（见 README 的 PWA 一节）。
 *
 * `offline` 由调用方从宿主端口取（`host.is_offline()`）：这里不碰 navigator。
 * @param {unknown} error @param {boolean} offline
 */
function startup_error_message(error, offline) {
  if (offline) {
    return "当前离线：界面已缓存，联网后刷新即可继续。";
  }
  const message = error instanceof Error ? error.message : String(error);
  if (/^(failed to fetch|load failed|networkerror)/i.test(message)) {
    return "阅读服务没有响应，可能仍在启动或已经停止。";
  }
  return message;
}

// ---- 图标上传（`PUT /api/file-icon`）----
// 图片以 **base64 进 JSON** 传输（请求体的类型被 `reader_client.js` 钉成 string +
// `Content-Type: application/json`），所以这里只负责把 `File` 读成 base64 并拦一道
// 大小 / 类型。白名单与上限与 `server/domain/file_icon.js` 的两个常量逐字对应；服务端
// 仍会按魔数嗅探复核，前端这道只是「别让用户白等一次往返」。

/** 允许上传的图片类型。**故意不含 SVG**：同源直开 SVG 能执行脚本。 */
const icon_content_types = ["image/png", "image/jpeg", "image/webp", "image/gif"];
/** 图片字节上限，与 `FILE_ICON_MAX_BYTES` 一致。 */
const icon_max_bytes = 2 * 1024 * 1024;

const base64_alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/**
 * Uint8Array → base64。刻意自己实现而不是用 `btoa`：这个模块不认识任何宿主全局，
 * 而 `btoa` 只吃「二进制字符串」，大图还得再切块绕 `String.fromCharCode` 的参数上限。
 * @param {Uint8Array} bytes
 * @returns {string}
 */
function encode_base64(bytes) {
  let out = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const has_b = index + 1 < bytes.length;
    const has_c = index + 2 < bytes.length;
    const triple = (bytes[index] << 16)
      | ((has_b ? bytes[index + 1] : 0) << 8)
      | (has_c ? bytes[index + 2] : 0);
    out += base64_alphabet[(triple >> 18) & 63] + base64_alphabet[(triple >> 12) & 63]
      + (has_b ? base64_alphabet[(triple >> 6) & 63] : "=")
      + (has_c ? base64_alphabet[triple & 63] : "=");
  }
  return out;
}

/**
 * 读一个用户选中的图片文件。返回 `{ bytes, content_type, error }`，失败只写 `error`
 * 不抛（调用方统一按「看 `error` 决定要不要发请求」处理）。
 * @param {unknown} file `<input type="file">` 给的 `File`
 * @returns {Promise<{ bytes: string, content_type: string, error: string }>}
 */
async function read_icon_file(file) {
  const empty = { bytes: "", content_type: "", error: "" };
  if (!file || typeof file !== "object" || typeof file.arrayBuffer !== "function") {
    return { ...empty, error: "请选择一张图片" };
  }
  const content_type = String(file.type || "");
  if (!icon_content_types.includes(content_type)) {
    return { ...empty, error: "只支持 PNG / JPEG / WebP / GIF" };
  }
  if (Number(file.size) > icon_max_bytes) {
    return { ...empty, error: "图片不能超过 2 MB" };
  }
  let bytes;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch {
    return { ...empty, error: "读取图片失败，请重试" };
  }
  if (bytes.length === 0 || bytes.length > icon_max_bytes) {
    return { ...empty, error: "图片不能超过 2 MB" };
  }
  return { bytes: encode_base64(bytes), content_type, error: "" };
}

export {
  read_icon_file,
  debug_logging,
  configure_debug_logging,
  debug_log,
  source_value,
  unwrap_feed,
  format_clock,
  format_time,
  format_bytes,
  startup_error_message,
};
