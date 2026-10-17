// 脚本管理页「测试运行」的请求实体。
// 测试在 DO 的 QuickJS 沙箱里跑编辑器当前内容（含未保存草稿），并注入调用方
// 自己声明的 mock ctx；mock 未声明的 invoke 直接抛错，绝不回落真实设备。
// 沙箱内 ctx/日志/结果段源码在 `server/infra/script_sources.js`。
// 纯模块，不依赖 lib/http（校验失败只回数据，不回 Response）。
// 纯模块，可在 node --test 下直接覆盖。

import { MAX_SCRIPT_BYTES } from "../lib/constants.js";

/** mock ctx 片段上限。 */
const SCRIPT_MOCK_MAX_BYTES = 64 * 1024;
/** 测试请求里附带 route 的长度上限（scripts.route 是 UUID）。 */
const MAX_ROUTE_CHARS = 128;

/**
 * 「测试运行」请求实体：script 必填、mock_ctx 可空，两者都必须是字符串。
 * route 可选（scripts.route）：编辑已保存脚本时前端带上，
 * 测试运行日志才能按 route 归到对应脚本卡片；未保存草稿为空串。
 * 校验规则挂在 `fromBody` 静态方法上。
 * @param {{ script?: unknown, mock_ctx?: unknown, route?: unknown }} [state]
 */
export function ScriptTestRequestModel(state) {
  const source = state ?? {};
  const state_ = Object.freeze({
    script: String(source.script ?? ""),
    mock_ctx: String(source.mock_ctx ?? ""),
    route: String(source.route ?? ""),
    ...(source.route_index === undefined ? {} : { route_index: source.route_index }),
  });
  return Object.freeze({
    ...state_,
    toValue: () => ({ script: state_.script, mock_ctx: state_.mock_ctx, route: state_.route, ...(state_.route_index === undefined ? {} : { route_index: state_.route_index }) }),
  });
}

ScriptTestRequestModel.MOCK_MAX_BYTES = SCRIPT_MOCK_MAX_BYTES;
ScriptTestRequestModel.MAX_SCRIPT_BYTES = MAX_SCRIPT_BYTES;
ScriptTestRequestModel.MAX_ROUTE_CHARS = MAX_ROUTE_CHARS;
ScriptTestRequestModel.of = ScriptTestRequestModel;
/**
 * 归一化测试请求体。非法输入返回 `{ ok: false, error: { status: 400, message } }`，
 * 调用方据此回 400。错误文案保持逐字不变（测试锁死）。
 * @param {unknown} body
 * @returns {{ ok: true, model: ReturnType<typeof ScriptTestRequestModel> }
 *   | { ok: false, error: { status: number, message: string } }}
 */
ScriptTestRequestModel.fromBody = (body) => {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: { status: 400, message: "请求体必须是 JSON 对象" } };
  }
  const source = /** @type {Record<string, unknown>} */ (body);
  if (typeof source.script !== "string") {
    return { ok: false, error: { status: 400, message: "script 必须是字符串" } };
  }
  if (source.script.trim() === "") {
    return { ok: false, error: { status: 400, message: "script 不能为空" } };
  }
  if (new TextEncoder().encode(source.script).byteLength > MAX_SCRIPT_BYTES) {
    return { ok: false, error: { status: 400, message: "script 超过 10MB 限制" } };
  }
  const raw_mock = source.mock_ctx === undefined ? "" : source.mock_ctx;
  if (typeof raw_mock !== "string") {
    return { ok: false, error: { status: 400, message: "mock_ctx 必须是字符串" } };
  }
  if (raw_mock.length > SCRIPT_MOCK_MAX_BYTES) {
    return { ok: false, error: { status: 400, message: "mock_ctx 超过 64KB 限制" } };
  }
  const raw_route = source.route === undefined ? "" : source.route;
  if (typeof raw_route !== "string") {
    return { ok: false, error: { status: 400, message: "route 必须是字符串" } };
  }
  const route = raw_route.trim();
  if (route.length > MAX_ROUTE_CHARS) {
    return { ok: false, error: { status: 400, message: "route 过长" } };
  }
  if (source.route_index !== undefined && (!Number.isInteger(source.route_index) || source.route_index < 0 || source.route_index >= 32)) {
    return { ok: false, error: { status: 400, message: "route_index 必须是 0–31 的整数" } };
  }
  return { ok: true, model: ScriptTestRequestModel({ script: source.script, mock_ctx: raw_mock, route,
    ...(source.route_index === undefined ? {} : { route_index: source.route_index }) }) };
};
