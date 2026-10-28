import { parse_poll_policy } from "../lib/poll_schedule.js";
import { stored_poll_policy } from "../lib/snapshot_schedule.js";

function input_fields(body) {
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title || title.length > 200) throw new Error("剪藏名称须为 1–200 个字符");
  if (body.script_id && body.script_id !== ClipModel.WEBSITE_SCRIPT_ID) {
    if (typeof body.script_id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(body.script_id)) throw new Error("请选择有效的剪藏脚本");
    const script_url = script_address(body.script_url);
    if (body.enabled !== undefined && typeof body.enabled !== "boolean") throw new Error("启用状态须为布尔值");
    return { title, script_id: body.script_id, script_url, url: "", selector: "", viewport_width: 1440, viewport_height: 900, wait_ms: 1000,
      enabled: body.enabled === false ? 0 : 1, poll_policy_json: JSON.stringify(parse_poll_policy(body.poll_policy || { mode: "inherit" })) };
  }
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
  const fields = { title, url: url.href, selector, enabled: body.enabled === false ? 0 : 1,
    viewport_width: integer("viewport_width", 1440, 320, 3840),
    viewport_height: integer("viewport_height", 900, 320, 2160),
    wait_ms: integer("wait_ms", 1000, 0, 10000),
    poll_policy_json: JSON.stringify(parse_poll_policy(body.poll_policy || { mode: "inherit" })) };
  const query = new URLSearchParams(Object.entries({ url: fields.url, selector, viewport_width: fields.viewport_width,
    viewport_height: fields.viewport_height, wait_ms: fields.wait_ms }));
  return { ...fields, script_id: ClipModel.WEBSITE_SCRIPT_ID, script_url: "/web/region?" + query };
}

function script_address(value) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.length > 16384 || /[\u0000-\u001f\u007f\\]/.test(value)) throw new Error("填写完整的脚本路由，如 /github/owner/repo/readme");
  const url = new URL(value, "https://clip.invalid");
  if (url.origin !== "https://clip.invalid" || url.hash || url.searchParams.has("token")) throw new Error("剪藏路由不能包含主机、片段或访问凭证");
  return url.pathname.replace(/^\/api\/clip(?=\/)/, "") + url.search;
}

export function ClipModel(row = {}) {
  const state = { id: row.id, script_id: row.script_id || "", script_url: row.script_url || "", title: row.title, url: row.url, selector: row.selector,
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
ClipModel.WEBSITE_SCRIPT_ID = "builtin-website-clip";
ClipModel.validate = body => {
  try { return { ok: true, fields: input_fields(body) }; }
  catch (error) { return { ok: false, error: error.message }; }
};
