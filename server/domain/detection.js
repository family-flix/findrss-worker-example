import { parse_poll_policy } from "../lib/poll_schedule.js";
import { stored_poll_policy } from "../lib/snapshot_schedule.js";

export function DetectionModel(row = {}) {
  const value = { id: row.id, title: row.title, script_id: row.script_id, script_url: row.script_url,
    enabled: Boolean(row.enabled), poll_policy: stored_poll_policy(row.poll_policy_json),
    baseline_id: row.baseline_id || "", last_run_id: row.last_run_id || "", status: row.status || "pending",
    change_count: row.change_count || 0, match_count: row.match_count || 0, error: row.error || "",
    created_at: row.created_at, saved_at: row.saved_at || 0, attempted_at: row.attempted_at || 0 };
  return Object.freeze({ ...value, toValue: () => ({ ...value, poll_policy: JSON.parse(JSON.stringify(value.poll_policy)) }) });
}

DetectionModel.validate = body => {
  try {
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("检测任务参数无效");
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (!title || title.length > 200) throw new Error("检测名称须为 1–200 字符");
    if (typeof body.script_id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(body.script_id)) throw new Error("请选择内容检测脚本");
    if (typeof body.script_url !== "string" || !body.script_url.startsWith("/") || body.script_url.startsWith("//")
      || body.script_url.length > 16384 || /[\u0000-\u001f\u007f\\]/.test(body.script_url)) throw new Error("填写所选脚本的具体路由");
    const url = new URL(body.script_url, "https://detect.invalid");
    if (url.origin !== "https://detect.invalid" || url.hash || url.searchParams.has("token")) throw new Error("检测路由不能包含主机、片段或访问凭证");
    if (body.enabled !== undefined && typeof body.enabled !== "boolean") throw new Error("启用状态须为布尔值");
    return { ok: true, fields: { title, script_id: body.script_id, script_url: url.pathname.replace(/^\/api\/detect(?=\/)/, "") + url.search,
      enabled: body.enabled === false ? 0 : 1, poll_policy_json: JSON.stringify(parse_poll_policy(body.poll_policy || { mode: "inherit" })) } };
  } catch (error) { return { ok: false, error: error.message }; }
};
DetectionModel.MAX_RECORDS = 100;
