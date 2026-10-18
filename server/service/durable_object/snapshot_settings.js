import { default_poll_policy, parse_poll_policy } from "../../lib/poll_schedule.js";
import { stored_poll_policy } from "../../lib/snapshot_schedule.js";
import { do_error } from "./error.js";
import { DEFAULT_SNAPSHOT_CONCURRENCY, MAX_SNAPSHOT_CONCURRENCY } from "../../lib/constants.js";

export class ServiceSnapshotSettings {
  constructor({ repo, schedule_alarm }) { this.repo = repo; this.schedule_alarm = schedule_alarm; }
  settings() {
    const row = this.repo.get();
    return { policy: stored_poll_policy(row?.policy_json, default_poll_policy(), false),
      max_concurrency: row?.max_concurrency ?? DEFAULT_SNAPSHOT_CONCURRENCY, updated_at: Number(row?.updated_at || 0) };
  }
  async save_settings(body) {
    if (!body || typeof body !== "object" || Array.isArray(body) || body.policy === undefined && body.max_concurrency === undefined)
      throw do_error("请提供抓取规则或最大并发抓取数", 400);
    const current = this.settings();
    let policy;
    try { policy = body?.policy === undefined ? current.policy : parse_poll_policy(body.policy, false); }
    catch (error) { throw do_error(error.message, 400); }
    const max_concurrency = body?.max_concurrency === undefined ? current.max_concurrency : body.max_concurrency;
    if (!Number.isInteger(max_concurrency) || max_concurrency < 1 || max_concurrency > MAX_SNAPSHOT_CONCURRENCY)
      throw do_error("最大并发抓取数必须为 1 至 " + MAX_SNAPSHOT_CONCURRENCY + " 的整数", 400);
    // 只调整并发数时保留规则起点，避免把所有继承源的抓取时间推迟。
    const updated_at = JSON.stringify(policy) === JSON.stringify(current.policy) ? current.updated_at : Date.now();
    this.repo.put(policy, updated_at, max_concurrency);
    await this.schedule_alarm?.();
    return this.settings();
  }
}
