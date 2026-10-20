// 定时清理：保留期裁剪 + 用户事件流的限流裁剪。
//
// 由 DO 的 alarm() 驱动。历史记录和用户事件的清理时间戳保留在实例内存中，
// 最多每小时执行一次；普通缓存仍按每次 alarm 检查过期。
import { ActivityEventModel } from "../../domain/activity_log.js";
import { RETENTION_MILLISECONDS } from "../../lib/constants.js";

export class ServiceMaintenance {
  /**
   * @param {{ repo: Record<string, any> }} deps
   */
  constructor({ repo }) {
    this.repo = repo;
    /** user_events 清理的内存限流时间戳（最多每小时一次）。 */
    this.activity_pruned_at = 0;
    this.retention_pruned_at = null;
  }

  /**
   * 清理已完成调用；日志保留期由 Workers Logs 管理。
   * @param {number} now
   * @returns {void}
   */
  prune_retention(now) {
    // 租约和快照会频繁唤醒 alarm，历史记录无需跟着每次扫描。
    if (this.retention_pruned_at === null || now - this.retention_pruned_at >= 3600000) {
      this.repo.calls.delete_completed_before(now - RETENTION_MILLISECONDS);
      this.retention_pruned_at = now;
    }
    // route 缓存的 L2 是按绝对过期时间判定的（TTL 只有分钟级，不是保留期），
    // 所以这里直接按 now 删，而不是 `now - RETENTION_MILLISECONDS`。
    this.repo.rss_route_cache.delete_expired(now);
  }

  /**
   * 清理操作事件：先删保留期之外的，再按每用户条数上限删最旧的。
   * @param {number} now
   * @returns {void}
   */
  prune_events(now) {
    if (!ActivityEventModel.should_prune(now, this.activity_pruned_at)) return;
    this.activity_pruned_at = now;
    try {
      this.repo.activity.delete_before(ActivityEventModel.retention_cutoff(now));
      for (const user_id of this.repo.activity.list_user_ids()) {
        this.repo.activity.trim_user(user_id, ActivityEventModel.MAX_EVENTS_PER_USER);
      }
    } catch (error) {
      console.warn("prune_events failed", error);
    }
  }
}
