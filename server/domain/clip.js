import { parse_poll_policy } from "../lib/poll_schedule.js";
import { stored_poll_policy } from "../lib/snapshot_schedule.js";

function input_fields(body) {
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title || title.length > 200) throw new Error("剪藏名称须为 1–200 个字符");
  let url;
  try {
    url = new URL(body.url);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.href.length > 8192) throw new Error();
  } catch { throw new Error("请输入完整的 HTTP(S) 来源网址"); }
  const selector = typeof body.selector === "string" ? body.selector.trim() : "";
  if (!selector || selector.length > 1000) throw new Error("CSS 选择器须为 1–1000 个字符");
  const integer = (key, fallback, min, max) => {
    const value = body[key] ?? fallback;
    if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${key} 须为 ${min}–${max} 的整数`);
    return value;
  };
  if (body.enabled !== undefined && typeof body.enabled !== "boolean") throw new Error("启用状态须为布尔值");
  return { title, url: url.href, selector, enabled: body.enabled === false ? 0 : 1,
    viewport_width: integer("viewport_width", 1440, 320, 3840),
    viewport_height: integer("viewport_height", 900, 320, 2160),
    wait_ms: integer("wait_ms", 1000, 0, 10000),
    poll_policy_json: JSON.stringify(parse_poll_policy(body.poll_policy || { mode: "inherit" })) };
}

export function ClipModel(row = {}) {
  const state = { id: row.id, title: row.title, url: row.url, selector: row.selector,
    viewport_width: row.viewport_width, viewport_height: row.viewport_height, wait_ms: row.wait_ms,
    enabled: Boolean(row.enabled), poll_policy: stored_poll_policy(row.poll_policy_json),
    node: row.node, width: row.width, height: row.height, byte_size: row.byte_size,
    image_missing: row.image_missing, created_at: row.created_at, saved_at: row.saved_at,
    attempted_at: row.attempted_at, error: row.error,
    path: "/clips/" + row.id, status: row.saved_at ? "saved" : "pending" };
  return Object.freeze({ ...state, toValue: () => ({ ...state, poll_policy: JSON.parse(JSON.stringify(state.poll_policy)) }) });
}

ClipModel.of = ClipModel;
ClipModel.fromRow = ClipModel;
ClipModel.MAX_BYTES = 8 * 1024 * 1024;
ClipModel.MAX_RECORDS = 100;
ClipModel.validate = body => {
  try { return { ok: true, fields: input_fields(body) }; }
  catch (error) { return { ok: false, error: error.message }; }
};
