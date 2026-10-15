import { read_document_text } from "./http.js";
import {
  apply_extra_query,
  apply_proxy_template,
  normalize_fetch_context,
  source_article_headers,
  source_request_headers,
} from "./request_config.js";
import { proxy_target_url, public_http_url } from "./url.js";

// 播客常把多年节目与 show notes 放在同一份 XML 中；按实际响应字节封顶。
export const FEED_MAX_BYTES = 16 * 1024 * 1024;
export const ARTICLE_MAX_BYTES = 8 * 1024 * 1024;
export const MAX_REDIRECTS = 5;
export const FETCH_TIMEOUT_MS = 15000;
export const FEED_TIMEOUT_MS = 60000;

const redirect_statuses = new Set([301, 302, 303, 307, 308]);

async function cancel_body(response) {
  await response?.body?.cancel().catch(() => {});
}

/**
 * 无状态订阅源抓取。配置可以是原始值或阅读端已归一值，执行前都会再次收紧。
 *
 * `timeout_ms` 是给调用方按源类型分层的口子：脚本源（`/rss/`、`/atom/`）由 API 端调
 * 设备生成，抓一次要排队等设备，15 秒远远不够——而 `AbortSignal.timeout` 从 `fetch()`
 * 调用的那一刻起表，排队时间同样烧预算。不传则是 `FEED_TIMEOUT_MS`，
 * 预算覆盖重定向、响应头和完整 XML 下载。
 * @param {{ feed_url: string, settings?: unknown, options?: unknown,
 *   conditional?: { etag?: string, last_modified?: string }, allow_loopback?: boolean,
 *   timeout_ms?: number, fetch_impl?: typeof fetch }} input
 */
export async function fetch_feed_document(input) {
  const result = {
    xml: "",
    url: "",
    etag: "",
    last_modified: "",
    not_modified: false,
    error: "",
    timed_out: false,
    http_status: 0,
    duration_ms: 0,
    size_bytes: null,
    size_source: "",
  };
  const started_at = Date.now();
  const fetch_impl = input.fetch_impl ?? fetch;
  const initial = public_http_url(input.feed_url, { allow_loopback: input.allow_loopback === true });
  if (initial === null) {
    result.error = "订阅源地址被拒绝";
    result.duration_ms = Date.now() - started_at;
    return result;
  }
  const context = normalize_fetch_context(input.settings, input.options);
  const conditional = input.conditional ?? {};
  const timeout_ms =
    Number.isSafeInteger(input.timeout_ms) && input.timeout_ms > 0
      ? input.timeout_ms
      : FEED_TIMEOUT_MS;
  const signal = AbortSignal.timeout(timeout_ms);
  try {
    const original_origin = new URL(initial).origin;
    let current = apply_extra_query(initial, context.options.extra_query);
    let response = null;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      const headers = source_request_headers(
        context,
        current,
        new URL(current).origin !== original_origin,
      );
      if (hop === 0) {
        if (conditional.etag) headers["if-none-match"] = conditional.etag;
        if (conditional.last_modified) headers["if-modified-since"] = conditional.last_modified;
      }
      let attempt;
      try {
        attempt = await fetch_impl(current, {
          headers,
          redirect: "manual",
          signal,
        });
      } catch (failure) {
        result.timed_out = failure?.name === "TimeoutError" || signal.reason?.name === "TimeoutError";
        result.error = result.timed_out ? "订阅源读取超时" : "订阅源读取失败";
        return result;
      }
      if (attempt.status === 304) {
        await cancel_body(attempt);
        result.not_modified = true;
        result.http_status = 304;
        return result;
      }
      const location = attempt.headers.get("Location");
      if (location !== null && redirect_statuses.has(attempt.status)) {
        await cancel_body(attempt);
        let next;
        try {
          next = new URL(location, current).toString();
        } catch {
          result.error = "订阅源重定向地址无效";
          return result;
        }
        const validated = proxy_target_url(next, { allow_loopback: input.allow_loopback === true });
        if (validated === null) {
          result.error = "订阅源重定向地址被拒绝";
          return result;
        }
        current = validated;
        continue;
      }
      response = attempt;
      break;
    }
    if (response === null) {
      result.error = "订阅源重定向次数过多";
      return result;
    }
    result.http_status = response.status;
    result.url = current;
    if (!response.ok) {
      await cancel_body(response);
      result.error = `订阅源读取失败（HTTP ${response.status}）`;
      return result;
    }
    const declared_size = Number(response.headers.get("Content-Length"));
    if (response.headers.has("Content-Length") && Number.isSafeInteger(declared_size) && declared_size >= 0) {
      result.size_bytes = declared_size;
      result.size_source = "server";
    }
    const text = await read_document_text(response, FEED_MAX_BYTES, (bytes) => {
      result.size_bytes = bytes;
      result.size_source = "actual";
    });
    if (text === null) {
      result.error = "订阅源内容过大";
      return result;
    }
    // 上游可能以 200/204 返回空正文；这是缺少文档，不是 XML 语法错误。
    // 在记录条件请求凭据前拒绝，避免后续 304 让这个无效响应被当作有效源。
    if (text.trim() === "") {
      result.error = `订阅源返回了空内容（HTTP ${response.status}），未提供 RSS/Atom/JSON Feed 数据`;
      return result;
    }
    result.xml = text;
    result.etag = response.headers.get("ETag") ?? "";
    result.last_modified = response.headers.get("Last-Modified") ?? "";
    return result;
  } catch (failure) {
    result.timed_out = failure?.name === "TimeoutError" || signal.reason?.name === "TimeoutError";
    result.error = result.timed_out ? "订阅源读取超时" : failure && failure.message ? String(failure.message) : "订阅源读取失败";
    return result;
  } finally {
    result.duration_ms = Date.now() - started_at;
  }
}

/**
 * 无状态原文抓取；只取回 HTML，不执行网页 JavaScript。
 * @param {{ article_url: string, settings?: unknown, options?: unknown,
 *   max_bytes?: number, fetch_impl?: typeof fetch }} input
 */
export async function fetch_article_document(input) {
  const result = { html: "", url: "", error: "" };
  const fetch_impl = input.fetch_impl ?? fetch;
  const direct = public_http_url(input.article_url);
  if (direct === null) {
    result.error = "原文地址被拒绝";
    return result;
  }
  const context = normalize_fetch_context(input.settings, input.options);
  const templated = apply_proxy_template(context.options.proxy, direct);
  if (templated === null) {
    result.error = "全文抓取代理地址被拒绝";
    return result;
  }
  try {
    const original_origin = new URL(direct).origin;
    let current = templated === "" ? direct : templated;
    let response = null;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      const headers = source_article_headers(
        context,
        current,
        new URL(current).origin !== original_origin,
      );
      let attempt;
      try {
        attempt = await fetch_impl(current, {
          headers,
          redirect: "manual",
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });
      } catch {
        result.error = "原文读取失败";
        return result;
      }
      const location = attempt.headers.get("Location");
      if (location !== null && redirect_statuses.has(attempt.status)) {
        await cancel_body(attempt);
        let next;
        try {
          next = new URL(location, current).toString();
        } catch {
          result.error = "原文重定向地址无效";
          return result;
        }
        const validated = proxy_target_url(next);
        if (validated === null) {
          result.error = "原文重定向地址被拒绝";
          return result;
        }
        current = validated;
        continue;
      }
      response = attempt;
      break;
    }
    if (response === null) {
      result.error = "原文重定向次数过多";
      return result;
    }
    if (!response.ok) {
      await cancel_body(response);
      result.error = `原文读取失败（HTTP ${response.status}）`;
      return result;
    }
    const limit = Number.isSafeInteger(input.max_bytes) && input.max_bytes > 0
      ? input.max_bytes
      : ARTICLE_MAX_BYTES;
    const text = await read_document_text(response, limit);
    if (text === null) {
      result.error = "原文内容过大";
      return result;
    }
    result.html = text;
    result.url = current;
    return result;
  } catch (failure) {
    result.error = failure && failure.message ? String(failure.message) : "原文读取失败";
    return result;
  }
}

/** 抓取并解析订阅源，返回协议无关的标准 feed。 */
export async function fetch_feed(input) {
  const fetched = await fetch_feed_document(input);
  if (fetched.error !== "" || fetched.not_modified) return { ...fetched, feed: null };
  try {
    return { ...fetched, feed: input.parse_feed(fetched.xml, input.feed_url) };
  } catch (failure) {
    return {
      ...fetched,
      feed: null,
      error: failure && failure.message ? String(failure.message) : "订阅源解析失败",
    };
  }
}

/** 抓取原文并用共享结构规则抽取正文。 */
export async function fetch_article(input) {
  const fetched = await fetch_article_document(input);
  if (fetched.error !== "") return { ...fetched, content_html: "" };
  return {
    ...fetched,
    content_html: input.extract_article(
      fetched.html,
      fetched.url || input.article_url,
      normalize_fetch_context(input.settings, input.options).options.rules,
    ),
  };
}
