import { default_poll_policy, normalize_poll_policy, next_policy_at } from "./poll_schedule.js";

const policies = new Map();
export function stored_poll_policy(value, fallback = { mode: "inherit" }, allow_inherit = true) {
  if (!value) return fallback;
  const key = String(value) + ":" + allow_inherit;
  if (!policies.has(key)) {
    let raw;
    try { raw = JSON.parse(value); } catch {}
    const policy = normalize_poll_policy(raw, null, allow_inherit);
    if (policies.size >= 2048) policies.clear();
    policies.set(key, policy);
  }
  return policies.get(key) || fallback;
}

export function snapshot_policy(source, settings) {
  const own = source.poll_policy || stored_poll_policy(source.poll_policy_json);
  return own.mode === "inherit" ? settings?.policy || default_poll_policy() : own;
}

export function snapshot_next_at(source, settings, now = Date.now()) {
  const own = source.poll_policy || stored_poll_policy(source.poll_policy_json);
  const policy = snapshot_policy(source, settings);
  if (policy.mode === "manual" || !source.enabled) return null;
  const global_updated_at = own.mode === "inherit" && Number(settings?.updated_at || 0) > Number(source.created_at || 0)
    ? Number(settings?.updated_at || 0) : 0;
  const anchor = Math.max(Number(source.snapshot_attempted_at || 0), Number(source.poll_updated_at || 0), global_updated_at);
  if (!anchor && ["interval", "adaptive"].includes(policy.mode)) return 0;
  const start = ["interval", "adaptive"].includes(policy.mode) ? anchor : Math.max(anchor, Number(source.created_at || now));
  return next_policy_at(policy, start, { adaptive_interval: source.adaptive_interval });
}
