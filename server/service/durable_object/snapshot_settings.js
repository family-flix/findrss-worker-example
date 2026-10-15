import { default_poll_policy, parse_poll_policy } from "../../lib/poll_schedule.js";
import { stored_poll_policy } from "../../lib/snapshot_schedule.js";
import { do_error } from "./error.js";

export class ServiceSnapshotSettings {
  constructor({ repo, schedule_alarm }) { this.repo = repo; this.schedule_alarm = schedule_alarm; }
  settings() {
    const row = this.repo.get();
    return { policy: stored_poll_policy(row?.policy_json, default_poll_policy(), false), updated_at: Number(row?.updated_at || 0) };
  }
  async save_settings(body) {
    let policy;
    try { policy = parse_poll_policy(body?.policy, false); }
    catch (error) { throw do_error(error.message, 400); }
    this.repo.put(policy, Date.now());
    await this.schedule_alarm?.();
    return this.settings();
  }
}
