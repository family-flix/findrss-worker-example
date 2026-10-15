export const FEED_ERRORS = Object.freeze({
  FEED_AUTH_REQUIRED: [401, "订阅源需要访问凭证"],
  INVALID_PARAMETER: [400, "订阅参数无效"],
  FEED_NOT_FOUND: [404, "订阅源不存在"],
  UPSTREAM_AUTH_REQUIRED: [502, "上游登录状态失效"],
  UPSTREAM_ACCESS_DENIED: [502, "上游拒绝访问"],
  UPSTREAM_RATE_LIMITED: [503, "上游请求受限"],
  UPSTREAM_FETCH_FAILED: [502, "上游请求失败"],
  UPSTREAM_INVALID_RESPONSE: [502, "上游内容无法解析"],
  UPSTREAM_TIMEOUT: [504, "上游响应超时"],
  SOURCE_UNAVAILABLE: [503, "订阅源暂时不可用"],
  INSUFFICIENT_CREDITS: [402, "订阅积分不足"],
  DEVICE_UNAVAILABLE: [409, "设备暂时不可用"],
  SCRIPT_COOKIE_PERMISSION_REQUIRED: [409, "脚本 Cookie 权限需要管理员确认"],
  SCRIPT_FAILED: [502, "订阅脚本执行失败"],
});

export function feed_problem(code, message) {
  if (!Object.hasOwn(FEED_ERRORS, code) || typeof message !== "string" || !message.trim()) return null;
  const [status, title] = FEED_ERRORS[code];
  message = message.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 1000);
  return { type: "urn:findrss:error:" + code.toLowerCase().replaceAll("_", "-"), title, status, code, error: message };
}

export function public_feed_failure(failure) {
  return failure?.name === "FeedError" ? feed_problem(failure.code, failure.message) : null;
}
